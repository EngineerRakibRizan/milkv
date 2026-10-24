<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Invoice;
use App\Models\JournalEntry;
use Tests\TestCase;

/** Milk production → delivery → invoice → payment, end to end through the API. */
class MilkSalesFlowTest extends TestCase
{
    private int $cowId;

    private int $customerId;

    private string $today;

    protected function setUp(): void
    {
        parent::setUp();
        $this->today = today()->toDateString();
        $this->cowId = $this->postKey('/api/animals', ['tag' => 'C1', 'type' => 'cow', 'gender' => 'female', 'acquisition' => 'born',
            'lactation_status' => 'lactating'])->assertCreated()->json('id');
        $this->customerId = $this->postKey('/api/customers', ['name' => 'Karim', 'type' => 'household', 'default_qty' => '3',
            'price' => '100', 'schedule' => 'daily', 'payment_terms' => 'monthly', 'status' => 'active'])->assertCreated()->json('id');
    }

    private function milk(string $morning, string $evening = '0'): void
    {
        $this->postKey('/api/milk/sheet', ['date' => $this->today, 'rows' => [['animal_id' => $this->cowId, 'morning' => $morning, 'evening' => $evening]]])
            ->assertOk();
    }

    public function test_milking_sheet_totals_and_stock(): void
    {
        $this->milk('6.5', '5.25');
        $sheet = $this->getJson("/api/milk/sheet?date={$this->today}")->assertOk();
        $this->assertSame('11.750', $sheet->json('rows.0.total'));
        $this->assertSame('11.750', $sheet->json('summary.stock'));

        // Re-saving the same sheet is idempotent; editing replaces, never adds.
        $this->milk('6.5', '5.25');
        $this->milk('7', '5');
        $this->assertSame('12.000', $this->getJson("/api/milk/sheet?date={$this->today}")->json('summary.produced'));
    }

    public function test_delivery_posts_invoice_once_and_reduces_stock(): void
    {
        $this->milk('10');
        $this->postKey('/api/deliveries/generate', ['date' => $this->today])->assertOk()->assertJsonPath('created', 1);
        $delivery = Delivery::first();

        $this->patchJson("/api/deliveries/{$delivery->id}", ['status' => 'delivered'])
            ->assertOk()->assertJsonPath('status', 'delivered')->assertJsonPath('amount', '300.00');

        // Repeating the same status change does not invoice twice.
        $this->patchJson("/api/deliveries/{$delivery->id}", ['status' => 'delivered'])->assertOk();
        $this->assertSame(1, Invoice::where('status', '!=', 'void')->count());
        $this->assertSame('7.000', $this->getJson("/api/milk/sheet?date={$this->today}")->json('summary.stock'));
        $this->assertSame('300.00', $this->getJson("/api/customers/{$this->customerId}")->json('customer.balance'));
    }

    public function test_cannot_sell_more_milk_than_available(): void
    {
        $this->milk('2');
        $this->postKey('/api/deliveries/generate', ['date' => $this->today]);
        $delivery = Delivery::first();
        $this->patchJson("/api/deliveries/{$delivery->id}", ['status' => 'delivered'])->assertStatus(422)->assertJsonValidationErrors('quantity');
        $this->assertSame(0, Invoice::count());
        $this->assertSame('pending', $delivery->fresh()->status);
    }

    public function test_partial_then_cancel_releases_stock_and_voids_invoice(): void
    {
        $this->milk('10');
        $this->postKey('/api/deliveries/generate', ['date' => $this->today]);
        $id = Delivery::first()->id;

        $this->patchJson("/api/deliveries/{$id}", ['status' => 'delivered', 'delivered' => '2'])->assertJsonPath('status', 'partial')->assertJsonPath('amount', '200.00');
        $this->patchJson("/api/deliveries/{$id}", ['status' => 'partial', 'delivered' => '2.5'])->assertJsonPath('amount', '250.00');
        $this->assertSame(1, Invoice::where('status', '!=', 'void')->count());
        $this->assertSame('7.500', $this->getJson("/api/milk/sheet?date={$this->today}")->json('summary.stock'));

        $this->patchJson("/api/deliveries/{$id}", ['status' => 'cancelled'])->assertOk();
        $this->assertSame(0, Invoice::where('status', '!=', 'void')->count());
        $this->assertSame('10.000', $this->getJson("/api/milk/sheet?date={$this->today}")->json('summary.stock'));
        $this->assertSame('0.00', $this->getJson("/api/customers/{$this->customerId}")->json('customer.balance'));
    }

    public function test_payments_allocate_oldest_first_and_advances_carry_forward(): void
    {
        $this->milk('20');
        foreach ([2, 1] as $daysAgo) {
            $this->postKey('/api/deliveries', ['customer_id' => $this->customerId, 'date' => today()->subDays($daysAgo)->toDateString(), 'quantity' => '3']);
        }
        foreach (Delivery::all() as $d) {
            $this->patchJson("/api/deliveries/{$d->id}", ['status' => 'delivered'])->assertOk();
        }

        // ৳400 against ৳600 owed: oldest invoice fully paid, next one partial.
        $this->postKey('/api/payments', ['customer_id' => $this->customerId, 'date' => $this->today, 'amount' => '400', 'method' => 'bkash'])->assertCreated();
        $statuses = Invoice::orderBy('date')->pluck('status')->all();
        $this->assertSame(['paid', 'partial'], $statuses);

        // Overpay: ৳500 more leaves a ৳300 advance (negative balance), no extra revenue.
        $this->postKey('/api/payments', ['customer_id' => $this->customerId, 'date' => $this->today, 'amount' => '500', 'method' => 'cash'])->assertCreated();
        $this->assertSame('-300.00', $this->getJson("/api/customers/{$this->customerId}")->json('customer.balance'));
        $this->assertSame('600.00', $this->getJson('/api/reports/pnl?from='.today()->subDays(5)->toDateString())->json('total_revenue'));

        // The advance pays the next delivery automatically.
        $this->postKey('/api/deliveries', ['customer_id' => $this->customerId, 'date' => $this->today, 'quantity' => '3']);
        $this->patchJson('/api/deliveries/'.Delivery::latest('id')->first()->id, ['status' => 'delivered'])->assertOk();
        $this->assertSame('paid', Invoice::latest('id')->first()->status);
        $this->assertSame('0.00', $this->getJson("/api/customers/{$this->customerId}")->json('customer.balance'));

        $statement = $this->getJson("/api/customers/{$this->customerId}/statement?from=".today()->subDays(5)->toDateString().'&to='.$this->today)->assertOk();
        $this->assertSame('0.00', $statement->json('closing'));
        $this->assertSame('900.00', $statement->json('total_debit'));
    }

    public function test_idempotency_key_replays_instead_of_double_posting(): void
    {
        $key = 'retry-key-123';
        $first = $this->postKey('/api/payments', ['customer_id' => $this->customerId, 'date' => $this->today, 'amount' => '250', 'method' => 'cash'], $key)->assertCreated();
        $second = $this->postKey('/api/payments', ['customer_id' => $this->customerId, 'date' => $this->today, 'amount' => '250', 'method' => 'cash'], $key);

        $second->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(1, JournalEntry::where('source_type', 'customer_payment')->count());
    }
}
