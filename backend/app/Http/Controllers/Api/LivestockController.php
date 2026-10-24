<?php

namespace App\Http\Controllers\Api;

use App\Domain\Livestock\LivestockService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Animal;
use App\Models\AnimalEvent;
use App\Models\AnimalWeight;
use App\Models\Bill;
use App\Models\InventoryMovement;
use App\Models\MilkRecord;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LivestockController extends Controller
{
    public function __construct(private LivestockService $service) {}

    public function index(Request $r)
    {
        $this->allow('animals.view');
        $q = Animal::query()
            ->when($r->boolean('archived'), fn ($q) => $q->onlyTrashed())
            ->when($r->query('status', 'active'), fn ($q, $s) => $s === 'all' ? $q : $q->where('status', $s))
            ->when($r->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($r->query('gender'), fn ($q, $g) => $q->where('gender', $g))
            ->when($r->query('health'), fn ($q, $h) => $q->where('health_status', $h))
            ->when($r->query('lactation'), fn ($q, $l) => $q->where('lactation_status', $l))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('tag', 'like', "%{$s}%")
                ->orWhere('name', 'like', "%{$s}%")->orWhere('breed', 'like', "%{$s}%")))
            ->orderBy($r->query('sort') === 'name' ? 'name' : 'tag');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'animal']);
    }

    public function show(int $id)
    {
        $this->allow('animals.view');
        $a = Animal::withTrashed()->findOrFail($id);
        $milk = MilkRecord::where('animal_id', $id)->where('date', '>=', now()->subDays(60)->toDateString())->orderBy('date')->get(['date', 'total_ml']);
        $feed = InventoryMovement::with('feedItem:id,name,unit')->where('target_type', 'animal')->where('target_id', $id)->latest('date')->limit(30)->get();
        $costs = Bill::where('related_type', 'animal')->where('related_id', $id)->where('status', '!=', 'void')->latest('date')->get();

        return [
            'animal' => Present::animal($a),
            'mother' => $a->mother_id ? Animal::withTrashed()->find($a->mother_id, ['id', 'tag', 'name']) : null,
            'calves' => Animal::withTrashed()->where('mother_id', $id)->get(['id', 'tag', 'name', 'birth_date', 'gender', 'status']),
            'weights' => AnimalWeight::where('animal_id', $id)->orderBy('date')->get()->map(fn ($w) => ['id' => $w->id, 'date' => $w->date->toDateString(), 'weight' => Units::q($w->weight_g), 'notes' => $w->notes]),
            'events' => AnimalEvent::with('relatedAnimal:id,tag,name')->where('animal_id', $id)->orderByDesc('date')->orderByDesc('id')->get()
                ->map(fn ($e) => ['id' => $e->id, 'type' => $e->type, 'date' => $e->date->toDateString(), 'details' => $e->details, 'notes' => $e->notes,
                    'related' => $e->relatedAnimal?->only(['id', 'tag', 'name'])]),
            'treatments' => $a->treatments()->with('animal:id,tag,name')->orderByDesc('date')->get()->map([Present::class, 'treatment']),
            'vaccinations' => $a->vaccinations()->with('animal:id,tag,name')->orderByDesc('date')->get()->map([Present::class, 'vaccination']),
            'milk' => $milk->map(fn ($m) => ['date' => $m->date->toDateString(), 'litres' => Units::q($m->total_ml)]),
            'milk_total_60d' => Units::q((int) $milk->sum('total_ml')),
            'feed' => $feed->map([Present::class, 'movement']),
            'expenses' => $costs->map([Present::class, 'bill']),
        ];
    }

    public function store(Request $r)
    {
        $this->allow('animals.create');
        $d = $this->convert($this->validated($r), ['purchase_price', 'current_value'], ['weight' => 'weight_g']);
        $purchase = $d['acquisition'] === 'purchased' ? ['supplier_id' => $r->input('supplier_id'), 'method' => $r->input('paid_method')] : null;
        unset($d['supplier_id'], $d['paid_method']);

        return response()->json(Present::animal($this->service->registerAnimal($d, $purchase)), 201);
    }

    public function update(Request $r, Animal $animal)
    {
        $this->allow('animals.update');
        $d = $this->convert($this->validated($r, $animal), ['purchase_price', 'current_value']);
        unset($d['weight'], $d['supplier_id'], $d['paid_method'], $d['acquisition']);
        $animal->update($d);
        FarmChanges::touch('animals');

        return Present::animal($animal);
    }

    public function destroy(Animal $animal)
    {
        $this->allow('animals.archive');
        $animal->delete(); // soft delete: history is kept
        FarmChanges::touch('animals');

        return response()->noContent();
    }

    public function restore(int $id)
    {
        $this->allow('animals.archive');
        Animal::onlyTrashed()->findOrFail($id)->restore();
        FarmChanges::touch('animals');

        return response()->noContent();
    }

    public function addWeight(Request $r, Animal $animal)
    {
        $this->allow('animals.update');
        $d = $r->validate(['date' => 'required|date|before_or_equal:today', 'weight' => 'required|numeric|min:0.1|max:3000', 'notes' => 'nullable|string|max:255']);
        $this->service->addWeight($animal, $d['date'], Units::qty($d['weight']), $d['notes'] ?? null);

        return response()->noContent(201);
    }

    public function addEvent(Request $r, Animal $animal)
    {
        $this->allow('animals.update');
        $d = $r->validate([
            'type' => 'required|in:heat,insemination,pregnancy_check,dry_off,note',
            'date' => 'required|date|before_or_equal:today', 'notes' => 'nullable|string|max:1000',
            'details' => 'nullable|array', 'result' => 'nullable|in:pregnant,open',
        ]);
        $this->service->event($animal, $d['type'], $d['date'], ($d['details'] ?? []) + array_filter(['result' => $d['result'] ?? null]), $d['notes'] ?? null);
        $patch = match ($d['type']) {
            'insemination' => ['reproductive_status' => 'inseminated'],
            'pregnancy_check' => isset($d['result']) ? ['reproductive_status' => $d['result']] : [],
            'dry_off' => ['lactation_status' => 'dry'],
            default => [],
        };
        if ($patch) {
            $animal->update($patch);
        }
        FarmChanges::touch('animals');

        return response()->noContent(201);
    }

    public function changeStatus(Request $r, Animal $animal)
    {
        $this->allow('animals.update');
        $d = $r->validate([
            'status' => 'required|in:sold,deceased,transferred', 'date' => 'required|date|before_or_equal:today',
            'sale_price' => 'required_if:status,sold|nullable|numeric|min:0', 'customer_id' => 'nullable|integer|exists:customers,id',
            'paid_method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
            'cause' => 'nullable|string|max:255', 'to' => 'nullable|string|max:255', 'notes' => 'nullable|string|max:1000',
        ]);
        $d = $this->convert($d, ['sale_price']);

        return Present::animal($this->service->changeStatus($animal, $d['status'], $d['date'], $d));
    }

    private function validated(Request $r, ?Animal $a = null): array
    {
        return $r->validate([
            'tag' => ['required', 'string', 'max:40', Rule::unique('animals')->where('farm_id', $this->current()->id())->ignore($a?->id)],
            'name' => 'nullable|string|max:80',
            'type' => 'required|in:cow,heifer,bull,calf',
            'breed' => 'nullable|string|max:80',
            'gender' => 'required|in:female,male',
            'birth_date' => 'nullable|date|before_or_equal:today',
            'acquired_at' => 'nullable|date|before_or_equal:today',
            'acquisition' => 'required|in:born,purchased,gift',
            'purchase_price' => 'nullable|numeric|min:0',
            'current_value' => 'nullable|numeric|min:0',
            'color' => 'nullable|string|max:60',
            'mother_id' => ['nullable', 'integer', Rule::exists('animals', 'id')->where('farm_id', $this->current()->id())->where('gender', 'female')],
            'father_info' => 'nullable|string|max:120',
            'reproductive_status' => 'nullable|in:open,inseminated,pregnant',
            'lactation_status' => 'nullable|in:lactating,dry',
            'health_status' => 'nullable|in:healthy,sick,under_treatment',
            'feed_group' => 'nullable|string|max:60',
            'weight' => 'nullable|numeric|min:0|max:3000',
            'notes' => 'nullable|string|max:2000',
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('farm_id', $this->current()->id())],
            'paid_method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
        ]);
    }
}
