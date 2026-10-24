<?php

namespace Tests\Feature;

use App\Models\Bill;
use App\Models\FeedItem;
use App\Models\JournalEntry;
use Tests\TestCase;

/** Inventory, purchasing, poultry and veterinary flows. */
class OperationsFlowTest extends TestCase
{
    private function feedItem(string $sku = 'CON'): int
    {
        return $this->postKey('/api/inventory', ['sku' => $sku, 'name' => 'Concentrate', 'category' => 'concentrate', 'unit' => 'kg', 'min_stock' => '50'])
            ->assertCreated()->json('id');
    }

    public function test_purchase_raises_stock_at_landed_cost_and_payment_does_not_duplicate_expense(): void
    {
        $item = $this->feedItem();
        $supplier = $this->postKey('/api/suppliers', ['name' => 'Feed Co'])->json('id');
        $bill = $this->postKey('/api/bills', ['kind' => 'purchase', 'supplier_id' => $supplier, 'date' => today()->toDateString(),
            'extra_cost' => '100', 'discount' => '50', 'items' => [['feed_item_id' => $item, 'quantity' => '100', 'unit_price' => '50']]])
            ->assertCreated()->assertJsonPath('total', '5050.00')->json();

        $stock = $this->getJson('/api/inventory')->json('data.0');
        $this->assertSame('100.000', $stock['stock']);
        $this->assertSame('5050.00', $stock['stock_value']);
        $this->assertSame('50.50', $stock['avg_cost']);

        // Buying stock is not an expense; neither is paying for it.
        $this->postKey('/api/supplier-payments', ['bill_id' => $bill['id'], 'date' => today()->toDateString(), 'amount' => '5050', 'method' => 'bank'])->assertCreated();
        $this->assertSame('paid', Bill::find($bill['id'])->status);
        $this->assertSame('0.00', $this->getJson('/api/reports/pnl')->json('direct_costs'));
        $this->assertSame('0.00', $this->getJson('/api/reports/payables')->json('total'));
    }

    public function test_consumption_expenses_feed_at_average_cost_and_blocks_negative_stock(): void
    {
        $item = $this->feedItem();
        $this->postKey('/api/bills', ['kind' => 'purchase', 'date' => today()->toDateString(), 'paid' => true, 'method' => 'cash',
            'items' => [['feed_item_id' => $item, 'quantity' => '10', 'unit_price' => '40']]])->assertCreated();
        $flock = $this->postKey('/api/flocks', ['code' => 'H1', 'name' => 'Layers', 'species' => 'hen', 'purpose' => 'layer',
            'started_at' => today()->subWeeks(20)->toDateString(), 'initial_count' => 100])->json('id');

        $this->postKey('/api/inventory-issues', ['date' => today()->toDateString(), 'type' => 'consumption',
            'lines' => [['feed_item_id' => $item, 'quantity' => '2.5', 'target_type' => 'flock', 'target_id' => $flock]]])->assertCreated();
        $this->assertSame('7.500', $this->getJson('/api/inventory')->json('data.0.stock'));
        $this->assertSame('100.00', $this->getJson('/api/reports/pnl')->json('direct_costs'));
        $this->assertSame('100.00', $this->getJson('/api/reports/profitability?dimension=flock')->json('0.costs'));

        $this->postKey('/api/inventory-issues', ['date' => today()->toDateString(), 'type' => 'consumption',
            'lines' => [['feed_item_id' => $item, 'quantity' => '8']]])->assertStatus(422);
        $this->assertSame(7500, FeedItem::find($item)->stock_milli);
    }

