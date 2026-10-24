<?php

namespace App\Domain\Sales;

use App\Domain\Milk\MilkLedger;
use App\Models\Customer;
use App\Models\Delivery;
use App\Models\Invoice;
use App\Support\FarmChanges;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * Milk delivery workflow. A delivery becomes a sale only when it is confirmed
 * as delivered/partially delivered: then, in one atomic step, the milk leaves
 * stock and an invoice is posted. Going back (cancel, quantity change)
 * releases the stock and voids the invoice, so nothing is ever counted twice.
 */
final class DeliveryService
{
    public const STATUSES = ['pending', 'prepared', 'out_for_delivery', 'delivered', 'partial', 'cancelled'];

    private const COMPLETED = ['delivered', 'partial'];

    public function __construct(private MilkLedger $milk, private SalesService $sales) {}

    /** Creates the day's deliveries from active customers' default quantities. Skips existing ones. */
    public function generateForDate(string $date): int
    {
        $day = CarbonImmutable::parse($date);
        $defaultPrice = app(\App\Support\CurrentFarm::class)->farm()->default_milk_price;
        $existing = Delivery::where('date', $date)->pluck('customer_id')->all();
        $created = 0;

        Customer::where('status', 'active')->where('default_qty_ml', '>', 0)->whereNotIn('id', $existing)
            ->get()->each(function (Customer $c) use ($day, $date, $defaultPrice, &$created) {
                $due = match ($c->schedule) {
                    'daily' => true,
                    'alternate' => $day->dayOfYear % 2 === 0,
                    'weekly' => $c->joined_at ? $c->joined_at->dayOfWeek === $day->dayOfWeek : $day->isFriday(),
                    default => false,
                };
                if ($due) {
                    Delivery::create([
                        'customer_id' => $c->id, 'date' => $date, 'employee_id' => $c->employee_id,
                        'ordered_ml' => $c->default_qty_ml, 'unit_price' => $c->price ?? $defaultPrice, 'status' => 'pending',
                    ]);
                    $created++;
                }
            });
        if ($created) {
            FarmChanges::touch('deliveries');
        }

        return $created;
    }

    /**
     * Moves a delivery to a new status. For completed statuses $deliveredMl is
     * the actual quantity handed over (defaults to the ordered quantity).
     */
    public function transition(Delivery $delivery, string $status, ?int $deliveredMl = null, ?int $collect = null, string $method = 'cash'): Delivery
    {
        if (! in_array($status, self::STATUSES, true)) {
            throw ValidationException::withMessages(['status' => 'Unknown status.']);
        }

        return $this->milk->locked(function () use ($delivery, $status, $deliveredMl, $collect, $method) {
            $delivery = Delivery::lockForUpdate()->findOrFail($delivery->id);
            $wasCompleted = in_array($delivery->status, self::COMPLETED, true);
            $willComplete = in_array($status, self::COMPLETED, true);
            $qty = $willComplete ? ($deliveredMl ?? ($status === 'delivered' ? $delivery->ordered_ml : 0)) : 0;

            if ($willComplete && $qty <= 0) {
                throw ValidationException::withMessages(['delivered_qty' => 'Enter the quantity actually delivered.']);
            }
            if ($status === 'delivered' && $qty < $delivery->ordered_ml) {
                $status = 'partial';
            }

            // Undo a previous completion if the quantity or status changes.
            if ($wasCompleted && (! $willComplete || $qty !== $delivery->delivered_ml)) {
                $this->undoSale($delivery);
            }

            $delivery->status = $status;
            if ($willComplete && (! $wasCompleted || $qty !== $delivery->delivered_ml || ! $delivery->invoice_id)) {
                $this->milk->out('delivery', $qty, $delivery->date->toDateString(), $delivery,
                    "Delivery to customer #{$delivery->customer_id}");
                $amount = max(0, \App\Support\Units::lineAmount($qty, $delivery->unit_price) - $delivery->discount);
                $delivery->fill(['delivered_ml' => $qty, 'amount' => $amount, 'delivered_at' => now()]);
                $delivery->save();

                $invoice = $this->sales->createInvoice(
                    Customer::find($delivery->customer_id), $delivery->date->toDateString(), 'milk_sales',
                    [['description' => 'Milk delivery '.$delivery->date->toDateString(), 'qty_milli' => $qty, 'unit_price' => $delivery->unit_price]],
                    min($delivery->discount, \App\Support\Units::lineAmount($qty, $delivery->unit_price)), $delivery,
                );
                $delivery->invoice_id = $invoice->id;
            }
            $delivery->save();

            if ($willComplete && $collect) {
                $this->sales->receivePayment(Customer::find($delivery->customer_id), $collect, $delivery->date->toDateString(), $method,
                    notes: "Collected on delivery #{$delivery->id}");
            }
            FarmChanges::touch('deliveries');

            return $delivery->fresh(['customer', 'employee']);
        });
    }

    private function undoSale(Delivery $delivery): void
    {
        $this->milk->release($delivery);
        if ($delivery->invoice_id && ($invoice = Invoice::find($delivery->invoice_id))) {
            $this->sales->voidInvoice($invoice, "Delivery #{$delivery->id} changed");
        }
        $delivery->fill(['invoice_id' => null, 'delivered_ml' => 0, 'amount' => 0, 'delivered_at' => null]);
    }
}
