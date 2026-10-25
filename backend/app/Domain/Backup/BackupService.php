<?php

namespace App\Domain\Backup;

use App\Models\Farm;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Builds downloadable backups and keeps a rolling set of automatic ones on the server. */
final class BackupService
{
    public const KEEP_DAYS = 14;

    public function __construct(private BackupExporter $exporter) {}

    /** @return array{path:string, name:string, mime:string, counts:array} temp file the caller must delete */
    public function build(Farm $farm, string $format): array
    {
        $slug = Str::slug($farm->name) ?: 'farm';
        $stamp = now($farm->timezone)->format('Y-m-d_His');
        [$ext, $mime] = match ($format) {
            'sql' => ['sql', 'application/sql'],
            'csv' => ['csv.zip', 'application/zip'],
            default => ['farmos.zip', 'application/zip'],
        };
        $path = tempnam(sys_get_temp_dir(), 'farmos');
        $counts = match ($format) {
            'sql' => $this->exporter->sql($farm, $path),
            'csv' => $this->exporter->csv($farm, $path),
            default => $this->exporter->full($farm, $path),
        };

        return ['path' => $path, 'name' => "{$slug}-backup-{$stamp}.{$ext}", 'mime' => $mime, 'counts' => $counts];
    }

    /** Full backup stored on the server (manual "create now" or the daily schedule). */
    public function store(Farm $farm): array
    {
        $b = $this->build($farm, 'full');
        $rel = $this->dir($farm).'/'.$b['name'];
        Storage::disk('local')->put($rel, fopen($b['path'], 'rb'));
        @unlink($b['path']);
        $this->prune($farm);

        return $this->describe($rel);
    }

    public function list(Farm $farm): array
    {
        return collect(Storage::disk('local')->files($this->dir($farm)))
            ->filter(fn ($f) => str_ends_with($f, '.farmos.zip'))
            ->map(fn ($f) => $this->describe($f))->sortByDesc('created_at')->values()->all();
    }

    /** Absolute path of a stored backup, or null when the name is not one of this farm's files. */
    public function storedPath(Farm $farm, string $name): ?string
    {
        if (basename($name) !== $name || ! str_ends_with($name, '.farmos.zip')) {
            return null;
        }
        $rel = $this->dir($farm).'/'.$name;

        return Storage::disk('local')->exists($rel) ? Storage::disk('local')->path($rel) : null;
    }

    public function prune(Farm $farm): void
    {
        $cutoff = now()->subDays(self::KEEP_DAYS)->getTimestamp();
        foreach (Storage::disk('local')->files($this->dir($farm)) as $f) {
            if (Storage::disk('local')->lastModified($f) < $cutoff) {
                Storage::disk('local')->delete($f);
            }
        }
    }

    private function dir(Farm $farm): string
    {
        return "backups/farm-{$farm->id}";
    }

    private function describe(string $rel): array
    {
        $disk = Storage::disk('local');

        return ['name' => basename($rel), 'size' => $disk->size($rel), 'created_at' => date(DATE_ATOM, $disk->lastModified($rel))];
    }
}