    public function test_flock_daily_record_computes_closing_count_and_rejects_bad_entries(): void
    {
        $flock = $this->postKey('/api/flocks', ['code' => 'D1', 'name' => 'Ducks', 'species' => 'duck', 'purpose' => 'layer',
            'started_at' => today()->subWeeks(10)->toDateString(), 'initial_count' => 50])->json('id');
        $date = today()->subDay()->toDateString();

        $this->postKey("/api/flocks/{$flock}/records", ['date' => $date, 'added' => 5, 'deaths' => 2, 'sold' => 3, 'eggs' => 40,
            'eggs_sold' => 30, 'egg_price' => '15', 'paid_method' => 'cash'])->assertCreated()->assertJsonPath('closing_count', 50);
        $this->postKey("/api/flocks/{$flock}/records", ['date' => $date, 'eggs' => 1])->assertStatus(422);
        $this->postKey("/api/flocks/{$flock}/records", ['date' => today()->toDateString(), 'deaths' => 60])->assertStatus(422);

        $this->assertSame(50, $this->getJson("/api/flocks/{$flock}")->json('flock.current_count'));
        $this->assertSame('450.00', $this->getJson('/api/reports/pnl?from='.$date)->json('revenue.0.amount'));
        // Walk-in cash sale: the payment settles its own invoice, nothing left receivable.
        $this->assertSame('paid', \App\Models\Invoice::first()->status);
        $this->assertSame('0.00', $this->getJson('/api/invoices?from='.$date)->json('totals.due'));
    }

    public function test_treatment_cost_creates_exactly_one_linked_expense(): void
    {
        $cow = $this->postKey('/api/animals', ['tag' => 'C9', 'type' => 'cow', 'gender' => 'female', 'acquisition' => 'born'])->json('id');
        $t = $this->postKey('/api/treatments', ['animal_id' => $cow, 'date' => today()->toDateString(), 'diagnosis' => 'Fever',
            'cost' => '800', 'outcome' => 'ongoing'])->assertCreated()->json();
        $this->assertSame(1, Bill::where('status', '!=', 'void')->count());
        $this->assertSame('under_treatment', $this->getJson("/api/animals/{$cow}")->json('animal.health_status'));

        // Same cost again → no new bill. Changed cost → old voided, one new bill.
        $payload = ['animal_id' => $cow, 'date' => today()->toDateString(), 'diagnosis' => 'Fever', 'outcome' => 'recovered'];
        $this->putJson("/api/treatments/{$t['id']}", $payload + ['cost' => '800'])->assertOk();
        $this->assertSame(1, Bill::where('status', '!=', 'void')->count());
        $this->putJson("/api/treatments/{$t['id']}", $payload + ['cost' => '950'])->assertOk();
        $this->assertSame(1, Bill::where('status', '!=', 'void')->count());
        $this->assertSame('950.00', $this->getJson('/api/reports/pnl')->json('direct_costs'));
        $this->assertSame('healthy', $this->getJson("/api/animals/{$cow}")->json('animal.health_status'));
    }

    public function test_animal_purchase_is_capital_and_sale_is_revenue(): void
    {
        $cow = $this->postKey('/api/animals', ['tag' => 'B1', 'type' => 'cow', 'gender' => 'female', 'acquisition' => 'purchased',
            'purchase_price' => '120000', 'paid_method' => 'cash'])->assertCreated()->json('id');
        $this->assertSame('0.00', $this->getJson('/api/reports/pnl')->json('operating_expenses'));

        $this->postKey("/api/animals/{$cow}/status", ['status' => 'sold', 'date' => today()->toDateString(), 'sale_price' => '135000', 'paid_method' => 'cash'])
            ->assertOk()->assertJsonPath('status', 'sold');
        $this->assertSame('135000.00', $this->getJson('/api/reports/pnl')->json('total_revenue'));
        $this->postKey("/api/animals/{$cow}/status", ['status' => 'sold', 'date' => today()->toDateString(), 'sale_price' => '1'])->assertStatus(422);
        $this->assertSame(1, JournalEntry::where('source_type', 'invoice')->count());
        // History survives the sale.
        $this->getJson("/api/animals/{$cow}")->assertOk()->assertJsonPath('events.0.type', 'sale');
    }
}
