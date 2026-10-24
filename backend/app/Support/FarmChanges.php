<?php

namespace App\Support;

use App\Events\FarmDataChanged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Collects which entities a request changed. On change it bumps the farm's
 * cache version (so cached dashboards are never stale) and, after the
 * response is sent, broadcasts one realtime event, keeping socket latency
 * off the request path.
 */
final class FarmChanges
{
    private static array $pending = [];

    private static bool $hooked = false;

    public static function touch(string ...$entities): void
    {
        $farmId = app(CurrentFarm::class)->id();
        if (! $farmId) {
            return;
        }
        Cache::forever("farm:{$farmId}:v", (string) hrtime(true));
        self::$pending[$farmId] = array_merge(self::$pending[$farmId] ?? [], $entities);

        if (! self::$hooked) {
            self::$hooked = true;
            app()->terminating(fn () => self::flush());
        }
    }

    public static function version(int $farmId): string
    {
        return Cache::get("farm:{$farmId}:v", '0');
    }

    public static function flush(): void
    {
        foreach (self::$pending as $farmId => $entities) {
            try {
                broadcast(new FarmDataChanged($farmId, $entities));
            } catch (\Throwable $e) {
                Log::warning('Realtime broadcast failed: '.$e->getMessage());
            }
        }
        self::$pending = [];
        self::$hooked = false;
    }
}
