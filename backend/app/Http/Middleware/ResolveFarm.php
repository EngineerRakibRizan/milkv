<?php

namespace App\Http\Middleware;

use App\Models\Farm;
use App\Support\CurrentFarm;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the tenant from the X-Farm-Id header and verifies the user is an
 * active member. Everything after this middleware is farm-scoped.
 */
class ResolveFarm
{
    public function __construct(private CurrentFarm $current) {}

    public function handle(Request $request, Closure $next): Response
    {
        $farmId = (int) $request->header('X-Farm-Id');
        $membership = $farmId
            ? $request->user()->farms()->where('farms.id', $farmId)->wherePivot('status', 'active')->first()
            : null;

        if (! $membership) {
            return response()->json(['message' => 'Select a farm you belong to (X-Farm-Id).'], 403);
        }

        /** @var Farm $membership */
        $this->current->set($membership, $membership->pivot->role);

        return $next($request);
    }
}
