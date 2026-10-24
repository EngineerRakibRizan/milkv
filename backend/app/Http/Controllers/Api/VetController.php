<?php

namespace App\Http\Controllers\Api;

use App\Domain\Livestock\LivestockService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Treatment;
use App\Models\Vaccination;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Stores veterinary records and schedules. It does not diagnose or
 * prescribe: medication fields hold what the veterinarian prescribed.
 */
class VetController extends Controller
{
    public function __construct(private LivestockService $service) {}

    public function treatments(Request $r)
    {
        $this->allow('vet.view');
        $q = Treatment::with(['animal:id,tag,name', 'flock:id,name'])
            ->when($r->query('animal_id'), fn ($q, $id) => $q->where('animal_id', $id))
            ->when($r->query('flock_id'), fn ($q, $id) => $q->where('flock_id', $id))
            ->when($r->query('outcome'), fn ($q, $o) => $q->where('outcome', $o))
            ->when($r->query('vet'), fn ($q, $v) => $q->where('vet_name', 'like', "%{$v}%"))
            ->when($r->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($r->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('diagnosis', 'like', "%{$s}%")->orWhere('symptoms', 'like', "%{$s}%")))
            ->orderByDesc('date')->orderByDesc('id');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'treatment']);
    }

    public function storeTreatment(Request $r)
    {
        $this->allow('vet.create');
        [$d, $pay] = $this->treatmentData($r);
        $t = $this->service->saveHealthRecord(new Treatment, $d, 'vet_expense', $pay);

        return response()->json(Present::treatment($t->load('animal:id,tag,name', 'flock:id,name')), 201);
    }

    public function updateTreatment(Request $r, Treatment $treatment)
    {
        $this->allow('vet.update');
        [$d] = $this->treatmentData($r);
        $t = $this->service->saveHealthRecord($treatment, $d, 'vet_expense', null);

        return Present::treatment($t->load('animal:id,tag,name', 'flock:id,name'));
    }

    public function vaccinations(Request $r)
    {
        $this->allow('vet.view');
        $q = Vaccination::with(['animal:id,tag,name', 'flock:id,name'])
            ->when($r->query('animal_id'), fn ($q, $id) => $q->where('animal_id', $id))
            ->when($r->query('flock_id'), fn ($q, $id) => $q->where('flock_id', $id))
            ->when($r->boolean('upcoming'), fn ($q) => $q->where('next_due_date', '>=', today()->toDateString())->reorder('next_due_date'))
            ->orderByDesc('date')->orderByDesc('id');

        return Present::page($q->paginate($this->perPage($r)), [Present::class, 'vaccination']);
    }

    public function storeVaccination(Request $r)
    {
        $this->allow('vet.create');
        [$d, $pay] = $this->vaccinationData($r);
        $v = $this->service->saveHealthRecord(new Vaccination, $d, 'vaccine_expense', $pay);

        return response()->json(Present::vaccination($v->load('animal:id,tag,name', 'flock:id,name')), 201);
    }

    public function updateVaccination(Request $r, Vaccination $vaccination)
    {
        $this->allow('vet.update');
        [$d] = $this->vaccinationData($r);
        $v = $this->service->saveHealthRecord($vaccination, $d, 'vaccine_expense', null);

        return Present::vaccination($v->load('animal:id,tag,name', 'flock:id,name'));
    }

    private function subjectRules(): array
    {
        $farm = $this->current()->id();

        return [
            'animal_id' => ['nullable', 'required_without:flock_id', 'prohibits:flock_id', 'integer', Rule::exists('animals', 'id')->where('farm_id', $farm)],
            'flock_id' => ['nullable', 'required_without:animal_id', 'integer', Rule::exists('flocks', 'id')->where('farm_id', $farm)],
            'paid_method' => ['nullable', Rule::in(config('farmos.payment_methods'))],
        ];
    }

    private function treatmentData(Request $r): array
    {
        $d = $r->validate($this->subjectRules() + [
            'date' => 'required|date|before_or_equal:today', 'symptoms' => 'nullable|string|max:2000',
            'diagnosis' => 'nullable|string|max:255', 'vet_name' => 'nullable|string|max:120', 'vet_contact' => 'nullable|string|max:120',
            'medications' => 'nullable|array|max:20', 'medications.*.name' => 'required|string|max:120',
            'medications.*.dosage' => 'nullable|string|max:120', 'medications.*.frequency' => 'nullable|string|max:120',
            'medications.*.duration' => 'nullable|string|max:120', 'cost' => 'nullable|numeric|min:0',
            'follow_up_date' => 'nullable|date|after_or_equal:date', 'outcome' => 'required|in:ongoing,recovered,referred,died',
            'notes' => 'nullable|string|max:2000',
        ]);
        $pay = $d['paid_method'] ?? null;
        unset($d['paid_method']);

        return [$this->convert($d, ['cost']) + ['cost' => 0], $pay];
    }

    private function vaccinationData(Request $r): array
    {
        $d = $r->validate($this->subjectRules() + [
            'vaccine' => 'required|string|max:120', 'date' => 'required|date|before_or_equal:today',
            'next_due_date' => 'nullable|date|after:date', 'dose' => 'nullable|string|max:120',
            'vet_name' => 'nullable|string|max:120', 'cost' => 'nullable|numeric|min:0', 'notes' => 'nullable|string|max:2000',
        ]);
        $pay = $d['paid_method'] ?? null;
        unset($d['paid_method']);

        return [$this->convert($d, ['cost']) + ['cost' => 0], $pay];
    }
}
