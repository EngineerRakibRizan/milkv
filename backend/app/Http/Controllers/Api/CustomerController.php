<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\Delivery;
use App\Models\Invoice;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    public function index(Request $r)
    {
        $this->allow('customers.view');
        $q = Customer::query()
            ->when($r->boolean('archived'), fn ($q) => $q->onlyTrashed())
            ->when($r->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($r->query('area'), fn ($q, $a) => $q->where('area', $a))
            ->when($r->query('balance') === 'due', fn ($q) => $q->where('balance', '>', 0))
            ->when($r->query('balance') === 'advance', fn ($q) => $q->where('balance', '<', 0))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")
                ->orWhere('phone', 'like', "%{$s}%")->orWhere('code', 'like', "%{$s}%")))
            ->orderBy($r->query('sort') === 'balance' ? 'balance' : 'name', $r->query('sort') === 'balance' ? 'desc' : 'asc');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'customer'], [
            'areas' => Customer::whereNotNull('area')->distinct()->orderBy('area')->pluck('area'),
            'total_due' => Units::m((int) Customer::where('balance', '>', 0)->sum('balance')),
        ]);
    }

    public function show(int $id)
    {
        $this->allow('customers.view');
        $c = Customer::withTrashed()->findOrFail($id);
        $month = now()->startOfMonth()->toDateString();

        return [
            'customer' => Present::customer($c),
            'stats' => [
                'total_invoiced' => Units::m((int) Invoice::where('customer_id', $id)->where('status', '!=', 'void')->sum('total')),
                'total_paid' => Units::m((int) CustomerPayment::where('customer_id', $id)->sum('amount')),
                'month_litres' => Units::q((int) Delivery::where('customer_id', $id)->where('date', '>=', $month)->sum('delivered_ml')),
                'month_amount' => Units::m((int) Delivery::where('customer_id', $id)->where('date', '>=', $month)->sum('amount')),
            ],
            'deliveries' => Delivery::where('customer_id', $id)->orderByDesc('date')->limit(31)->get()->map([Present::class, 'delivery']),
            'payments' => CustomerPayment::where('customer_id', $id)->orderByDesc('date')->orderByDesc('id')->limit(20)->get()->map([Present::class, 'payment']),
            'open_invoices' => Invoice::where('customer_id', $id)->whereIn('status', ['unpaid', 'partial'])->orderBy('date')->get()->map([Present::class, 'invoice']),
        ];
    }

    /** Account statement: opening balance, every invoice and payment in the period, running and closing balance. */
    public function statement(Request $r, int $id)
    {
        $this->allow('customers.view');
        $d = $r->validate(['from' => 'required|date', 'to' => 'required|date|after_or_equal:from']);
        $c = Customer::withTrashed()->findOrFail($id);

        $opening = (int) Invoice::where('customer_id', $id)->where('status', '!=', 'void')->where('date', '<', $d['from'])->sum('total')
            - (int) CustomerPayment::where('customer_id', $id)->where('date', '<', $d['from'])->sum('amount');

        $rows = Invoice::where('customer_id', $id)->where('status', '!=', 'void')->whereBetween('date', [$d['from'], $d['to']])->get()
            ->map(fn ($i) => ['date' => $i->date->toDateString(), 'type' => 'invoice', 'ref' => $i->number, 'description' => $i->description ?? $i->category, 'debit' => $i->total, 'credit' => 0, 'id' => $i->id])
            ->concat(CustomerPayment::where('customer_id', $id)->whereBetween('date', [$d['from'], $d['to']])->get()
                ->map(fn ($p) => ['date' => $p->date->toDateString(), 'type' => 'payment', 'ref' => $p->reference ?? 'PAY-'.$p->id, 'description' => 'Payment ('.$p->method.')', 'debit' => 0, 'credit' => $p->amount, 'id' => $p->id]))
            ->sortBy([['date', 'asc'], ['type', 'asc']])->values();

        $running = $opening;
        $lines = $rows->map(function ($row) use (&$running) {
            $running += $row['debit'] - $row['credit'];

            return [...$row, 'debit' => Units::m($row['debit']), 'credit' => Units::m($row['credit']), 'balance' => Units::m($running)];
        });

        return [
            'customer' => Present::customer($c), 'from' => $d['from'], 'to' => $d['to'],
            'opening' => Units::m($opening), 'lines' => $lines,
            'total_debit' => Units::m((int) $rows->sum('debit')), 'total_credit' => Units::m((int) $rows->sum('credit')),
            'closing' => Units::m($running),
        ];
    }

    public function store(Request $r)
    {
        $this->allow('customers.create');
        $d = $this->convert($this->validated($r), ['price'], ['default_qty' => 'default_qty_ml']);
        $d['code'] ??= 'C-'.str_pad((string) (Customer::withTrashed()->count() + 1), 4, '0', STR_PAD_LEFT);
        $d['joined_at'] ??= now()->toDateString();
        $c = Customer::create($d)->refresh();
        FarmChanges::touch('customers');

        return response()->json(Present::customer($c), 201);
    }

    public function update(Request $r, Customer $customer)
    {
        $this->allow('customers.update');
        $customer->update($this->convert($this->validated($r, $customer), ['price'], ['default_qty' => 'default_qty_ml']));
        FarmChanges::touch('customers');

        return Present::customer($customer);
    }

    public function destroy(Customer $customer)
    {
        $this->allow('customers.archive');
        $customer->update(['status' => 'inactive']);
        $customer->delete();
        FarmChanges::touch('customers');

        return response()->noContent();
    }

    private function validated(Request $r, ?Customer $c = null): array
    {
        $farm = $this->current()->id();

        return $r->validate([
            'code' => ['nullable', 'string', 'max:30', Rule::unique('customers')->where('farm_id', $farm)->ignore($c?->id)],
            'name' => 'required|string|max:120',
            // Bangladesh-friendly: 01XXXXXXXXX or +8801XXXXXXXXX, but any international number is accepted.
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^\+?[0-9 \-]{6,20}$/'],
            'alt_phone' => ['nullable', 'string', 'max:20', 'regex:/^\+?[0-9 \-]{6,20}$/'],
            'address' => 'nullable|string|max:255', 'area' => 'nullable|string|max:80',
            'type' => 'required|in:household,shop,restaurant,wholesale',
            'default_qty' => 'nullable|numeric|min:0|max:1000', 'price' => 'nullable|numeric|min:0',
            'schedule' => 'required|in:daily,alternate,weekly,on_demand',
            'payment_terms' => 'required|in:daily,weekly,monthly,advance',
            'employee_id' => ['nullable', 'integer', Rule::exists('employees', 'id')->where('farm_id', $farm)],
            'status' => 'required|in:active,paused,inactive',
            'joined_at' => 'nullable|date', 'notes' => 'nullable|string|max:2000',
        ]);
    }
}
