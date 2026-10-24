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

Schedule::command('farmos:alerts')->hourly()->withoutOverlapping();
Schedule::command('farmos:prune')->daily();
