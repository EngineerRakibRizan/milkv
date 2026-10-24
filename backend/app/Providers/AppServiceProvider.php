<?php

namespace App\Providers;

use App\Models;
use App\Support\CurrentFarm;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Scoped: reset for every request/job, which keeps Octane workers tenant-safe.
        $this->app->scoped(CurrentFarm::class);
    }

    public function boot(): void
    {
        Model::shouldBeStrict(! $this->app->isProduction());
        JsonResource::withoutWrapping();

        // Short, stable names in polymorphic columns (source_type, target_type, ...).
        Relation::enforceMorphMap([
            'animal' => Models\Animal::class,
            'flock' => Models\Flock::class,
            'bill' => Models\Bill::class,
            'invoice' => Models\Invoice::class,
            'delivery' => Models\Delivery::class,
            'customer_payment' => Models\CustomerPayment::class,
            'supplier_payment' => Models\SupplierPayment::class,
            'salary_payment' => Models\SalaryPayment::class,
            'inventory_movement' => Models\InventoryMovement::class,
            'milk_record' => Models\MilkRecord::class,
            'milk_movement' => Models\MilkMovement::class,
            'treatment' => Models\Treatment::class,
            'vaccination' => Models\Vaccination::class,
            'feed_item' => Models\FeedItem::class,
            'flock_record' => Models\FlockRecord::class,
            'customer' => Models\Customer::class,
            'supplier' => Models\Supplier::class,
            'employee' => Models\Employee::class,
            'farm_task' => Models\FarmTask::class,
            'user' => Models\User::class,
        ]);

        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(10)->by($r->ip()));
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(300)->by($r->user()?->id ?: $r->ip()));
    }
}
