<?php

namespace App\Domain\Livestock;

use App\Domain\Purchasing\PurchasingService;
use App\Domain\Sales\SalesService;
use App\Models\Animal;
use App\Models\AnimalEvent;
use App\Models\AnimalWeight;
use App\Models\Bill;
use App\Models\Customer;
use App\Models\Flock;
use App\Models\FlockRecord;
use App\Models\Treatment;
use App\Models\Vaccination;
use App\Support\FarmChanges;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Animals, flocks and their health records, with the money side linked once. */
final class LivestockService
{
    public function __construct(private PurchasingService $purchasing, private SalesService $sales) {}

    public function registerAnimal(array $d, ?array $purchase = null): Animal
    {
        return DB::transaction(function () use ($d, $purchase) {
            $animal = Animal::create($d);
            if ($animal->weight_g) {
                AnimalWeight::create(['animal_id' => $animal->id, 'date' => $d['acquired_at'] ?? now()->toDateString(), 'weight_g' => $animal->weight_g]);
            }
            $this->event($animal, $animal->acquisition === 'born' ? 'birth' : 'acquired', $d['acquired_at'] ?? $d['birth_date'] ?? now()->toDateString(),
                relatedId: $animal->mother_id);
            if ($animal->mother_id) {
                $this->event(Animal::findOrFail($animal->mother_id), 'calving', $d['birth_date'] ?? now()->toDateString(), relatedId: $animal->id);
            }
            // A purchased animal is a capital asset, never an operating expense.
            if ($purchase && $animal->purchase_price > 0) {
                $this->purchasing->createBill([
                    'kind' => 'asset', 'category' => 'livestock_assets', 'date' => $d['acquired_at'] ?? now()->toDateString(),
                    'supplier_id' => $purchase['supplier_id'] ?? null, 'description' => "Purchase of {$animal->tag}",
                    'related_type' => 'animal', 'related_id' => $animal->id,
                ], [['description' => "Animal {$animal->tag}", 'qty_milli' => 1000, 'unit_price' => $animal->purchase_price]],
                    ! empty($purchase['method']) ? ['method' => $purchase['method']] : null, $animal);
            }
            FarmChanges::touch('animals');

            return $animal->refresh();
        });
    }

    public function addWeight(Animal $animal, string $date, int $weightG, ?string $notes = null): AnimalWeight
    {
        $w = AnimalWeight::create(['animal_id' => $animal->id, 'date' => $date, 'weight_g' => $weightG, 'notes' => $notes]);
        $latest = AnimalWeight::where('animal_id', $animal->id)->orderByDesc('date')->orderByDesc('id')->value('weight_g');
        $animal->update(['weight_g' => $latest]);
        FarmChanges::touch('animals');

        return $w;
    }

    /** Sold / deceased / transferred. History stays; a sale posts revenue once. */
    public function changeStatus(Animal $animal, string $status, string $date, array $d = []): Animal
    {
        if ($animal->status !== 'active') {
            throw ValidationException::withMessages(['status' => "{$animal->tag} is already {$animal->status}."]);
        }

        return DB::transaction(function () use ($animal, $status, $date, $d) {
            $animal->update(['status' => $status, 'status_date' => $date, 'sale_price' => $d['sale_price'] ?? null,
                'lactation_status' => null]);
            $this->event($animal, match ($status) { 'sold' => 'sale', 'deceased' => 'death', default => 'transfer' }, $date,
                details: array_filter(['price' => $d['sale_price'] ?? null, 'cause' => $d['cause'] ?? null, 'to' => $d['to'] ?? null]),
                notes: $d['notes'] ?? null);

            if ($status === 'sold' && ($d['sale_price'] ?? 0) > 0) {
                $customer = ! empty($d['customer_id']) ? Customer::findOrFail($d['customer_id']) : null;
                $invoice = $this->sales->createInvoice($customer, $date, 'animal_sales',
                    [['description' => "Sale of {$animal->tag}".($animal->name ? " ({$animal->name})" : ''), 'qty_milli' => 1000, 'unit_price' => $d['sale_price']]],
                    source: $animal);
                if (! empty($d['paid_method'])) {
                    $this->sales->settleNow($invoice, $d['paid_method'], $date);
                }
            }
            FarmChanges::touch('animals');

            return $animal->fresh();
        });
    }

    public function event(Animal $animal, string $type, string $date, array $details = [], ?string $notes = null, ?int $relatedId = null): AnimalEvent
    {
        return AnimalEvent::create(['animal_id' => $animal->id, 'type' => $type, 'date' => $date, 'details' => $details ?: null,
            'notes' => $notes, 'related_animal_id' => $relatedId, 'user_id' => auth()->id()]);
    }

