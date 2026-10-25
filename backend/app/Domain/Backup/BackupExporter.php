<?php

namespace App\Domain\Backup;

use App\Models\Farm;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use ZipArchive;

/**
 * Exports exactly one farm's data (never other farms on the same server).
 *
 *  full  ZIP: manifest.json (checksums) + data/<table>.json + files/ (uploads)
 *  csv   ZIP: manifest.json + data/<table>.csv + README.txt (Excel-friendly, also importable)
 *  sql   plain INSERT statements for an empty FarmOS database (admin restore)
 */
final class BackupExporter
{
    public function full(Farm $farm, string $path): array
    {
        return $this->zip($farm, $path, 'json');
    }

    public function csv(Farm $farm, string $path): array
    {
        return $this->zip($farm, $path, 'csv');
    }

    /** Rows of one table for this farm, oldest first, streamed in chunks. */
    public function rows(Farm $farm, string $table): \Generator
    {
        $q = $this->query($farm, $table);
        $order = isset(BackupSchema::TABLES[$table]['noid']) ? 'prefix' : 'id';
        foreach ($q->orderBy($order)->lazy(500) as $row) {
            yield $this->normalize($table, (array) $row);
        }
    }

    public function sql(Farm $farm, string $path): array
    {
        $fh = fopen($path, 'wb') ?: throw new RuntimeException("Cannot write {$path}");
        fwrite($fh, "-- FarmOS SQL backup\n-- Farm: {$farm->name} (id {$farm->id})\n-- Created: ".now()->toIso8601String()."\n"
            ."-- Restore into an EMPTY FarmOS database after `php artisan migrate`. Ids are kept as-is.\n"
            ."-- To move to another server that already has data, use the Full backup (.zip) import instead.\n"
            ."-- MySQL: run `SET SESSION sql_mode = 'ANSI_QUOTES';` first.\n\nBEGIN;\n\n");
        $farmRow = (array) DB::table('farms')->where('id', $farm->id)->first();
        fwrite($fh, $this->insert('farms', $farmRow));
        $counts = [];
        foreach (array_keys(BackupSchema::TABLES) as $table) {
            $counts[$table] = 0;
            foreach ($this->rows($farm, $table) as $row) {
                fwrite($fh, $this->insert($table, $row));
                $counts[$table]++;
            }
        }
        fwrite($fh, "\nCOMMIT;\n");
        fclose($fh);

        return $counts;
    }

    private function zip(Farm $farm, string $path, string $format): array
    {
        $zip = new ZipArchive;
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException("Cannot create {$path}");
        }
        $manifest = [
            'format' => 'farmos-backup', 'version' => BackupSchema::VERSION, 'data_format' => $format,
            'created_at' => now()->toIso8601String(), 'schema' => $this->latestMigration(),
            'farm' => array_intersect_key($farm->getAttributes(), array_flip(array_merge(['id'], BackupSchema::FARM_FIELDS))),
            'tables' => [], 'files' => [],
        ];
        $tmp = [];
        foreach (array_keys(BackupSchema::TABLES) as $table) {
            $file = tempnam(sys_get_temp_dir(), 'fbk');
            $tmp[] = $file;
            $count = $format === 'json' ? $this->writeJson($farm, $table, $file) : $this->writeCsv($farm, $table, $file);
            $name = "data/{$table}.{$format}";
            $zip->addFile($file, $name);
            $manifest['tables'][$table] = ['rows' => $count, 'file' => $name, 'sha256' => hash_file('sha256', $file)];
        }
        // Uploaded photos, receipts and documents travel with the full backup.
        if ($format === 'json') {
            foreach (DB::table('attachments')->where('farm_id', $farm->id)->pluck('path') as $p) {
                if (Storage::disk('local')->exists($p)) {
                    $zip->addFile(Storage::disk('local')->path($p), "files/{$p}");
                    $manifest['files'][] = $p;
                }
            }
        }
        if ($format === 'csv') {
            $zip->addFromString('README.txt', self::CSV_README);
        }
        $zip->addFromString('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $zip->close();
        array_map('unlink', $tmp);

        return array_map(fn ($t) => $t['rows'], $manifest['tables']);
    }

    private function writeJson(Farm $farm, string $table, string $file): int
    {
        $fh = fopen($file, 'wb');
        fwrite($fh, '[');
        $n = 0;
        foreach ($this->rows($farm, $table) as $row) {
            fwrite($fh, ($n++ ? ",\n" : "\n").json_encode($row, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
        }
        fwrite($fh, "\n]\n");
        fclose($fh);

        return $n;
    }

    private function writeCsv(Farm $farm, string $table, string $file): int
    {
        $fh = fopen($file, 'wb');
        fwrite($fh, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel shows Bangla correctly
        $columns = DB::getSchemaBuilder()->getColumnListing($table);
        fputcsv($fh, $columns, ',', '"', '');
        $n = 0;
        foreach ($this->rows($farm, $table) as $row) {
            fputcsv($fh, array_map(fn ($c) => is_bool($row[$c] ?? null) ? (int) $row[$c] : ($row[$c] ?? ''), $columns), ',', '"', '');
            $n++;
        }
        fclose($fh);

        return $n;
    }

    private function query(Farm $farm, string $table): Builder
    {
        $def = BackupSchema::TABLES[$table];
        if (isset($def['parent'])) {
            [$col, $parent] = [array_key_first($def['parent']), reset($def['parent'])];

            return DB::table($table)->whereIn($col, DB::table($parent)->where('farm_id', $farm->id)->select('id'));
        }

        return DB::table($table)->where('farm_id', $farm->id);
    }

    private function normalize(string $table, array $row): array
    {
        foreach (BackupSchema::TABLES[$table]['bool'] ?? [] as $c) {
            if (array_key_exists($c, $row) && $row[$c] !== null) {
                $row[$c] = (bool) $row[$c];
            }
        }

        return $row;
    }

    private function insert(string $table, array $row): string
    {
        $cols = implode(', ', array_map(fn ($c) => '"'.$c.'"', array_keys($row)));
        $vals = implode(', ', array_map(fn ($v) => match (true) {
            $v === null => 'NULL',
            is_bool($v) => $v ? 'TRUE' : 'FALSE',
            is_int($v), is_float($v) => (string) $v,
            default => "'".str_replace("'", "''", (string) $v)."'",
        }, array_values($row)));

        return "INSERT INTO \"{$table}\" ({$cols}) VALUES ({$vals});\n";
    }

    private function latestMigration(): ?string
    {
        return DB::table('migrations')->orderByDesc('id')->value('migration');
    }

    private const CSV_README = <<<'TXT'
FarmOS CSV backup
=================
One CSV file per table, UTF-8 (opens in Excel with Bangla text intact).

Units used in the raw data:
  * Money columns (amount, total, paid, price, cost, balance, debit, credit, salary ...) are in PAISA: divide by 100 for Taka.
  * Quantity columns ending in _milli are thousandths of the item's unit (kg, L, bag, pcs): divide by 1000.
  * Milk columns ending in _ml are millilitres: divide by 1000 for litres. Weights ending in _g are grams.

This archive can also be imported back into FarmOS (Settings -> Data & backup -> Import).
Do not edit manifest.json or the CSV files if you want to import it again: the checksums will no longer match.
TXT;
}
