<?php

namespace Tests\Feature;

use App\Domain\Milk\MilkLedger;
use App\Models\Customer;
use App\Models\Delivery;
use App\Models\Farm;
use App\Models\FeedItem;
use App\Models\Invoice;
use App\Models\InventoryMovement;
use App\Models\JournalLine;
use App\Models\MilkMovement;
use App\Models\MilkRecord;
use App\Models\Supplier;
use App\Models\User;
use App\Support\CurrentFarm;
use Database\Seeders\DatabaseSeeder;
use Tests\TestCase;

/**
 * Runs the full 30-day demo through the domain services, then proves every
 * cached total agrees with its ledger and the dashboard agrees with reports.
 */
class ReconciliationTest extends TestCase
{
    public function test_demo_farm_books_reconcile(): void
    {
        $this->seed(DatabaseSeeder::class);
        $farm = Farm::where('name', 'like', 'Aura Dairy%')->firstOrFail();
        app(CurrentFarm::class)->set($farm, 'owner');
        $bal = fn (string $key) => (int) JournalLine::join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('accounts.key', $key)->selectRaw('COALESCE(SUM(debit) - SUM(credit), 0) as v')->value('v');

        $tb = JournalLine::selectRaw('SUM(debit) as d, SUM(credit) as c')->first();
        $this->assertSame((int) $tb->d, (int) $tb->c, 'trial balance');
        $this->assertGreaterThan(0, (int) $tb->d);

        $this->assertSame($bal('ar'), (int) Customer::sum('balance'), 'AR = customer balances');
        $this->assertSame($bal('feed_inventory'), (int) FeedItem::sum('stock_value'), 'inventory account = item values');
        $this->assertSame((int) InventoryMovement::sum('value'), (int) FeedItem::sum('stock_value'), 'item values = movements');
        foreach (FeedItem::all() as $f) {
            $this->assertSame((int) InventoryMovement::where('feed_item_id', $f->id)->sum('qty_milli'), $f->stock_milli, $f->name);
            $this->assertGreaterThanOrEqual(0, $f->stock_milli);
        }
        $unassigned = (int) \App\Models\Bill::whereNull('supplier_id')->where('status', '!=', 'void')->selectRaw('COALESCE(SUM(total - paid),0) as v')->value('v');
        $this->assertSame(-$bal('ap'), (int) Supplier::sum('balance') + $unassigned, 'AP = supplier balances');

        $produced = (int) MilkRecord::sum('total_ml');
        $delivered = (int) Delivery::whereIn('status', ['delivered', 'partial'])->sum('delivered_ml');
        $other = -(int) MilkMovement::whereIn('type', ['internal_use', 'spoilage'])->sum('qty_ml');
        $this->assertSame($produced - $delivered - $other, app(MilkLedger::class)->available(), 'milk reconciles');
        $this->assertGreaterThanOrEqual(0, app(MilkLedger::class)->available());

        $revenue = -array_sum(array_map($bal, ['milk_sales', 'egg_sales', 'animal_sales', 'poultry_sales', 'manure_sales', 'other_income']));
        $this->assertSame((int) Invoice::where('status', '!=', 'void')->sum('total'), $revenue, 'revenue = invoices');
        $this->assertSame(0, Invoice::whereNotNull('source_id')->groupBy('source_type', 'source_id')->havingRaw('COUNT(*) > 1')->count());

        // Dashboard numbers come from the same ledger as the reports.
        app(CurrentFarm::class)->clear();
        $this->actingAsMember(User::where('email', 'owner@farmos.test')->first(), $farm);
        // Use a serializing cache like production; the second call is served from cache.
        config(['cache.default' => 'file']);
        \Illuminate\Support\Facades\Cache::flush();
        $this->getJson('/api/dashboard')->assertOk();
        $dash = $this->getJson('/api/dashboard')->assertOk();
        $this->assertStringNotContainsString('__PHP_Incomplete_Class', $dash->getContent());
        $this->assertIsInt($dash->json('deliveries_today.delivered') ?? 0);
        $pnl = $this->getJson('/api/reports/pnl?from='.now()->startOfMonth()->toDateString())->assertOk();
        $this->assertSame($pnl->json('net_profit'), $dash->json('finance.month_profit'));
        $this->assertSame($this->getJson('/api/reports/receivables')->json('total'), $dash->json('finance.receivables'));
        $this->assertSame(10, $dash->json('counts.cows'));
        $this->assertNotEmpty($dash->json('alerts'));

        // Smoke: every read endpoint answers 200 on a realistic dataset (catches lazy-loading
        // and missing-attribute errors that strict mode raises only with real rows).
        $from = now()->subDays(40)->toDateString();
        $to = now()->toDateString();
        foreach ([
            '/api/farm', '/api/farm/members', '/api/accounts', '/api/audit', '/api/notifications',
            '/api/animals', '/api/animals?status=all&search=GV', '/api/animals/1', '/api/flocks', '/api/flocks/1',
            '/api/inventory', '/api/inventory-movements', '/api/treatments', '/api/vaccinations?upcoming=1',
            "/api/milk/sheet?date={$to}", "/api/milk/history?from={$from}&to={$to}", '/api/milk/movements',
            '/api/customers', '/api/customers?balance=due', '/api/customers/1', "/api/customers/1/statement?from={$from}&to={$to}",
            "/api/deliveries?date={$to}", "/api/invoices?from={$from}&to={$to}", '/api/invoices/1', "/api/payments?from={$from}&to={$to}",
            '/api/suppliers', '/api/suppliers/1', "/api/bills?from={$from}&to={$to}", '/api/bills/1',
            '/api/employees', '/api/employees/1', '/api/tasks', '/api/tasks?view=done',
            ...array_map(fn ($r) => "/api/reports/{$r}?from={$from}&to={$to}", ['pnl', 'cashflow', 'receivables', 'payables', 'segments', 'profitability', 'milk', 'feed']),
            "/api/reports/profitability?dimension=flock&from={$from}&to={$to}", "/api/reports/ledger?account=cash&from={$from}&to={$to}",
        ] as $url) {
            $this->getJson($url)->assertOk();
        }
    }
}
