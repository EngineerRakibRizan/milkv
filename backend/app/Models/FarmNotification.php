<?php

namespace App\Models;

use App\Models\Concerns\BelongsToFarm;
use Illuminate\Database\Eloquent\Model;

class FarmNotification extends Model
{
    use BelongsToFarm;

    protected $guarded = ['id', 'farm_id'];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
        ];
    }
}
