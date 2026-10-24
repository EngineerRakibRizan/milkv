<?php

use App\Support\CurrentFarm;
use Illuminate\Support\Facades\Broadcast;

// A user may listen to a farm's change feed only for the farm resolved
// (and membership-checked) by the ResolveFarm middleware.
Broadcast::channel('farm.{farmId}', function ($user, int $farmId) {
    return app(CurrentFarm::class)->id() === $farmId;
});
