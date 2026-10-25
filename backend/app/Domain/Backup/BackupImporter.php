<?php

namespace App\Domain\Backup;

use App\Domain\Accounting\Ledger;
use App\Models\Farm;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use ZipArchive;

/**
 * Restores a full or CSV backup as a NEW farm on this server, so existing
 * data is never overwritten. Every row gets a new id; all references
 * (foreign keys and polymorphic source/target columns) are re-mapped:
 *
 *  1. tables are inserted in BackupSchema order; references to tables
 *     already inserted are translated on the spot;
 *  2. references to tables inserted later (deliveries.invoice_id,
 *     animals.mother_id, …) are written as NULL and patched afterwards.
 *
 * It all runs in one transaction: a backup restores completely or not at all.
 */
final class BackupImporter
{
    /** @var array<string, array<int,int>> table => old id => new id */
    private array $map = [];

    /** @var array<int, array{table:string, id:int, col:string, old:int, target:string}> */
    private array $deferred = [];

    /** @var array<string, string[]> */
    private array $columns = [];

    public function import(string $zipPath, User $owner): array
    {
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::RDONLY) !== true) {
            throw ValidationException::withMessages(['file' => 'This is not a valid FarmOS backup (.zip).']);
        }
        try {
            $manifest = $this->manifest($zip);
            $this->checkIntegrity($zip, $manifest);

            return DB::transaction(function () use ($zip, $manifest, $owner) {
                $farm = $this->createFarm($manifest, $owner);
                $counts = [];
                foreach (array_keys(BackupSchema::TABLES) as $table) {
                    $counts[$table] = isset($manifest['tables'][$table]) ? $this->importTable($zip, $manifest, $table, $farm) : 0;
                }
                $this->applyDeferred();
                $files = $this->restoreFiles($zip, $manifest, $farm);
                Ledger::forgetCache();

                return ['farm_id' => $farm->id, 'name' => $farm->name, 'counts' => $counts, 'files' => $files];
            });
        } finally {
            $zip->close();
        }
    }

    private function manifest(ZipArchive $zip): array
    {
        $raw = $zip->getFromName('manifest.json');
        $m = $raw ? json_decode($raw, true) : null;
        if (! is_array($m) || ($m['format'] ?? null) !== 'farmos-backup') {
            throw ValidationException::withMessages(['file' => 'manifest.json is missing: this is not a FarmOS backup.']);
        }
        if (($m['version'] ?? 0) > BackupSchema::VERSION) {
            throw ValidationException::withMessages(['file' => 'This backup was made by a newer FarmOS. Update this server first.']);
        }
        if (! empty($m['schema']) && ! DB::table('migrations')->where('migration', $m['schema'])->exists()) {
            throw ValidationException::withMessages(['file' => "This server's database is older than the backup ({$m['schema']}). Run the latest FarmOS update first."]);
        }

        return $m;
    }

    /** Every data file must match its SHA-256 in the manifest: a damaged or edited backup is refused. */
    private function checkIntegrity(ZipArchive $zip, array $m): void
    {
        foreach ($m['tables'] ?? [] as $table => $t) {
            if (! isset(BackupSchema::TABLES[$table])) {
                continue;
            }
            $data = $zip->getFromName($t['file']);
            if ($data === false || hash('sha256', $data) !== $t['sha256']) {
                throw ValidationException::withMessages(['file' => "The backup is damaged or was edited ({$t['file']}). Use an original backup file."]);
            }
        }
    }

    private function createFarm(array $m, User $owner): Farm
    {
        $src = $m['farm'] ?? [];
        $fields = array_intersect_key($src, array_flip(BackupSchema::FARM_FIELDS));
        if (isset($fields['settings']) && is_string($fields['settings'])) {
            $fields['settings'] = json_decode($fields['settings'], true);
        }
        $fields['name'] = ($fields['name'] ?? 'Farm').' (restored '.now()->format('Y-m-d').')';
        $farm = Farm::create($fields);
        $farm->users()->attach($owner->id, ['role' => 'owner', 'status' => 'active']);

        return $farm;
    }

    private function importTable(ZipArchive $zip, array $m, string $table, Farm $farm): int
    {
        $def = BackupSchema::TABLES[$table];
        $this->columns[$table] ??= DB::getSchemaBuilder()->getColumnListing($table);
        $n = 0;
        foreach ($this->read($zip, $m['tables'][$table]['file']) as $row) {
            $oldId = isset($row['id']) ? (int) $row['id'] : null;
            unset($row['id']);
            // Only columns this server has (older backups may lack newer optional columns).
            $row = array_intersect_key($row, array_flip($this->columns[$table]));
            if (in_array('farm_id', $this->columns[$table], true)) {
                $row['farm_id'] = $farm->id;
            }
            foreach ($def['bool'] ?? [] as $c) {
                if (isset($row[$c])) {
                    $row[$c] = filter_var($row[$c], FILTER_VALIDATE_BOOLEAN);
                }
            }

            $pending = [];
            foreach (array_merge($def['parent'] ?? [], $def['fk'] ?? []) as $col => $target) {
                if (! array_key_exists($col, $row) || $row[$col] === null) {
                    continue;
                }
                $old = (int) $row[$col];
                if ($target === 'users') {
                    $row[$col] = null; // people are not migrated; the restoring owner re-invites staff
                } elseif (isset($this->map[$target]) && $target !== $table) {
                    $row[$col] = $this->map[$target][$old] ?? null;
                } else {
                    $row[$col] = null;
                    $pending[] = [$col, $old, $target];
                }
            }
            $skip = false;
            foreach ($def['morph'] ?? [] as $prefix) {
                [$tc, $ic] = ["{$prefix}_type", "{$prefix}_id"];
                if (empty($row[$tc]) || $row[$ic] === null) {
                    continue;
                }
                $target = $this->morphTable($row[$tc]);
                $old = (int) $row[$ic];
                if ($target === 'farms') {
                    $row[$ic] = $farm->id;
                } elseif (! $target || ! isset(BackupSchema::TABLES[$target])) {
                    if (! $this->nullable($table, $ic)) {
                        $skip = true; // points at something that is not part of a farm backup
                    }
                    [$row[$ic], $row[$tc]] = [null, $this->nullable($table, $tc) ? null : $row[$tc]];
                } elseif (isset($this->map[$target]) && $target !== $table) {
                    $new = $this->map[$target][$old] ?? null;
                    if ($new === null && ! $this->nullable($table, $ic)) {
                        $skip = true; // e.g. audit entry for a record that no longer exists
                    }
                    $row[$ic] = $new;
                    if ($new === null) {
                        $row[$tc] = $this->nullable($table, $tc) ? null : $row[$tc];
                    }
                } else {
                    $row[$ic] = null;
                    $row[$tc] = null;
                    $pending[] = [$ic, $old, $target, $tc, $old];
                }
            }
            if ($skip) {
                continue;
            }

            if (isset($def['noid'])) {
                DB::table($table)->insert($row);
            } else {
                $newId = DB::table($table)->insertGetId($row);
                $this->map[$table][$oldId] = $newId;
                foreach ($pending as $p) {
                    $this->deferred[] = ['table' => $table, 'id' => $newId, 'col' => $p[0], 'old' => $p[1], 'target' => $p[2], 'type_col' => $p[3] ?? null,
                        'type' => isset($p[3]) ? $this->aliasFor($p[2]) : null];
                }
            }
            $n++;
        }
        $this->map[$table] ??= [];

        return $n;
    }

    /** Second pass: references that pointed forward (to tables inserted later). */
    private function applyDeferred(): void
    {
        foreach ($this->deferred as $d) {
            $new = $this->map[$d['target']][$d['old']] ?? null;
            if ($new === null) {
                continue;
            }
            $patch = [$d['col'] => $new];
            if ($d['type_col']) {
                $patch[$d['type_col']] = $d['type'];
            }
            DB::table($d['table'])->where('id', $d['id'])->update($patch);
        }
    }

    private function restoreFiles(ZipArchive $zip, array $m, Farm $farm): int
    {
        $n = 0;
        foreach ($m['files'] ?? [] as $old) {
            $data = $zip->getFromName("files/{$old}");
            if ($data === false) {
                continue;
            }
            $new = preg_replace('#^farms/\d+/#', "farms/{$farm->id}/", $old);
            Storage::disk('local')->put($new, $data);
            DB::table('attachments')->where('farm_id', $farm->id)->where('path', $old)->update(['path' => $new]);
            $n++;
        }

        return $n;
    }

    /** @return iterable<array<string,mixed>> */
    private function read(ZipArchive $zip, string $file): iterable
    {
        $data = $zip->getFromName($file);
        if (str_ends_with($file, '.json')) {
            return json_decode($data, true, flags: JSON_THROW_ON_ERROR);
        }
        // CSV: header row, UTF-8 BOM, empty cell = NULL.
        $fh = fopen('php://temp', 'w+');
        fwrite($fh, preg_replace('/^\xEF\xBB\xBF/', '', $data));
        rewind($fh);
        $header = fgetcsv($fh, null, ',', '"', '');
        $rows = [];
        while (($r = fgetcsv($fh, null, ',', '"', '')) !== false) {
            if ($r === [null]) {
                continue;
            }
            $rows[] = array_map(fn ($v) => $v === '' ? null : $v, array_combine($header, $r));
        }
        fclose($fh);

        return $rows;
    }

    private function morphTable(?string $alias): ?string
    {
        $class = $alias ? Relation::getMorphedModel($alias) : null;

        return $class ? (new $class)->getTable() : null;
    }

    private function aliasFor(?string $table): ?string
    {
        foreach (Relation::morphMap() as $alias => $class) {
            if ((new $class)->getTable() === $table) {
                return $alias;
            }
        }

        return null;
    }

    private function nullable(string $table, string $column): bool
    {
        static $cache = [];
        $cache[$table] ??= collect(DB::getSchemaBuilder()->getColumns($table))->mapWithKeys(fn ($c) => [$c['name'] => $c['nullable']])->all();

        return $cache[$table][$column] ?? true;
    }
}
