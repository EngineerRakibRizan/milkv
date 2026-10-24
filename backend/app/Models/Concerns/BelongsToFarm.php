<?php

namespace App\Models\Concerns;

use App\Models\Farm;
use App\Support\CurrentFarm;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tenant isolation. Every query on a farm-owned model is constrained to the
 * request's farm, and new rows get that farm_id automatically. A request can
 * therefore never read or write another farm's rows, even with a guessed id.
 */
trait BelongsToFarm
{
    public static function bootBelongsToFarm(): void
    {
        static::addGlobalScope('farm', function (Builder $query) {
            $current = app(CurrentFarm::class);
            if ($current->has()) {
                $query->where($query->getModel()->getTable().'.farm_id', $current->id());
            }
        });

        static::creating(function ($model) {
            $current = app(CurrentFarm::class);
            if (! $model->farm_id && $current->has()) {
                $model->farm_id = $current->id();
            }
            if (! $model->farm_id) {
                throw new \LogicException('Cannot create '.static::class.' without a farm.');
            }
        });
    }

    public function farm(): BelongsTo
    {
        return $this->belongsTo(Farm::class);
    }
}
