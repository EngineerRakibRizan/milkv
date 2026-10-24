<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToFarm;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Animal extends Model
{
    use BelongsToFarm, Auditable, SoftDeletes;

    protected $guarded = ['id', 'farm_id'];

    protected function casts(): array
    {
        return [
            'birth_date' => 'date:Y-m-d',
            'acquired_at' => 'date:Y-m-d',
            'status_date' => 'date:Y-m-d',
        ];
    }

    public function mother(): BelongsTo
    {
        return $this->belongsTo(Animal::class, 'mother_id');
    }

    public function calves(): HasMany
    {
        return $this->hasMany(Animal::class, 'mother_id');
    }

    public function weights(): HasMany
    {
        return $this->hasMany(AnimalWeight::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(AnimalEvent::class);
    }

    public function milkRecords(): HasMany
    {
        return $this->hasMany(MilkRecord::class);
    }

    public function treatments(): HasMany
    {
        return $this->hasMany(Treatment::class);
    }

    public function vaccinations(): HasMany
    {
        return $this->hasMany(Vaccination::class);
    }
}
