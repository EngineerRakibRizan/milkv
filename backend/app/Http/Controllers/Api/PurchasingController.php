<?php

namespace App\Http\Controllers\Api;

use App\Domain\Purchasing\PurchasingService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Bill;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Suppliers, bills (purchases & expenses) and supplier payments. */
class PurchasingController extends Controller
{
    public function __construct(private PurchasingService $service) {}

    public function suppliers(Request $r)
    {
        $this->allow('suppliers.view');

        return Supplier::query()
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")))
            ->orderBy('name')->get()->map([Present::class, 'supplier']);
    }

    public function showSupplier(int $id)
    {
        $this->allow('suppliers.view');
        $s = Supplier::withTrashed()->findOrFail($id);

        return [
            'supplier' => Present::supplier($s),
            'bills' => Bill::where('supplier_id', $id)->orderByDesc('date')->limit(50)->get()->map([Present::class, 'bill']),
            'payments' => SupplierPayment::where('supplier_id', $id)->orderByDesc('date')->limit(50)->get()
                ->map(fn ($p) => ['id' => $p->id, 'date' => $p->date->toDateString(), 'amount' => Units::m($p->amount), 'method' => $p->method, 'reference' => $p->reference]),
        ];
    }

    public function storeSupplier(Request $r)
    {
        $this->allow('suppliers.create');
        $s = Supplier::create($this->supplierData($r))->refresh();
        FarmChanges::touch('suppliers');

        return response()->json(Present::supplier($s), 201);
    }

    public function updateSupplier(Request $r, Supplier $supplier)
    {
        $this->allow('suppliers.update');
        $supplier->update($this->supplierData($r));
        FarmChanges::touch('suppliers');

        return Present::supplier($supplier);
    }

    public function bills(Request $r)
    {
        $this->allow('bills.view');
        $q = Bill::with('supplier:id,name')
            ->when($r->query('kind'), fn ($q, $k) => $q->where('kind', $k))
            ->when($r->query('category'), fn ($q, $c) => $q->where('category', $c))
            ->when($r->query('status'), fn ($q, $s) => $q->whereIn('status', explode(',', $s)))
            ->when($r->query('supplier_id'), fn ($q, $s) => $q->where('supplier_id', $s))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('number', 'like', "%{$s}%")->orWhere('description', 'like', "%{$s}%")))
            ->orderByDesc('date')->orderByDesc('id');
        $totals = (clone $q)->reorder()->toBase()->where('status', '!=', 'void')->selectRaw('COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid')->first();

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'bill'], [
            'totals' => ['total' => Units::m((int) $totals->total), 'paid' => Units::m((int) $totals->paid), 'due' => Units::m((int) $totals->total - (int) $totals->paid)],
        ]);
    }

    public function showBill(Bill $bill)
    {
        $this->allow('bills.view');

        return Present::bill($bill->load('supplier', 'items'));
    }

    /**
     * kind=purchase: lines are inventory items (stock goes up at landed cost).
     * kind=expense:  one or more lines against an expense category.
     * kind=asset:    capital purchases (equipment, buildings).
     */
    public function storeBill(Request $r)
    {
        $this->allow('bills.create');
        $farm = $this->current()->id();
        $d = $r->validate([
            'kind' => 'required|in:purchase,expense,asset',
            'category' => 'required_unless:kind,purchase|nullable|string|max:40',
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('farm_id', $farm)],
            'date' => 'required|date|before_or_equal:today', 'due_date' => 'nullable|date|after_or_equal:date',
            'description' => 'nullable|string|max:255', 'notes' => 'nullable|string|max:1000',
            'discount' => 'nullable|numeric|min:0', 'extra_cost' => 'nullable|numeric|min:0',
            'related_type' => 'nullable|in:animal,flock', 'related_id' => 'nullable|integer|required_with:related_type',
            'items' => 'required|array|min:1|max:50',
            'items.*.feed_item_id' => ['nullable', 'required_if:kind,purchase', 'integer', Rule::exists('feed_items', 'id')->where('farm_id', $farm)],
            'items.*.description' => 'nullable|string|max:255',
            'items.*.quantity' => 'required|numeric|gt:0', 'items.*.unit_price' => 'required|numeric|min:0',
            'paid' => 'nullable|boolean', 'paid_amount' => 'nullable|numeric|gt:0',
            'method' => ['nullable', 'required_if:paid,true', Rule::in(config('farmos.payment_methods'))],
        ]);
        if (! empty($d['related_type'])) {
            $model = $d['related_type'] === 'animal' ? \App\Models\Animal::class : \App\Models\Flock::class;
            $model::findOrFail($d['related_id']); // farm-scoped existence check
        }
        $feedNames = \App\Models\FeedItem::whereIn('id', array_filter(array_column($d['items'], 'feed_item_id')))->pluck('name', 'id');
        $items = array_map(fn ($i) => [
            'description' => $i['description'] ?? ($feedNames[$i['feed_item_id'] ?? 0] ?? 'Item'),
            'feed_item_id' => $i['feed_item_id'] ?? null,
            'qty_milli' => Units::qty($i['quantity']), 'unit_price' => Units::money($i['unit_price']),
        ], $d['items']);
        $data = $this->convert($d, ['discount', 'extra_cost']);
        $payNow = ! empty($d['paid']) ? array_filter(['method' => $d['method'], 'amount' => isset($d['paid_amount']) ? Units::money($d['paid_amount']) : null]) : null;

        $bill = $this->service->createBill($data, $items, $payNow);

        return response()->json(Present::bill($bill->load('supplier')), 201);
    }

    public function voidBill(Bill $bill)
    {
        $this->allow('bills.void');
        abort_if($bill->source_type !== null, 422, 'This expense is linked to a record; edit that record instead.');
        $this->service->voidBill($bill);

        return Present::bill($bill->fresh());
    }

    public function storePayment(Request $r)
    {
        $this->allow('bills.pay');
        $farm = $this->current()->id();
        $d = $r->validate([
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('farm_id', $farm)],
            'bill_id' => ['nullable', 'integer', Rule::exists('bills', 'id')->where('farm_id', $farm)],
            'date' => 'required|date|before_or_equal:today', 'amount' => 'required|numeric|gt:0',
            'method' => ['required', Rule::in(config('farmos.payment_methods'))],
            'reference' => 'nullable|string|max:100', 'notes' => 'nullable|string|max:255',
        ]);
        $bill = isset($d['bill_id']) ? Bill::findOrFail($d['bill_id']) : null;
        $supplierId = $bill?->supplier_id ?? $d['supplier_id'] ?? null;
        abort_if(! $supplierId && ! $bill, 422, 'Choose a supplier or a bill.');
        $amount = Units::money($d['amount']);

        $p = $this->service->paySupplier($supplierId ? Supplier::findOrFail($supplierId) : null, $amount, $d['date'], $d['method'],
            $d['reference'] ?? null, $d['notes'] ?? null, $bill ? [$bill->id => min($amount, $bill->total - $bill->paid)] : null);

        return response()->json(['id' => $p->id, 'amount' => Units::m($p->amount), 'unallocated' => Units::m($p->unallocated)], 201);
    }

    private function supplierData(Request $r): array
    {
        return $r->validate([
            'name' => 'required|string|max:120', 'phone' => ['nullable', 'string', 'max:20', 'regex:/^\+?[0-9 \-]{6,20}$/'],
            'address' => 'nullable|string|max:255', 'type' => 'nullable|in:feed,medicine,equipment,animals,services,other',
            'notes' => 'nullable|string|max:1000',
        ]);
    }
}