    /**
     * One daily record per flock. Closing = opening + added − deaths − sold − culled,
     * and it can never go negative. Records must be entered in date order so the
     * opening count always equals the previous closing count.
     */
    public function recordFlockDay(Flock $flock, array $d): FlockRecord
    {
        return DB::transaction(function () use ($flock, $d) {
            $flock = Flock::lockForUpdate()->findOrFail($flock->id);
            if (FlockRecord::where('flock_id', $flock->id)->where('date', $d['date'])->exists()) {
                throw ValidationException::withMessages(['date' => 'A record for this flock and date already exists.']);
            }
            if (FlockRecord::where('flock_id', $flock->id)->where('date', '>', $d['date'])->exists()) {
                throw ValidationException::withMessages(['date' => 'A later record exists; add records in date order.']);
            }
            $opening = $flock->current_count;
            $closing = $opening + ($d['added'] ?? 0) - ($d['deaths'] ?? 0) - ($d['sold'] ?? 0) - ($d['culled'] ?? 0);
            if ($closing < 0) {
                throw ValidationException::withMessages(['deaths' => "Reductions exceed the {$opening} birds in the flock."]);
            }
            $record = FlockRecord::create([
                'flock_id' => $flock->id, 'date' => $d['date'], 'opening_count' => $opening, 'added' => $d['added'] ?? 0,
                'deaths' => $d['deaths'] ?? 0, 'sold' => $d['sold'] ?? 0, 'culled' => $d['culled'] ?? 0, 'closing_count' => $closing,
                'eggs' => $d['eggs'] ?? 0, 'eggs_broken' => $d['eggs_broken'] ?? 0, 'sick' => $d['sick'] ?? 0,
                'water_ml' => $d['water_ml'] ?? null, 'notes' => $d['notes'] ?? null, 'user_id' => auth()->id(),
            ]);
            $flock->update(['current_count' => $closing, 'status' => $closing === 0 ? 'closed' : $flock->status]);

            $customer = ! empty($d['customer_id']) ? Customer::findOrFail($d['customer_id']) : null;
            $items = [];
            if (($d['eggs_sold'] ?? 0) > 0 && ($d['egg_price'] ?? 0) > 0) {
                $items['egg_sales'] = ['description' => "{$d['eggs_sold']} eggs — {$flock->name}", 'qty_milli' => $d['eggs_sold'] * 1000, 'unit_price' => $d['egg_price']];
            }
            if (($d['sold'] ?? 0) > 0 && ($d['bird_price'] ?? 0) > 0) {
                $items['poultry_sales'] = ['description' => "{$d['sold']} birds — {$flock->name}", 'qty_milli' => $d['sold'] * 1000, 'unit_price' => $d['bird_price']];
            }
            foreach ($items as $category => $item) {
                // Separate invoice per product keeps product-wise sales exact; source = the flock (dimension).
                $invoice = $this->sales->createInvoice($customer, $d['date'], $category, [$item],
                    description: $item['description'], dims: ['flock_id' => $flock->id]);
                if (! empty($d['paid_method'])) {
                    $this->sales->settleNow($invoice, $d['paid_method'], $d['date']);
                }
            }
            FarmChanges::touch('flocks');

            return $record;
        });
    }

    /** Create or update a treatment/vaccination and keep its single linked expense bill in sync. */
    public function saveHealthRecord(Model $record, array $d, string $category, ?string $payMethod): Model
    {
        return DB::transaction(function () use ($record, $d, $category, $payMethod) {
            $oldCost = (int) $record->cost;
            $record->fill($d + ['user_id' => $record->user_id ?? auth()->id()])->save();

            $bill = Bill::where('source_type', $record->getMorphClass())->where('source_id', $record->id)->first();
            if ($bill && $oldCost !== (int) $record->cost) {
                if ($bill->paid > 0) {
                    throw ValidationException::withMessages(['cost' => 'The linked expense is already paid; record the difference as a separate expense.']);
                }
                $this->purchasing->voidBill($bill);
                $bill = null;
            }
            if (! $bill && $record->cost > 0) {
                $target = $record->animal_id ? ['related_type' => 'animal', 'related_id' => $record->animal_id]
                    : ($record->flock_id ? ['related_type' => 'flock', 'related_id' => $record->flock_id] : []);
                $label = $record instanceof Treatment ? 'Treatment' : 'Vaccination '.$record->vaccine;
                $this->purchasing->createBill(['kind' => 'expense', 'category' => $category, 'date' => $record->date->toDateString(),
                    'description' => $label.($record->vet_name ? " — {$record->vet_name}" : '')] + $target,
                    [['description' => $label, 'qty_milli' => 1000, 'unit_price' => $record->cost]],
                    $payMethod ? ['method' => $payMethod] : null, $record);
            }
            if ($record instanceof Treatment && $record->animal_id) {
                Animal::whereKey($record->animal_id)->update(['health_status' => match ($record->outcome) {
                    'recovered' => 'healthy', 'died' => 'sick', default => 'under_treatment',
                }]);
            }
            FarmChanges::touch('vet', 'animals');

            return $record;
        });
    }
}
