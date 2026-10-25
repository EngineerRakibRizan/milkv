<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Customer;
use App\Models\Lead;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Staff side of the landing-page enquiries: follow up, then convert to a customer. */
class LeadController extends Controller
{
    public function index(Request $r)
    {
        $this->allow('leads.view');
        $q = Lead::query()
            ->when($r->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")
                ->orWhere('phone', 'like', "%{$s}%")->orWhere('area', 'like', "%{$s}%")))
            ->latest('id');

        return Present::page($q->paginate($this->perPage($r)), [self::class, 'present'], [
            'counts' => Lead::selectRaw('status, COUNT(*) as n')->groupBy('status')->pluck('n', 'status'),
        ]);
    }

    public function update(Request $r, Lead $lead)
    {
        $this->allow('leads.update');
        $d = $r->validate(['status' => 'sometimes|in:new,contacted,lost', 'notes' => 'nullable|string|max:2000']);
        if (($d['status'] ?? null) === 'contacted' && ! $lead->contacted_at) {
            $d['contacted_at'] = now();
        }
        abort_if($lead->status === 'converted', 422, 'This lead is already a customer.');
        $lead->update($d);
        FarmChanges::touch('leads');

        return self::present($lead);
    }

    /** Creates the customer from the enquiry (staff can adjust the details) and links it. */
    public function toCustomer(Request $r, Lead $lead)
    {
        $this->allow('customers.create');
        abort_if($lead->status === 'converted', 422, 'This lead is already a customer.');
        $d = $r->validate([
            'name' => 'required|string|max:120', 'phone' => ['nullable', 'string', 'max:20'],
            'area' => 'nullable|string|max:80', 'address' => 'nullable|string|max:255',
            'default_qty' => 'nullable|numeric|min:0|max:1000', 'price' => 'nullable|numeric|min:0',
            'schedule' => 'required|in:daily,alternate,weekly,on_demand',
            'employee_id' => ['nullable', 'integer', Rule::exists('employees', 'id')->where('farm_id', $this->current()->id())],
        ]);

        $customer = DB::transaction(function () use ($d, $lead) {
            $customer = Customer::create([
                'code' => 'C-'.str_pad((string) (Customer::withTrashed()->count() + 1), 4, '0', STR_PAD_LEFT),
                'name' => $d['name'], 'phone' => $d['phone'] ?? $lead->phone, 'area' => $d['area'] ?? null, 'address' => $d['address'] ?? null,
                'default_qty_ml' => isset($d['default_qty']) ? Units::qty($d['default_qty']) : 0,
                'price' => isset($d['price']) ? Units::money($d['price']) : null, 'schedule' => $d['schedule'],
                'payment_terms' => 'monthly', 'employee_id' => $d['employee_id'] ?? null, 'status' => 'active',
                'joined_at' => ($lead->start_date ?? now())->toDateString(),
                'notes' => trim("From website enquiry #{$lead->id}. ".($lead->message ?? '')),
            ]);
            $lead->update(['status' => 'converted', 'customer_id' => $customer->id, 'contacted_at' => $lead->contacted_at ?? now()]);

            return $customer;
        });
        FarmChanges::touch('leads', 'customers');

        return response()->json(['lead' => self::present($lead->fresh()), 'customer_id' => $customer->id], 201);
    }

    public static function present(Lead $l): array
    {
        return [
            'id' => $l->id, 'name' => $l->name, 'phone' => $l->phone, 'area' => $l->area, 'address' => $l->address,
            'quantity' => Units::q($l->qty_ml), 'start_date' => $l->start_date?->toDateString(), 'message' => $l->message,
            'source' => $l->source, 'status' => $l->status, 'notes' => $l->notes, 'customer_id' => $l->customer_id,
            'created_at' => $l->created_at->toIso8601String(), 'contacted_at' => $l->contacted_at?->toIso8601String(),
        ];
    }
}
