<?php

namespace App\Http\Controllers\Api;

use App\Domain\Inventory\InventoryLedger;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Animal;
use App\Models\FeedItem;
use App\Models\Flock;
use App\Models\InventoryMovement;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function __construct(private InventoryLedger $ledger) {}

    public function index(Request $r)
    {
        $this->allow('inventory.view');
        $items = FeedItem::query()
            ->when($r->query('category'), fn ($q, $c) => $q->where('category', $c))
            ->when($r->boolean('low'), fn ($q) => $q->where('min_stock_milli', '>', 0)->whereColumn('stock_milli', '<=', 'min_stock_milli'))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('sku', 'like', "%{$s}%")))
            ->orderBy('name')->get();

        return ['data' => $items->map([Present::class, 'feedItem']), 'total_value' => Units::m((int) $items->sum('stock_value'))];
    }

    public function store(Request $r)
    {
        $this->allow('inventory.create');
        $d = $this->validated($r);
        $opening = $r->validate(['opening_stock' => 'nullable|numeric|min:0', 'opening_cost' => 'nullable|numeric|min:0']);
        $d = $this->convert($d, [], ['min_stock' => 'min_stock_milli']);

        $item = DB::transaction(function () use ($d, $opening) {
            $item = FeedItem::create($d);
            if (! empty($opening['opening_stock'])) {
                $this->ledger->adjust($item, Units::qty($opening['opening_stock']), now()->toDateString(),
                    Units::money($opening['opening_cost'] ?? 0), 'opening', 'Opening stock');
            }

            return $item->fresh();
        });
        FarmChanges::touch('inventory');

        return response()->json(Present::feedItem($item), 201);
    }

    public function update(Request $r, FeedItem $feedItem)
    {
        $this->allow('inventory.update');
        $feedItem->update($this->convert($this->validated($r, $feedItem), [], ['min_stock' => 'min_stock_milli']));
        FarmChanges::touch('inventory');

        return Present::feedItem($feedItem);
    }

    public function movements(Request $r)
    {
        $this->allow('inventory.view');
        $q = InventoryMovement::with(['feedItem:id,name,unit', 'target'])
            ->when($r->query('feed_item_id'), fn ($q, $id) => $q->where('feed_item_id', $id))
            ->when($r->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->orderByDesc('date')->orderByDesc('id');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'movement']);
    }

    /** Feed consumption, wastage or spoilage. Several lines at once for quick daily entry. */
    public function issue(Request $r)
    {
        $this->allow('inventory.consume');
        $farm = $this->current()->id();
        $d = $r->validate([
            'date' => 'required|date|before_or_equal:today',
            'type' => 'required|in:consumption,wastage,spoilage',
            'lines' => 'required|array|min:1|max:50',
            'lines.*.feed_item_id' => ['required', 'integer', Rule::exists('feed_items', 'id')->where('farm_id', $farm)],
            'lines.*.quantity' => 'required|numeric|gt:0',
            'lines.*.target_type' => 'nullable|in:animal,flock',
            'lines.*.target_id' => 'nullable|integer',
            'lines.*.notes' => 'nullable|string|max:255',
        ]);

        $out = DB::transaction(fn () => collect($d['lines'])->map(function ($l) use ($d) {
            $target = match ($l['target_type'] ?? null) {
                'animal' => Animal::findOrFail($l['target_id']),
                'flock' => Flock::findOrFail($l['target_id']),
                default => null,
            };

            return $this->ledger->issue(FeedItem::findOrFail($l['feed_item_id']), $d['type'], Units::qty($l['quantity']), $d['date'], $target, $l['notes'] ?? null);
        }));

        return response()->json(['count' => $out->count()], 201);
    }

    public function adjust(Request $r, FeedItem $feedItem)
    {
        $this->allow('inventory.adjust');
        $d = $r->validate(['date' => 'required|date|before_or_equal:today', 'counted' => 'required|numeric|min:0', 'notes' => 'required|string|max:255']);
        $diff = Units::qty($d['counted']) - $feedItem->stock_milli;
        if ($diff !== 0) {
            $this->ledger->adjust($feedItem, $diff, $d['date'], notes: $d['notes']);
        }

        return Present::feedItem($feedItem->fresh());
    }

    private function validated(Request $r, ?FeedItem $f = null): array
    {
        return $r->validate([
            'sku' => ['required', 'string', 'max:40', Rule::unique('feed_items')->where('farm_id', $this->current()->id())->ignore($f?->id)],
            'name' => 'required|string|max:120',
            'category' => ['required', Rule::in(config('farmos.feed_categories'))],
            'unit' => ['required', Rule::in(config('farmos.units')), function ($attr, $val, $fail) use ($f) {
                if ($f && $f->unit !== $val && $f->stock_milli !== 0) {
                    $fail('The unit cannot change while the item has stock.');
                }
            }],
            'min_stock' => 'nullable|numeric|min:0',
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('farm_id', $this->current()->id())],
            'location' => 'nullable|string|max:120',
            'expires_at' => 'nullable|date',
            'notes' => 'nullable|string|max:1000',
        ]);
    }
}
