<?php

namespace App\Http\Controllers\Api;

use App\Domain\Sales\DeliveryService;
use App\Domain\Sales\SalesService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\Delivery;
use App\Models\Invoice;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Deliveries, invoices and customer payments. */
class SalesController extends Controller
{
    public function __construct(private DeliveryService $deliveries, private SalesService $sales) {}

    public function deliveries(Request $r)
    {
        $this->allow('deliveries.view');
        $date = $r->query('date', today()->toDateString());
        $q = Delivery::with(['customer:id,name,phone,area,address,balance', 'employee:id,name'])
            ->when($r->query('from'), fn ($q, $f) => $q->whereBetween('date', [$f, $r->query('to', $f)]), fn ($q) => $q->where('date', $date))
            ->when($r->query('status'), fn ($q, $s) => $q->whereIn('status', explode(',', $s)))
            ->when($r->query('customer_id'), fn ($q, $c) => $q->where('customer_id', $c))
            ->when($r->query('employee_id'), fn ($q, $e) => $q->where('employee_id', $e));
        // Delivery staff only see their own route.
        if ($this->current()->role() === 'delivery') {
            $employeeId = \App\Models\Employee::where('user_id', $r->user()->id)->value('id');
            $q->where('employee_id', $employeeId ?? 0);
        }
        $rows = $q->join('customers', 'customers.id', '=', 'deliveries.customer_id')
            ->orderBy('deliveries.date', 'desc')->orderBy('customers.area')->orderBy('customers.name')->select('deliveries.*')->get();

        return [
            'data' => $rows->map([Present::class, 'delivery']),
            'summary' => [
                'ordered' => Units::q((int) $rows->where('status', '!=', 'cancelled')->sum('ordered_ml')),
                'delivered' => Units::q((int) $rows->sum('delivered_ml')),
                'amount' => Units::m((int) $rows->sum('amount')),
                'by_status' => $rows->countBy('status'),
            ],
        ];
    }

    public function generate(Request $r)
    {
        $this->allow('deliveries.create');
        $d = $r->validate(['date' => 'required|date']);

        return ['created' => $this->deliveries->generateForDate($d['date'])];
    }

    public function storeDelivery(Request $r)
    {
        $this->allow('deliveries.create');
        $farm = $this->current();
        $d = $r->validate([
            'customer_id' => ['required', 'integer', Rule::exists('customers', 'id')->where('farm_id', $farm->id())],
            'date' => 'required|date', 'quantity' => 'required|numeric|gt:0|max:1000',
            'unit_price' => 'nullable|numeric|min:0', 'discount' => 'nullable|numeric|min:0',
            'employee_id' => ['nullable', 'integer', Rule::exists('employees', 'id')->where('farm_id', $farm->id())],
            'notes' => 'nullable|string|max:255',
        ]);
        $customer = Customer::findOrFail($d['customer_id']);
        abort_if(Delivery::where('customer_id', $customer->id)->where('date', $d['date'])->exists(), 422,
            'This customer already has a delivery on that date; edit it instead.');
        $delivery = Delivery::create([
            'customer_id' => $customer->id, 'date' => $d['date'], 'ordered_ml' => Units::qty($d['quantity']),
            'unit_price' => isset($d['unit_price']) ? Units::money($d['unit_price']) : ($customer->price ?? $farm->farm()->default_milk_price),
            'discount' => Units::money($d['discount'] ?? 0), 'employee_id' => $d['employee_id'] ?? $customer->employee_id,
            'status' => 'pending', 'notes' => $d['notes'] ?? null,
        ]);
        FarmChanges::touch('deliveries');

        return response()->json(Present::delivery($delivery->refresh()->load('customer', 'employee')), 201);
    }

    /** Status change (one tap on mobile). Delivered/partial atomically posts stock + invoice (+ optional cash collected). */
    public function updateDelivery(Request $r, Delivery $delivery)
    {
        $this->allow('deliveries.update');
        $d = $r->validate([
            'status' => ['required', Rule::in(DeliveryService::STATUSES)],
            'delivered' => 'nullable|numeric|gt:0|max:1000',
            'ordered' => 'nullable|numeric|gt:0|max:1000',
            'unit_price' => 'nullable|numeric|min:0',
            'collected' => 'nullable|numeric|gt:0',
            'method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
            'notes' => 'nullable|string|max:255',
        ]);
        // Price/quantity edits only before the sale is posted.
        if (! in_array($delivery->status, ['delivered', 'partial'], true)) {
            $patch = array_filter([
                'ordered_ml' => isset($d['ordered']) ? Units::qty($d['ordered']) : null,
                'unit_price' => isset($d['unit_price']) && $this->current()->can('deliveries.price') ? Units::money($d['unit_price']) : null,
                'notes' => $d['notes'] ?? null,
            ], fn ($v) => $v !== null);
            if ($patch) {
                $delivery->update($patch);
            }
        }
        $result = $this->deliveries->transition($delivery, $d['status'],
            isset($d['delivered']) ? Units::qty($d['delivered']) : null,
            isset($d['collected']) ? Units::money($d['collected']) : null, $d['method'] ?? 'cash');

        return Present::delivery($result->load('customer', 'employee'));
    }

