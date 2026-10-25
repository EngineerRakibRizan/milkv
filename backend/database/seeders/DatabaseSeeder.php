<?php

namespace Database\Seeders;

use App\Domain\Accounting\Ledger;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Livestock\LivestockService;
use App\Domain\Milk\MilkLedger;
use App\Domain\Notifications\AlertService;
use App\Domain\Purchasing\PurchasingService;
use App\Domain\Sales\DeliveryService;
use App\Domain\Sales\SalesService;
use App\Models\Animal;
use App\Models\Customer;
use App\Models\Delivery;
use App\Models\Employee;
use App\Models\Farm;
use App\Models\FarmTask;
use App\Models\FeedItem;
use App\Models\Flock;
use App\Models\Supplier;
use App\Models\Treatment;
use App\Models\User;
use App\Models\Vaccination;
use App\Support\CurrentFarm;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;

/**
 * Demo farm with 30 days of history. Everything goes through the same domain
 * services the API uses, so the demo numbers reconcile exactly like real data.
 *
 * Login: owner@farmos.test / password   (also manager@, worker@, delivery@, accountant@)
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        mt_srand(42);
        $owner = User::create(['name' => 'Rahim Uddin', 'email' => 'owner@farmos.test', 'password' => 'password']);
        $farm = Farm::create(['name' => 'Aura Dairy & Agro', 'address' => 'Savar, Dhaka', 'phone' => '01711000000',
            'currency' => 'BDT', 'timezone' => 'Asia/Dhaka', 'default_milk_price' => 9000]);
        $farm->users()->attach($owner->id, ['role' => 'owner', 'status' => 'active']);
        Ledger::seedAccounts($farm);
        app(CurrentFarm::class)->set($farm, 'owner');
        auth()->setUser($owner);

        $staff = [];
        foreach ([['manager', 'Karim Hossain', 'Farm Manager', 25000], ['worker', 'Jamal Mia', 'Farm Worker', 12000],
            ['delivery', 'Sohel Rana', 'Delivery', 11000], ['accountant', 'Nasrin Akter', 'Accountant', 18000]] as $i => [$role, $name, $title, $salary]) {
            $u = User::create(['name' => $name, 'email' => "{$role}@farmos.test", 'password' => 'password']);
            $farm->users()->attach($u->id, ['role' => $role, 'status' => 'active']);
            $staff[$role] = Employee::create(['user_id' => $u->id, 'code' => 'E-00'.($i + 1), 'name' => $name, 'phone' => '0171'.str_pad((string) ($i + 1), 7, '0', STR_PAD_LEFT),
                'title' => $title, 'joined_at' => '2025-01-01', 'salary' => $salary * 100, 'status' => 'active', 'route' => $role === 'delivery' ? 'Savar Bazar' : null]);
        }

        $purchasing = app(PurchasingService::class);
        $inventory = app(InventoryLedger::class);
        $livestock = app(LivestockService::class);
        $milk = app(MilkLedger::class);
        $deliveries = app(DeliveryService::class);
        $sales = app(SalesService::class);

        $feedCo = Supplier::create(['name' => 'Ma Feed Traders', 'phone' => '01819000111', 'type' => 'feed', 'address' => 'Ashulia']);
        $vetCo = Supplier::create(['name' => 'Savar Vet Pharma', 'phone' => '01819000222', 'type' => 'medicine']);
        $power = Supplier::create(['name' => 'DESCO / Palli Bidyut', 'type' => 'services']);

        $items = [];
        foreach ([['COW-CON', 'Cow concentrate (Anchor)', 'concentrate', 'kg', 300, 52, 900], ['BRAN', 'Rice bran', 'rice_bran', 'kg', 200, 30, 200],
            ['NAPIER', 'Napier green grass', 'green_fodder', 'kg', 500, 6, 5500], ['STRAW', 'Rice straw', 'hay_silage', 'kg', 300, 12, 900],
            ['LAYER', 'Layer feed (Nourish)', 'hen_feed', 'kg', 200, 58, 1600], ['DUCK', 'Duck grower feed', 'duck_feed', 'kg', 100, 54, 600],
            ['CALF', 'Calf starter', 'calf_feed', 'kg', 50, 70, 100], ['DCP', 'DCP mineral mix', 'supplement', 'kg', 20, 90, 40]] as [$sku, $name, $cat, $unit, $min, $price, $buy]) {
            $items[$sku] = ['item' => FeedItem::create(['sku' => $sku, 'name' => $name, 'category' => $cat, 'unit' => $unit,
                'min_stock_milli' => $min * 1000, 'supplier_id' => $feedCo->id, 'location' => 'Feed store']), 'price' => $price, 'buy' => $buy * 1000];
        }

        $start = CarbonImmutable::today()->subDays(30);
        // Opening stock and the first big purchase.
        foreach ($items as $sku => $x) {
            $inventory->adjust($x['item'], $x['item']->min_stock_milli, $start->toDateString(), $x['price'] * 100, 'opening', 'Opening stock');
        }
        $purchasing->createBill(['kind' => 'purchase', 'supplier_id' => $feedCo->id, 'date' => $start->toDateString(), 'due_date' => $start->addDays(30)->toDateString(),
            'description' => 'Monthly feed stock', 'extra_cost' => 150000], array_map(fn ($x) => [
                'feed_item_id' => $x['item']->id, 'description' => $x['item']->name, 'qty_milli' => $x['buy'], 'unit_price' => $x['price'] * 100,
            ], array_values($items)), ['method' => 'bank', 'amount' => 15000000]);

        // Herd
        $breeds = ['Holstein Friesian cross', 'Sahiwal cross', 'Red Chittagong', 'Jersey cross'];
        $cows = [];
        foreach (range(1, 10) as $i) {
            $cows[] = $livestock->registerAnimal([
                'tag' => 'GV-'.str_pad((string) $i, 3, '0', STR_PAD_LEFT), 'name' => ['Lali', 'Moyna', 'Shada', 'Kali', 'Rani', 'Buli', 'Champa', 'Joba', 'Tuni', 'Bokul'][$i - 1],
                'type' => 'cow', 'breed' => $breeds[$i % 4], 'gender' => 'female', 'birth_date' => $start->subMonths(36 + $i * 3)->toDateString(),
                'acquired_at' => $start->subMonths(12)->toDateString(), 'acquisition' => 'purchased', 'purchase_price' => (110000 + $i * 5000) * 100,
                'current_value' => (120000 + $i * 5000) * 100, 'lactation_status' => $i <= 7 ? 'lactating' : 'dry',
                'reproductive_status' => $i > 7 ? 'pregnant' : 'open', 'health_status' => 'healthy', 'feed_group' => $i <= 7 ? 'Milking' : 'Dry', 'weight_g' => (380 + $i * 8) * 1000,
            ]);
        }
        $livestock->registerAnimal(['tag' => 'GV-B01', 'name' => 'Raja', 'type' => 'bull', 'breed' => 'Sahiwal', 'gender' => 'male',
            'birth_date' => $start->subYears(4)->toDateString(), 'acquisition' => 'gift', 'health_status' => 'healthy', 'weight_g' => 520000]);
        foreach ([[0, 'female', 'Mishti'], [2, 'male', 'Bablu'], [4, 'female', 'Tuntuni']] as $k => [$m, $g, $n]) {
            $livestock->registerAnimal(['tag' => 'GV-C0'.($k + 1), 'name' => $n, 'type' => 'calf', 'gender' => $g, 'breed' => $cows[$m]->breed,
                'birth_date' => $start->subMonths(2 + $k)->toDateString(), 'acquired_at' => $start->subMonths(2 + $k)->toDateString(), 'acquisition' => 'born',
                'mother_id' => $cows[$m]->id, 'health_status' => 'healthy', 'weight_g' => (60 + $k * 10) * 1000]);
        }

        $hens = Flock::create(['code' => 'F-H1', 'name' => 'Layer shed A', 'species' => 'hen', 'breed' => 'Hy-Line Brown', 'purpose' => 'layer',
            'started_at' => $start->subWeeks(30)->toDateString(), 'initial_count' => 500, 'current_count' => 500, 'cost' => 9000000, 'location' => 'Shed A']);
        $ducks = Flock::create(['code' => 'F-D1', 'name' => 'Khaki Campbell ducks', 'species' => 'duck', 'breed' => 'Khaki Campbell', 'purpose' => 'layer',
            'started_at' => $start->subWeeks(24)->toDateString(), 'initial_count' => 150, 'current_count' => 150, 'cost' => 2250000, 'location' => 'Pond side']);

        // Customers
        $areas = ['Savar Bazar', 'Genda', 'Radio Colony', 'Thana Road'];
        $names = ['Abdul Karim', 'Rokeya Begum', 'Hotel Al-Madina', 'Shahin Store', 'Mitali Das', 'Tanvir Ahmed', 'Nur Jahan', 'Bismillah Sweets',
            'Fatema Khatun', 'Arif Hasan', 'Selina Parvin', 'Kamal Tea Stall', 'Savar Milk Collection Centre'];
        $customers = [];
        foreach ($names as $i => $name) {
            $business = in_array($i, [2, 3, 7, 11], true);
            $wholesale = $i === 12; // takes the day's surplus at a lower price
            $customers[] = Customer::create(['code' => 'C-'.str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT), 'name' => $name,
                'phone' => '017'.str_pad((string) (20000000 + $i * 1371), 8, '0', STR_PAD_LEFT), 'area' => $areas[$i % 4], 'address' => 'House '.(10 + $i).', '.$areas[$i % 4],
                'type' => $wholesale ? 'wholesale' : ($business ? ($i === 2 ? 'restaurant' : 'shop') : 'household'),
                'default_qty_ml' => $wholesale ? 24000 : ($business ? 8000 + $i * 500 : 1000 + ($i % 3) * 500),
                'price' => $wholesale ? 7200 : ($business ? 8500 : null), 'schedule' => $i === 9 ? 'alternate' : 'daily', 'payment_terms' => $business ? 'weekly' : 'monthly',
                'employee_id' => $staff['delivery']->id, 'status' => 'active', 'joined_at' => $start->subMonths(6)->toDateString()]);
        }

        // 30 days of operations
        $lactating = array_slice($cows, 0, 7);
        for ($day = 0; $day <= 30; $day++) {
            $date = $start->addDays($day);
            $d = $date->toDateString();
            foreach ($lactating as $k => $cow) {
                $base = 5200 + $k * 650 - (int) ($day * ($k === 5 ? 60 : 8));
                $milk->recordProduction($cow, $d, $base + mt_rand(-300, 300), $base - 900 + mt_rand(-300, 300), 0);
            }
            $milk->out('internal_use', 4000, $d, notes: 'Calves & household');
            if ($day % 9 === 4) {
                $milk->out('spoilage', 2000, $d, notes: 'Soured in heat');
            }

            if ($day < 30) { // leave today's deliveries open for the demo
                $deliveries->generateForDate($d);
                foreach (Delivery::where('date', $d)->get() as $i => $del) {
                    if ($i === 3 && $day % 7 === 0) {
                        $deliveries->transition($del, 'cancelled');
                    } elseif ($i === 5 && $day % 5 === 0) {
                        $deliveries->transition($del, 'delivered', intdiv($del->ordered_ml, 2));
                    } else {
                        $deliveries->transition($del, 'delivered');
                    }
                }
            } else {
                $deliveries->generateForDate($d);
            }

            // Daily feed
            foreach ($lactating as $cow) {
                $inventory->issue($items['COW-CON']['item'], 'consumption', 4000, $d, $cow);
                $inventory->issue($items['NAPIER']['item'], 'consumption', 25000, $d, $cow);
            }
            $inventory->issue($items['STRAW']['item'], 'consumption', 30000, $d);
            $inventory->issue($items['BRAN']['item'], 'consumption', 12000, $d);
            $inventory->issue($items['LAYER']['item'], 'consumption', 55000, $d, $hens);
            $inventory->issue($items['DUCK']['item'], 'consumption', 20000, $d, $ducks);

            if ($day < 30) {
                $livestock->recordFlockDay($hens, ['date' => $d, 'deaths' => $day % 6 === 0 ? 1 : 0, 'eggs' => 400 + mt_rand(-20, 15),
                    'eggs_sold' => 360, 'egg_price' => 1150, 'paid_method' => 'cash']);
                $livestock->recordFlockDay($ducks, ['date' => $d, 'deaths' => $day % 11 === 0 ? 1 : 0, 'eggs' => 115 + mt_rand(-10, 8),
                    'eggs_sold' => 100, 'egg_price' => 1500, 'paid_method' => 'cash']);
            }

            // Weekly / monthly collections
            if ($day % 7 === 6) {
                foreach ($customers as $i => $c) {
                    $c->refresh();
                    if ($c->balance > 0 && $i % 4 !== 1) {
                        $sales->receivePayment($c, $i % 3 === 0 ? $c->balance : intdiv($c->balance * 7, 10), $d, ['cash', 'bkash', 'nagad', 'bank'][$i % 4], 'TRX'.$day.$i);
                    }
                }
            }
        }

        // Expenses, salaries, health
        $mid = $start->addDays(15)->toDateString();
        $purchasing->createBill(['kind' => 'expense', 'category' => 'electricity', 'supplier_id' => $power->id, 'date' => $mid,
            'due_date' => $start->addDays(25)->toDateString(), 'description' => 'Electricity bill'], [['description' => 'Electricity', 'qty_milli' => 1000, 'unit_price' => 680000]]);
        $purchasing->createBill(['kind' => 'expense', 'category' => 'fuel_transport', 'date' => $mid, 'description' => 'Delivery van fuel'],
            [['description' => 'Diesel', 'qty_milli' => 60000, 'unit_price' => 11400]], ['method' => 'cash']);
        $purchasing->createBill(['kind' => 'expense', 'category' => 'packaging', 'date' => $mid, 'description' => 'Milk bottles & poly'],
            [['description' => 'Poly packs', 'qty_milli' => 2000000, 'unit_price' => 150]], ['method' => 'cash']);
        $purchasing->createBill(['kind' => 'asset', 'category' => 'equipment_assets', 'date' => $start->addDays(3)->toDateString(), 'description' => 'Milking machine'],
            [['description' => 'Portable milking machine', 'qty_milli' => 1000, 'unit_price' => 4500000]], ['method' => 'bank']);
        foreach ($staff as $role => $e) {
            $purchasing->paySalary($e, ['type' => 'salary', 'period' => $start->format('Y-m'), 'date' => $start->addDays(5)->toDateString(),
                'gross' => $e->salary, 'method' => $role === 'accountant' ? 'bank' : 'cash']);
        }
        $purchasing->paySalary($staff['worker'], ['type' => 'advance', 'date' => $start->addDays(20)->toDateString(), 'gross' => 300000, 'method' => 'cash']);

        $livestock->saveHealthRecord(new Treatment, ['animal_id' => $cows[5]->id, 'date' => $start->addDays(22)->toDateString(),
            'symptoms' => 'Reduced milk, swollen quarter', 'diagnosis' => 'Mastitis (vet confirmed)', 'vet_name' => 'Dr. Habibur Rahman', 'vet_contact' => '01712345678',
            'medications' => [['name' => 'As prescribed by vet', 'dosage' => 'Per prescription', 'frequency' => 'Twice daily', 'duration' => '5 days']],
            'cost' => 250000, 'follow_up_date' => CarbonImmutable::today()->addDays(2)->toDateString(), 'outcome' => 'ongoing'], 'vet_expense', 'cash');
        $livestock->saveHealthRecord(new Vaccination, ['flock_id' => $hens->id, 'vaccine' => 'Newcastle (ND) booster', 'date' => $start->addDays(2)->toDateString(),
            'next_due_date' => CarbonImmutable::today()->addDays(3)->toDateString(), 'dose' => 'Flock', 'vet_name' => 'Upazila Livestock Office', 'cost' => 120000], 'vaccine_expense', 'cash');
        foreach (array_slice($cows, 0, 4) as $cow) {
            $livestock->saveHealthRecord(new Vaccination, ['animal_id' => $cow->id, 'vaccine' => 'FMD', 'date' => $start->subMonths(5)->toDateString(),
                'next_due_date' => CarbonImmutable::today()->addDays(5)->toDateString(), 'dose' => '2 ml', 'vet_name' => 'Dr. Habibur Rahman', 'cost' => 15000], 'vaccine_expense', 'cash');
        }

        $today = CarbonImmutable::today()->toDateString();
        foreach ([['Feed milking cows', $staff['worker'], 'daily', 'high', '06:00'], ['Collect eggs — Shed A', $staff['worker'], 'daily', 'normal', '09:00'],
            ['Clean cow shed', $staff['worker'], 'daily', 'normal', '11:00'], ['Prepare milk deliveries', $staff['delivery'], 'daily', 'high', '06:30'],
            ['Check feed stock', $staff['manager'], 'weekly', 'normal', '17:00']] as [$title, $e, $rec, $prio, $time]) {
            FarmTask::create(['title' => $title, 'employee_id' => $e->id, 'due_date' => $today, 'due_time' => $time, 'priority' => $prio, 'recurrence' => $rec, 'status' => 'pending']);
        }
        FarmTask::create(['title' => 'Service milking machine', 'employee_id' => $staff['manager']->id, 'due_date' => CarbonImmutable::today()->subDays(2)->toDateString(),
            'priority' => 'normal', 'status' => 'pending']);

        app(CurrentFarm::class)->clear();
        app(AlertService::class)->run($farm);
    }
}
