<?php

namespace App\Http\Controllers\Api;

use App\Domain\Livestock\LivestockService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Flock;
use App\Models\FlockRecord;
use App\Models\InventoryMovement;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PoultryController extends Controller
{
    public function __construct(private LivestockService $service) {}

    public function index(Request $r)
    {
        $this->allow('flocks.view');
        $q = Flock::query()
            ->when($r->query('species'), fn ($q, $s) => $q->where('species', $s))
            ->when($r->query('status', 'active'), fn ($q, $s) => $s === 'all' ? $q : $q->where('status', $s))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('code', 'like', "%{$s}%")))
            ->orderBy('code');
        $flocks = $q->get();
        $last7 = FlockRecord::whereIn('flock_id', $flocks->pluck('id'))->where('date', '>=', now()->subDays(6)->toDateString())
            ->groupBy('flock_id')->selectRaw('flock_id, SUM(eggs) as eggs, SUM(deaths) as deaths')->get()->keyBy('flock_id');

        return $flocks->map(fn ($f) => Present::flock($f) + [
            'eggs_7d' => (int) ($last7[$f->id]->eggs ?? 0), 'deaths_7d' => (int) ($last7[$f->id]->deaths ?? 0),
        ]);
    }

    public function show(int $id)
    {
        $this->allow('flocks.view');
        $f = Flock::withTrashed()->findOrFail($id);
        $records = FlockRecord::where('flock_id', $id)->orderByDesc('date')->limit(90)->get();
        $feed = InventoryMovement::with('feedItem:id,name,unit')->where('target_type', 'flock')->where('target_id', $id)->latest('date')->limit(30)->get();
        $totals = FlockRecord::where('flock_id', $id)->selectRaw('SUM(eggs) as eggs, SUM(deaths) as deaths, SUM(sold) as sold')->first();

        return [
            'flock' => Present::flock($f),
            'records' => $records->map([Present::class, 'flockRecord']),
            'totals' => ['eggs' => (int) $totals->eggs, 'deaths' => (int) $totals->deaths, 'sold' => (int) $totals->sold,
                'mortality_pct' => $f->initial_count ? round($totals->deaths * 100 / $f->initial_count, 2) : 0],
            'feed' => $feed->map([Present::class, 'movement']),
            'treatments' => $f->treatments()->with('flock:id,name')->orderByDesc('date')->get()->map([Present::class, 'treatment']),
            'vaccinations' => $f->vaccinations()->with('flock:id,name')->orderByDesc('date')->get()->map([Present::class, 'vaccination']),
        ];
    }

    public function store(Request $r)
    {
        $this->allow('flocks.create');
        $d = $this->convert($this->validated($r), ['cost']);
        $d['current_count'] = $d['initial_count'];
        $flock = Flock::create($d)->refresh();
        FarmChanges::touch('flocks');

        return response()->json(Present::flock($flock), 201);
    }

    public function update(Request $r, Flock $flock)
    {
        $this->allow('flocks.update');
        $d = $this->convert($this->validated($r, $flock), ['cost']);
        unset($d['initial_count']); // counts change only through daily records
        $flock->update($d);
        FarmChanges::touch('flocks');

        return Present::flock($flock);
    }

    public function storeRecord(Request $r, Flock $flock)
    {
        $this->allow('flocks.record');
        $d = $r->validate([
            'date' => 'required|date|before_or_equal:today',
            'added' => 'nullable|integer|min:0', 'deaths' => 'nullable|integer|min:0', 'sold' => 'nullable|integer|min:0',
            'culled' => 'nullable|integer|min:0', 'eggs' => 'nullable|integer|min:0', 'eggs_broken' => 'nullable|integer|min:0',
            'sick' => 'nullable|integer|min:0', 'water' => 'nullable|numeric|min:0', 'notes' => 'nullable|string|max:1000',
            'eggs_sold' => 'nullable|integer|min:0', 'egg_price' => 'nullable|numeric|min:0', 'bird_price' => 'nullable|numeric|min:0',
            'customer_id' => ['nullable', 'integer', Rule::exists('customers', 'id')->where('farm_id', $this->current()->id())],
            'paid_method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
        ]);
        $d = $this->convert($d, ['egg_price', 'bird_price'], ['water' => 'water_ml']);

        return response()->json(Present::flockRecord($this->service->recordFlockDay($flock, $d)), 201);
    }

    private function validated(Request $r, ?Flock $f = null): array
    {
        return $r->validate([
            'code' => ['required', 'string', 'max:30', Rule::unique('flocks')->where('farm_id', $this->current()->id())->ignore($f?->id)],
            'name' => 'required|string|max:80', 'species' => 'required|in:hen,duck', 'breed' => 'nullable|string|max:80',
            'purpose' => 'required|in:layer,broiler,breeder,mixed', 'started_at' => 'required|date|before_or_equal:today',
            'initial_count' => ($f ? 'sometimes' : 'required').'|integer|min:1|max:1000000', 'cost' => 'nullable|numeric|min:0',
            'location' => 'nullable|string|max:120', 'status' => 'sometimes|in:active,closed', 'notes' => 'nullable|string|max:2000',
        ]);
    }
}
