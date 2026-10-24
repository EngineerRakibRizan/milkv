<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToFarm;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Treatment extends Model
{
    use BelongsToFarm, Auditable, SoftDeletes;

    protected $guarded = ['id', 'farm_id'];

    protected function casts(): array
    {
        return [
            'date' => 'date:Y-m-d',
            'follow_up_date' => 'date:Y-m-d',
            'medications' => 'array',
        ];
    }

    public function animal(): BelongsTo
    {
        return $this->belongsTo(Animal::class);
    }

    public function flock(): BelongsTo
    {
        return $this->belongsTo(Flock::class);
    }

    public function bill(): MorphOne
    {
        return $this->morphOne(Bill::class, 'source');
    }
}
