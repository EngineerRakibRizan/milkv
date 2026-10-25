<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farm;
use App\Models\FarmNotification;
use App\Models\Lead;
use App\Support\CurrentFarm;
use App\Support\FarmChanges;
use App\Support\Phone;
use App\Support\Units;
use Illuminate\Http\Request;

/**
 * Unauthenticated endpoints used by the public landing page. They expose only
 * what a farm already prints on its leaflet (name, phone, address, milk price)
 * and accept enquiries. Spam controls: per-IP rate limit (routes), a honeypot
 * field, and merging repeat submissions from the same phone.
 */
class PublicController extends Controller
{
    public function farm(Farm $farm)
    {
        return [
            'name' => $farm->name, 'phone' => $farm->phone, 'address' => $farm->address,
            'currency' => $farm->currency, 'milk_price' => Units::m($farm->default_milk_price),
        ];
    }

    public function storeLead(Request $r, Farm $farm)
    {
        $r->merge(['phone' => Phone::normalizeBd($r->input('phone')) ?? $r->input('phone')]);
        $d = $r->validate([
            'name' => 'required|string|min:2|max:120',
            'phone' => ['required', 'string', 'regex:/^01[3-9]\d{8}$/'],
            'area' => 'nullable|string|max:120',
            'address' => 'nullable|string|max:255',
            'quantity' => 'nullable|numeric|min:0|max:500',
            'start_date' => 'nullable|date|after_or_equal:today',
            'message' => 'nullable|string|max:1000',
            'website' => 'nullable|string|max:0', // honeypot: real people never see or fill it
        ], [
            'phone.regex' => 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).',
            'website.max' => 'Invalid submission.',
        ]);

        app(CurrentFarm::class)->set($farm, 'public');
        $data = [
            'name' => $d['name'], 'phone' => $d['phone'], 'area' => $d['area'] ?? null, 'address' => $d['address'] ?? null,
            'qty_ml' => isset($d['quantity']) ? Units::qty($d['quantity']) : 0, 'start_date' => $d['start_date'] ?? null,
            'message' => $d['message'] ?? null, 'ip' => $r->ip(),
        ];

        // Same phone, still open, within a week: update instead of creating a duplicate.
        $lead = Lead::where('phone', $d['phone'])->whereIn('status', ['new', 'contacted'])
            ->where('created_at', '>=', now()->subDays(7))->latest('id')->first();
        if ($lead) {
            $lead->update(array_filter($data, fn ($v) => $v !== null && $v !== 0));
        } else {
            $lead = Lead::create($data + ['source' => 'website', 'status' => 'new']);
            FarmNotification::firstOrCreate(['dedupe_key' => "lead:{$lead->id}"], [
                'type' => 'new_lead', 'severity' => 'info', 'title' => "New milk enquiry: {$lead->name}",
                'body' => trim($lead->phone.($lead->area ? " · {$lead->area}" : '').($lead->qty_ml ? ' · '.rtrim(rtrim(Units::q($lead->qty_ml), '0'), '.').' L/day' : '')),
                'link' => '/leads',
            ]);
        }
        FarmChanges::touch('leads', 'notifications');

        return response()->json(['ok' => true], 201);
    }
}
