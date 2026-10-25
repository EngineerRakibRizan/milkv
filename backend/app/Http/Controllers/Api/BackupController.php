<?php

namespace App\Http\Controllers\Api;

use App\Domain\Backup\BackupImporter;
use App\Domain\Backup\BackupService;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;

/** Owner-only: download backups in three formats, keep server copies, restore a backup as a new farm. */
class BackupController extends Controller
{
    public function __construct(private BackupService $backups) {}

    public function download(Request $r)
    {
        $this->allow('backup.manage');
        $format = $r->validate(['format' => 'required|in:full,sql,csv'])['format'];
        @set_time_limit(300);
        $b = $this->backups->build($this->current()->farm(), $format);
        $this->audit('backup_download', ['format' => $format, 'rows' => array_sum($b['counts'])]);

        return response()->download($b['path'], $b['name'], ['Content-Type' => $b['mime']])->deleteFileAfterSend();
    }

    public function index()
    {
        $this->allow('backup.manage');

        return ['backups' => $this->backups->list($this->current()->farm()), 'keep_days' => BackupService::KEEP_DAYS];
    }

    public function store()
    {
        $this->allow('backup.manage');
        @set_time_limit(300);

        return response()->json($this->backups->store($this->current()->farm()), 201);
    }

    public function stored(string $name)
    {
        $this->allow('backup.manage');
        $path = $this->backups->storedPath($this->current()->farm(), $name);
        abort_if(! $path, 404);

        return response()->download($path, $name, ['Content-Type' => 'application/zip']);
    }

    /** Restores as a NEW farm owned by the current user; the current farm is not touched. */
    public function import(Request $r, BackupImporter $importer)
    {
        $this->allow('backup.manage');
        $r->validate(['file' => 'required|file|max:204800|mimetypes:application/zip,application/x-zip-compressed,application/octet-stream']);
        @set_time_limit(600);
        $result = $importer->import($r->file('file')->getRealPath(), $r->user());
        $this->audit('backup_import', ['new_farm_id' => $result['farm_id'], 'rows' => array_sum($result['counts'])]);

        return response()->json($result, 201);
    }

    private function audit(string $action, array $after): void
    {
        (new AuditLog)->forceFill([
            'farm_id' => $this->current()->id(), 'user_id' => auth()->id(), 'action' => substr($action, 0, 20),
            'auditable_type' => 'farm', 'auditable_id' => $this->current()->id(), 'before' => null, 'after' => $after,
            'ip' => request()->ip(), 'created_at' => now(),
        ])->save();
    }
}
