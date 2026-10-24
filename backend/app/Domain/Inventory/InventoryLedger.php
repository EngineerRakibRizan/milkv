<?php

namespace App\Domain\Inventory;

use App\Domain\Accounting\Ledger;
use App\Models\FeedItem;
use App\Models\InventoryMovement;
use App\Support\FarmChanges;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Feed & supplies stock. Stock is the sum of movements; the cached
 * stock_milli / stock_value on feed_items is updated under a row lock in the
 * same transaction. Valuation is moving weighted average cost.
 */
final class InventoryLedger
{
    /** Stock in from a purchase bill. $value is the landed cost in paisa (after discount and extra costs). */
    public function receive(FeedItem $item, int $qtyMilli, int $value, string $date, Model $source, ?string $batch = null): InventoryMovement
    {
        return DB::transaction(function () use ($item, $qtyMilli, $value, $date, $source, $batch) {
            $item = FeedItem::lockForUpdate()->findOrFail($item->id);
            $unitCost = intdiv($value * 1000 + intdiv($qtyMilli, 2), max(1, $qtyMilli));
            $movement = $this->record($item, 'purchase', $qtyMilli, $unitCost, $value, $date, source: $source, batch: $batch);
            FarmChanges::touch('inventory');

            return $movement;
        });
    }

    /**
     * Stock out at average cost: consumption, wastage or spoilage.
     * Posts DR Feed expense / Inventory loss, CR Feed inventory.
     */
    public function issue(FeedItem $item, string $type, int $qtyMilli, string $date, ?Model $target = null, ?string $notes = null): InventoryMovement
    {
        if (! in_array($type, ['consumption', 'wastage', 'spoilage'], true) || $qtyMilli <= 0) {
            throw new \InvalidArgumentException('Invalid stock issue.');
        }

        return DB::transaction(function () use ($item, $type, $qtyMilli, $date, $target, $notes) {
            $item = FeedItem::lockForUpdate()->findOrFail($item->id);
            if ($item->stock_milli < $qtyMilli) {
                throw ValidationException::withMessages([
                    'quantity' => "Only {$this->human($item->stock_milli)} {$item->unit} of {$item->name} in stock.",
                ]);
            }
            $unitCost = $this->avgCost($item);
            // Issuing everything takes the exact remaining value: no rounding residue left behind.
            $value = $qtyMilli === $item->stock_milli ? $item->stock_value : \App\Support\Units::lineAmount($qtyMilli, $unitCost);

            $movement = $this->record($item, $type, -$qtyMilli, $unitCost, -$value, $date, target: $target, notes: $notes);

            if ($value > 0) {
                $dims = ['animal_id' => $target?->getMorphClass() === 'animal' ? $target->getKey() : null,
                    'flock_id' => $target?->getMorphClass() === 'flock' ? $target->getKey() : null];
                Ledger::post($movement, $date, ucfirst($type)." — {$item->name}", [
                    ['account' => $type === 'consumption' ? 'feed_expense' : 'inventory_loss', 'debit' => $value] + $dims,
                    ['account' => 'feed_inventory', 'credit' => $value],
                ]);
            }
            FarmChanges::touch('inventory');

            return $movement;
        });
    }

    /** Opening balance or a counted correction. Positive or negative. */
    public function adjust(FeedItem $item, int $qtyMilli, string $date, ?int $unitCost = null, string $type = 'adjustment', ?string $notes = null): InventoryMovement
    {
        return DB::transaction(function () use ($item, $qtyMilli, $date, $unitCost, $type, $notes) {
            $item = FeedItem::lockForUpdate()->findOrFail($item->id);
            if ($item->stock_milli + $qtyMilli < 0) {
                throw ValidationException::withMessages(['quantity' => 'Adjustment would make stock negative.']);
            }
            $unitCost ??= $this->avgCost($item);
            $value = $qtyMilli < 0 && -$qtyMilli === $item->stock_milli ? -$item->stock_value : \App\Support\Units::lineAmount($qtyMilli, $unitCost);
            $movement = $this->record($item, $type, $qtyMilli, $unitCost, $value, $date, notes: $notes);

            if ($value !== 0) {
                // Opening stock is owner-contributed; counted corrections go through inventory loss.
                $other = $type === 'opening' ? 'owner_equity' : 'inventory_loss';
                Ledger::post($movement, $date, ucfirst($type)." — {$item->name}", $value > 0
                    ? [['account' => 'feed_inventory', 'debit' => $value], ['account' => $other, 'credit' => $value]]
                    : [['account' => $other, 'debit' => -$value], ['account' => 'feed_inventory', 'credit' => -$value]]);
            }
            FarmChanges::touch('inventory');

            return $movement;
        });
    }

    public function avgCost(FeedItem $item): int
    {
        return $item->stock_milli > 0 ? intdiv($item->stock_value * 1000 + intdiv($item->stock_milli, 2), $item->stock_milli) : 0;
    }

    private function record(FeedItem $item, string $type, int $qty, int $unitCost, int $value, string $date,
        ?Model $source = null, ?Model $target = null, ?string $batch = null, ?string $notes = null): InventoryMovement
    {
        $m = new InventoryMovement([
            'feed_item_id' => $item->id, 'date' => $date, 'type' => $type, 'qty_milli' => $qty,
            'unit_cost' => $unitCost, 'value' => $value, 'batch_no' => $batch, 'notes' => $notes, 'user_id' => auth()->id(),
        ]);
        $m->farm_id = $item->farm_id;
        if ($source) {
            $m->source()->associate($source);
        }
        if ($target) {
            $m->target()->associate($target);
        }
        $m->save();

        $item->stock_milli += $qty;
        $item->stock_value += $value;
        $item->save();

        return $m;
    }

    private function human(int $milli): string
    {
        return rtrim(rtrim(\App\Support\Units::q($milli), '0'), '.');
    }
}
