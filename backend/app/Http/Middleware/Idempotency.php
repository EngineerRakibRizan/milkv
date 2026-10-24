<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replay-safe writes. The first response to (user, Idempotency-Key) is stored
 * and returned verbatim for any retry: double taps, network retries and the
 * offline outbox can never create a second record.
 */
class Idempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        if ($request->isMethodSafe() || ! $key || ! $request->user()) {
            return $next($request);
        }
        $key = substr($key, 0, 100);
        $userId = $request->user()->id;

        if ($hit = $this->find($userId, $key)) {
            return $this->replay($hit);
        }

        // Serialize concurrent duplicates (two taps arriving together).
        $lock = Cache::lock("idem:{$userId}:{$key}", 30);
        if (! $lock->block(10)) {
            return response()->json(['message' => 'Duplicate request in progress.'], 409);
        }

        try {
            if ($hit = $this->find($userId, $key)) {
                return $this->replay($hit);
            }
            $response = $next($request);
            // Only remember outcomes that changed state; let validation errors be retried.
            if ($response->getStatusCode() < 400) {
                DB::table('idempotency_keys')->insertOrIgnore([
                    'user_id' => $userId,
                    'key' => $key,
                    'method' => $request->method(),
                    'path' => substr($request->path(), 0, 255),
                    'status' => $response->getStatusCode(),
                    'response' => $response->getContent(),
                    'created_at' => now(),
                ]);
            }

            return $response;
        } finally {
            $lock->release();
        }
    }

    private function find(int $userId, string $key): ?object
    {
        return DB::table('idempotency_keys')->where('user_id', $userId)->where('key', $key)
            ->where('created_at', '>', now()->subDay())->first();
    }

    private function replay(object $hit): Response
    {
        return response($hit->response, $hit->status, ['Content-Type' => 'application/json', 'Idempotent-Replayed' => 'true']);
    }
}
