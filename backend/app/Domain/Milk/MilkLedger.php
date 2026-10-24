<?php

namespace App\Domain\Milk;

use App\Models\Animal;
use App\Models\MilkMovement;
use App\Models\MilkRecord;
use App\Support\FarmChanges;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Milk stock = Σ milk_movements (production +, internal use −, spoilage −,
 * delivery −). Every outflow is checked against the available stock under a
 * farm-wide lock, so the same litre can never be sold twice.
 */
final class MilkLedger
{
    public function available(): int
    {
        return (int) MilkMovement::sum('qty_ml');
    }

    /**
     * Upsert one cow's milking for a day and keep its production movement in sync.
     * Lowering a record is refused if that milk has already left the stock.
     */
    public function recordProduction(Animal $animal, string $date, int $morning, int $evening, int $other, ?string $notes = null): MilkRecord
    {
        return $this->locked(function () use ($animal, $date, $morning, $evening, $other, $notes) {
            if ($animal->status !== 'active' || $animal->gender !== 'female') {
                throw ValidationException::withMessages(['animal_id' => "{$animal->tag} is not an active female animal."]);
            }
            $record = MilkRecord::firstOrNew(['animal_id' => $animal->id, 'date' => $date]);
            $before = (int) $record->total_ml;
            $total = $morning + $evening + $other;
            if ($total < $before && $this->available() - ($before - $total) < 0) {
                throw ValidationException::withMessages(['total' => 'This milk has already been delivered or used; record the difference as an adjustment instead.']);
            }
            $record->fill(['morning_ml' => $morning, 'evening_ml' => $evening, 'other_ml' => $other,
                'total_ml' => $total, 'notes' => $notes, 'user_id' => $record->user_id ?? auth()->id()]);
            $record->save();

            if ($total === 0) {
                MilkMovement::where('source_type', 'milk_record')->where('source_id', $record->id)->delete();
            } else {
                $m = MilkMovement::firstOrNew(['source_type' => 'milk_record', 'source_id' => $record->id, 'type' => 'production']);
                $m->fill(['date' => $date, 'qty_ml' => $total, 'user_id' => auth()->id()]);
                $m->save();
            }
            FarmChanges::touch('milk');

            return $record;
        });
    }

    /** Internal use, spoilage or a counted adjustment (negative only for outflows). */
    public function out(string $type, int $qtyMl, string $date, ?Model $source = null, ?string $notes = null): MilkMovement
    {
        return $this->locked(function () use ($type, $qtyMl, $date, $source, $notes) {
            $available = $this->available();
            if ($qtyMl > $available) {
                throw ValidationException::withMessages([
                    'quantity' => sprintf('Only %s L of milk is available.', rtrim(rtrim(number_format($available / 1000, 3, '.', ''), '0'), '.')),
                ]);
            }
            $m = new MilkMovement(['date' => $date, 'type' => $type, 'qty_ml' => -$qtyMl, 'notes' => $notes, 'user_id' => auth()->id()]);
            if ($source) {
                $m->source()->associate($source);
            }
            $m->save();
            FarmChanges::touch('milk');

            return $m;
        });
    }

    /** Releases a delivery's stock movement (cancellation / quantity correction). */
    public function release(Model $source): void
    {
        MilkMovement::where('source_type', $source->getMorphClass())->where('source_id', $source->getKey())->delete();
        FarmChanges::touch('milk');
    }

    /**
     * Run under a per-farm lock. Postgres row locks can't guard a SUM, so a
     * cache lock (Redis in production) serializes milk stock changes per farm.
     */
    public function locked(callable $fn): mixed
    {
        // Re-entrant: callers (e.g. delivery confirmation) hold the lock across
        // their whole transaction so it is released only after commit.
        if (self::$depth > 0) {
            return DB::transaction($fn);
        }
        $farmId = app(\App\Support\CurrentFarm::class)->id();

        return Cache::lock("milk-stock:{$farmId}", 15)->block(10, function () use ($fn) {
            self::$depth++;
            try {
                return DB::transaction($fn);
            } finally {
                self::$depth--;
            }
        });
    }

    private static int $depth = 0;
}
