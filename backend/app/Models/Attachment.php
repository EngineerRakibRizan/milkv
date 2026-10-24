<?php

namespace App\Models;

use App\Models\Concerns\BelongsToFarm;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class Attachment extends Model
{
    use BelongsToFarm;

    protected $guarded = ['id', 'farm_id'];

    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }
}