    public function invoices(Request $r)
    {
        $this->allow('invoices.view');
        $q = Invoice::with('customer:id,name')
            ->when($r->query('customer_id'), fn ($q, $c) => $q->where('customer_id', $c))
            ->when($r->query('status'), fn ($q, $s) => $q->whereIn('status', explode(',', $s)))
            ->when($r->query('category'), fn ($q, $c) => $q->where('category', $c))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('number', 'like', "%{$s}%")->orWhere('description', 'like', "%{$s}%")))
            ->orderByDesc('date')->orderByDesc('id');
        // Totals run on the base query: no eager loads or model hydration needed.
        $totals = (clone $q)->reorder()->toBase()->where('status', '!=', 'void')->selectRaw('COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid')->first();

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'invoice'], [
            'totals' => ['total' => Units::m((int) $totals->total), 'paid' => Units::m((int) $totals->paid), 'due' => Units::m((int) $totals->total - (int) $totals->paid)],
        ]);
    }

    public function showInvoice(Invoice $invoice)
    {
        $this->allow('invoices.view');

        return Present::invoice($invoice->load('customer', 'items'));
    }

    /** Manual sale: eggs, manure, other income. Milk deliveries and animal sales create their own invoices. */
    public function storeInvoice(Request $r)
    {
        $this->allow('invoices.create');
        $farm = $this->current()->id();
        $d = $r->validate([
            'customer_id' => ['nullable', 'integer', Rule::exists('customers', 'id')->where('farm_id', $farm)],
            'date' => 'required|date', 'due_date' => 'nullable|date|after_or_equal:date',
            'category' => ['required', Rule::exists('accounts', 'key')->where('farm_id', $farm)->where('type', 'revenue'), 'not_in:milk_sales,animal_sales'],
            'description' => 'nullable|string|max:255', 'discount' => 'nullable|numeric|min:0', 'notes' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:50', 'items.*.description' => 'required|string|max:255',
            'items.*.quantity' => 'required|numeric|gt:0', 'items.*.unit_price' => 'required|numeric|min:0',
            'paid_method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
        ]);
        $customer = isset($d['customer_id']) ? Customer::findOrFail($d['customer_id']) : null;
        abort_if(! $customer && empty($d['paid_method']), 422, 'A sale without a customer must be paid immediately.');
        $items = array_map(fn ($i) => ['description' => $i['description'], 'qty_milli' => Units::qty($i['quantity']), 'unit_price' => Units::money($i['unit_price'])], $d['items']);

        $invoice = DB::transaction(function () use ($customer, $d, $items) {
            $invoice = $this->sales->createInvoice($customer, $d['date'], $d['category'], $items, Units::money($d['discount'] ?? 0),
                description: $d['description'] ?? null, notes: $d['notes'] ?? null, dueDate: $d['due_date'] ?? null);
            if (! empty($d['paid_method'])) {
                $this->sales->settleNow($invoice, $d['paid_method'], $d['date']);
            }

            return $invoice;
        });

        return response()->json(Present::invoice($invoice->fresh()->load('customer', 'items')), 201);
    }

    public function voidInvoice(Request $r, Invoice $invoice)
    {
        $this->allow('invoices.void');
        abort_if($invoice->source_type === 'delivery', 422, 'Change the delivery instead; its invoice follows automatically.');
        $this->sales->voidInvoice($invoice, $r->input('reason', 'Voided'));

        return Present::invoice($invoice->fresh());
    }

    public function payments(Request $r)
    {
        $this->allow('payments.view');
        $q = CustomerPayment::with('customer:id,name')
            ->when($r->query('customer_id'), fn ($q, $c) => $q->where('customer_id', $c))
            ->when($r->query('method'), fn ($q, $m) => $q->where('method', $m))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->orderByDesc('date')->orderByDesc('id');
        $total = (clone $q)->reorder()->toBase()->sum('amount');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'payment'], ['total' => Units::m((int) $total)]);
    }

    public function storePayment(Request $r)
    {
        $this->allow('payments.create');
        $farm = $this->current()->id();
        $d = $r->validate([
            'customer_id' => ['required', 'integer', Rule::exists('customers', 'id')->where('farm_id', $farm)],
            'date' => 'required|date|before_or_equal:today', 'amount' => 'required|numeric|gt:0',
            'method' => ['required', Rule::in(config('farmos.payment_methods'))],
            'reference' => 'nullable|string|max:100', 'notes' => 'nullable|string|max:255',
            'allocations' => 'nullable|array', 'allocations.*.invoice_id' => 'required|integer', 'allocations.*.amount' => 'required|numeric|gt:0',
        ]);
        $allocations = isset($d['allocations'])
            ? collect($d['allocations'])->mapWithKeys(fn ($a) => [$a['invoice_id'] => Units::money($a['amount'])])->all() : null;
        $p = $this->sales->receivePayment(Customer::findOrFail($d['customer_id']), Units::money($d['amount']), $d['date'], $d['method'],
            $d['reference'] ?? null, $d['notes'] ?? null, $allocations);

        return response()->json(Present::payment($p->load('customer')), 201);
    }
}
