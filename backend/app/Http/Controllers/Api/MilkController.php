<?php

namespace App\Http\Controllers\Api;

use App\Domain\Milk\MilkLedger;
use App\Http\Controllers\Controller;
use App\Models\Animal;
use App\Models\MilkMovement;
use App\Models\MilkRecord;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MilkController extends Controller
{
    public function __construct(private MilkLedger $milk) {}

    /**
     * The milking sheet for a day: every lactating cow with what has been
     * recorded so far. One request renders the whole quick-entry screen.
     */
    public function sheet(Request $r)
    {
        $this->allow('milk.view');
        $date = $r->validate(['date' => 'required|date'])['date'];
        $records = MilkRecord::where('date', $date)->get()->keyBy('animal_id');
        $cows = Animal::where('status', 'active')->where('gender', 'female')
            ->where(fn ($q) => $q->where('lactation_status', 'lactating')->orWhereIn('id', $records->keys()))
            ->orderBy('tag')->get(['id', 'tag', 'name', 'lactation_status']);
        $movements = MilkMovement::where('date', $date)->selectRaw('type, SUM(qty_ml) as ml')->groupBy('type')->pluck('ml', 'type');

        return [
            'date' => $date,
            'rows' => $cows->map(fn ($c) => [
                'animal_id' => $c->id, 'tag' => $c->tag, 'name' => $c->name,
                'morning' => Units::q($records[$c->id]->morning_ml ?? 0), 'evening' => Units::q($records[$c->id]->evening_ml ?? 0),
                'other' => Units::q($records[$c->id]->other_ml ?? 0), 'total' => Units::q($records[$c->id]->total_ml ?? 0),
                'notes' => $records[$c->id]->notes ?? null, 'recorded' => isset($records[$c->id]),
            ]),
            'summary' => [
                'produced' => Units::q((int) ($movements['production'] ?? 0)),
                'delivered' => Units::q(-(int) ($movements['delivery'] ?? 0)),
                'internal_use' => Units::q(-(int) ($movements['internal_use'] ?? 0)),
                'spoilage' => Units::q(-(int) ($movements['spoilage'] ?? 0)),
                'stock' => Units::q($this->milk->available()),
            ],
        ];
    }

    /** Saves the whole sheet in one transaction (idempotent: re-saving the same values changes nothing). */
    public function saveSheet(Request $r)
    {
        $this->allow('milk.record');
        $d = $r->validate([
            'date' => 'required|date|before_or_equal:today',
            'rows' => 'required|array|min:1|max:500',
            'rows.*.animal_id' => ['required', 'integer', 'distinct', Rule::exists('animals', 'id')->where('farm_id', $this->current()->id())],
            'rows.*.morning' => 'nullable|numeric|min:0|max:100',
            'rows.*.evening' => 'nullable|numeric|min:0|max:100',
            'rows.*.other' => 'nullable|numeric|min:0|max:100',
            'rows.*.notes' => 'nullable|string|max:255',
        ]);
        $animals = Animal::whereIn('id', array_column($d['rows'], 'animal_id'))->get()->keyBy('id');

        $this->milk->locked(function () use ($d, $animals) {
            foreach ($d['rows'] as $row) {
                $this->milk->recordProduction($animals[$row['animal_id']], $d['date'], Units::qty($row['morning'] ?? 0),
                    Units::qty($row['evening'] ?? 0), Units::qty($row['other'] ?? 0), $row['notes'] ?? null);
            }
        });

        return $this->sheet(new Request(['date' => $d['date']]));
    }

    /** Internal use / spoilage / rejected milk. */
    public function out(Request $r)
    {
        $this->allow('milk.record');
        $d = $r->validate([
            'date' => 'required|date|before_or_equal:today', 'type' => 'required|in:internal_use,spoilage',
            'quantity' => 'required|numeric|gt:0|max:100000', 'notes' => 'nullable|string|max:255',
        ]);
        $this->milk->out($d['type'], Units::qty($d['quantity']), $d['date'], notes: $d['notes'] ?? null);

        return response()->json(['stock' => Units::q($this->milk->available())], 201);
    }

    public function movements(Request $r)
    {
        $this->allow('milk.view');
        $q = MilkMovement::query()
            ->when($r->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->orderByDesc('date')->orderByDesc('id');
        $p = $q->paginate($this->perPage($r));

        return \App\Http\Resources\Present::page($p, fn ($m) => [
            'id' => $m->id, 'date' => $m->date->toDateString(), 'type' => $m->type, 'quantity' => Units::q($m->qty_ml),
            'source_type' => $m->source_type, 'source_id' => $m->source_id, 'notes' => $m->notes,
        ]);
    }

    /** Production history for charts: per day totals. */
    public function history(Request $r)
    {
        $this->allow('milk.view');
        $d = $r->validate(['from' => 'required|date', 'to' => 'required|date|after_or_equal:from']);

        return MilkRecord::whereBetween('date', [$d['from'], $d['to']])->groupBy('date')
            ->selectRaw('date, SUM(morning_ml) as morning, SUM(evening_ml) as evening, SUM(total_ml) as total, COUNT(*) as cows')
            ->orderBy('date')->get()
            ->map(fn ($x) => ['date' => $x->date->toDateString(), 'morning' => Units::q((int) $x->morning), 'evening' => Units::q((int) $x->evening),
                'total' => Units::q((int) $x->total), 'cows' => (int) $x->cows]);
    }
}
