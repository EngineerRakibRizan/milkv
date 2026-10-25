<?php

use App\Domain\Notifications\AlertService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('farmos:alerts', function (AlertService $alerts) {
    $this->info($alerts->runForAll().' new notification(s).');
})->purpose('Generate low-stock, vaccination, overdue and production alerts for every farm');

Artisan::command('farmos:prune', function () {
    $n = DB::table('idempotency_keys')->where('created_at', '<', now()->subDays(2))->delete();
    $this->info("Pruned {$n} idempotency keys.");
})->purpose('Remove expired idempotency keys');

Artisan::command('farmos:backup {farm? : Farm id} {--all : Every farm} {--format=full : full|sql|csv} {--output= : Write to this path instead of the server backup folder}',
    function (\App\Domain\Backup\BackupService $backups) {
        $farms = $this->option('all') ? \App\Models\Farm::all() : \App\Models\Farm::whereKey($this->argument('farm'))->get();
        if ($farms->isEmpty()) {
            return $this->error('Give a farm id or --all.');
        }
        foreach ($farms as $farm) {
            if ($this->option('output')) {
                $b = $backups->build($farm, $this->option('format'));
                rename($b['path'], $this->option('output'));
                $this->info("{$farm->name}: ".array_sum($b['counts'])." rows -> {$this->option('output')}");
            } else {
                $s = $backups->store($farm);
                $this->info("{$farm->name}: {$s['name']} (".round($s['size'] / 1024)." KB)");
            }
        }
    })->purpose('Back up one farm or all farms (full ZIP kept 14 days, or --output for a one-off file)');

Artisan::command('farmos:import {file : Path to a .farmos.zip or .csv.zip backup} {--owner= : Email of the user who will own the restored farm}',
    function (\App\Domain\Backup\BackupImporter $importer) {
        $owner = \App\Models\User::where('email', $this->option('owner'))->first();
        if (! $owner) {
            return $this->error('Give --owner=<email of an existing user on this server>.');
        }
        $r = $importer->import($this->argument('file'), $owner);
        $this->info("Restored as farm #{$r['farm_id']} \"{$r['name']}\": ".array_sum($r['counts'])." rows, {$r['files']} files.");
    })->purpose('Restore a FarmOS backup as a new farm (for moving to a new server)');

Schedule::command('farmos:alerts')->hourly()->withoutOverlapping();
Schedule::command('farmos:backup --all')->dailyAt('02:30')->withoutOverlapping();
Schedule::command('farmos:prune')->daily();
