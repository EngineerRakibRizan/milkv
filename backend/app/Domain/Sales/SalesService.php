<?php

namespace App\Domain\Sales;

use App\Domain\Accounting\Ledger;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\Invoice;
use App\Models\PaymentAllocation;
use App\Support\FarmChanges;
use App\Support\Sequence;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Invoices (revenue recognition) and customer payments (cash collection).
 *
 *   invoice  → DR Accounts receivable   CR <sales account>
 *   payment  → DR Cash/Bank/Wallet       CR Accounts receivable
 *
 * Payments are allocated oldest-invoice-first. Any excess stays on the
 * payment as `unallocated` (an advance / customer credit) and is applied
 * automatically to the customer's next invoices. Advances never create revenue.
 */
final class SalesService
{
    /**
     * @param  array<int, array{description:string, qty_milli:int, unit_price:int}>  $items
     */
    public function createInvoice(?Customer $customer, string $date, string $category, array $items, int $discount = 0,
        ?Model $source = null, ?string $description = null, ?string $notes = null, ?string $dueDate = null, array $dims = []): Invoice
    {
        if (! str_ends_with($category, '_sales') && $category !== 'other_income') {
            throw ValidationException::withMessages(['category' => 'Invalid income category.']);
        }

        return DB::transaction(function () use ($customer, $date, $category, $items, $discount, $source, $description, $notes, $dueDate, $dims) {
            $lines = array_map(fn ($i) => $i + ['amount' => \App\Support\Units::lineAmount($i['qty_milli'], $i['unit_price'])], $items);
            $subtotal = array_sum(array_column($lines, 'amount'));
            if ($discount < 0 || $discount > $subtotal) {
                throw ValidationException::withMessages(['discount' => 'Discount cannot exceed the subtotal.']);
            }
            $farmId = app(\App\Support\CurrentFarm::class)->id();

            $invoice = new Invoice([
                'number' => Sequence::next('INV', $farmId), 'customer_id' => $customer?->id, 'date' => $date,
                'due_date' => $dueDate, 'category' => $category, 'description' => $description,
                'subtotal' => $subtotal, 'discount' => $discount, 'total' => $subtotal - $discount,
                'status' => 'unpaid', 'notes' => $notes, 'user_id' => auth()->id(),
            ]);
            if ($source) {
                $invoice->source()->associate($source);
            }
            $invoice->save();
            $invoice->items()->createMany($lines);

            if ($invoice->total > 0) {
                $dims = $dims ?: $this->dimensions($source);
                Ledger::post($invoice, $date, "Invoice {$invoice->number}".($customer ? " — {$customer->name}" : ''), [
                    ['account' => 'ar', 'debit' => $invoice->total, 'customer_id' => $customer?->id],
                    ['account' => $category, 'credit' => $invoice->total] + $dims,
                ]);
            }

            if ($customer) {
                $this->applyCredits($customer);
                $this->refreshBalance($customer);
            }
            FarmChanges::touch('invoices', 'customers', 'income');

            return $invoice;
        });
    }

    /** Re-price an invoice that came from a source document (e.g. delivered quantity corrected). */
    public function voidInvoice(Invoice $invoice, string $reason = 'Voided'): void
    {
        DB::transaction(function () use ($invoice, $reason) {
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if ($invoice->status === 'void') {
                return;
            }
            // Release allocations back to their payments as credit.
            foreach ($invoice->allocations()->get() as $alloc) {
                CustomerPayment::whereKey($alloc->customer_payment_id)->increment('unallocated', $alloc->amount);
                $alloc->delete();
            }
            Ledger::unpost($invoice);
            $invoice->update(['status' => 'void', 'paid' => 0, 'notes' => trim(($invoice->notes ?? '')."\n".$reason)]);
            // Free the unique source slot so the source can be invoiced again.
            $invoice->forceFill(['source_type' => null, 'source_id' => null])->save();

            if ($invoice->customer_id) {
                $customer = Customer::find($invoice->customer_id);
                $this->applyCredits($customer);
                $this->refreshBalance($customer);
            }
            FarmChanges::touch('invoices', 'customers', 'income');
        });
    }

    /**
     * @param  array<int,int>|null  $allocations  invoice_id => paisa; null = automatic oldest-first
     */
    public function receivePayment(?Customer $customer, int $amount, string $date, string $method,
        ?string $reference = null, ?string $notes = null, ?array $allocations = null): CustomerPayment
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Amount must be positive.']);
        }

        return DB::transaction(function () use ($customer, $amount, $date, $method, $reference, $notes, $allocations) {
            $payment = CustomerPayment::create([
                'customer_id' => $customer?->id, 'date' => $date, 'amount' => $amount, 'unallocated' => $amount,
                'method' => $method, 'reference' => $reference, 'notes' => $notes, 'user_id' => auth()->id(),
            ]);

            Ledger::post($payment, $date, 'Payment received'.($customer ? " — {$customer->name}" : ''), [
                ['account' => Ledger::cashAccountFor($method), 'debit' => $amount],
                ['account' => 'ar', 'credit' => $amount, 'customer_id' => $customer?->id],
            ]);

            // Explicit allocations; a walk-in (no customer) cash sale settles its own walk-in invoice.
            foreach ($allocations ?? [] as $invoiceId => $value) {
                $invoice = Invoice::where('customer_id', $customer?->id)->lockForUpdate()->findOrFail($invoiceId);
                $this->allocate($payment, $invoice, $value);
            }
            if ($customer) {
                $this->applyCredits($customer);
                $this->refreshBalance($customer);
            }
            FarmChanges::touch('payments', 'invoices', 'customers');

            return $payment->fresh();
        });
    }

    /** "Paid now": settles whatever is still due on the invoice (advances may already cover part of it). */
    public function settleNow(Invoice $invoice, string $method, string $date): ?CustomerPayment
    {
        $invoice->refresh();
        $due = $invoice->total - $invoice->paid;
        if ($due <= 0) {
            return null;
        }
        $customer = $invoice->customer_id ? Customer::find($invoice->customer_id) : null;

        return $this->receivePayment($customer, $due, $date, $method, allocations: [$invoice->id => $due]);
    }

    /** Applies every open payment credit of the customer to open invoices, oldest first. */
    public function applyCredits(Customer $customer): void
    {
        $payments = CustomerPayment::where('customer_id', $customer->id)->where('unallocated', '>', 0)
            ->orderBy('date')->orderBy('id')->lockForUpdate()->get();
        if ($payments->isEmpty()) {
            return;
        }
        $invoices = Invoice::where('customer_id', $customer->id)->whereIn('status', ['unpaid', 'partial'])
            ->orderBy('date')->orderBy('id')->lockForUpdate()->get();

        foreach ($invoices as $invoice) {
            foreach ($payments as $payment) {
                $due = $invoice->total - $invoice->paid;
                if ($due <= 0) {
                    break;
                }
                if ($payment->unallocated > 0) {
                    $this->allocate($payment, $invoice, min($due, $payment->unallocated));
                }
            }
        }
    }

    public function refreshBalance(Customer $customer): void
    {
        $invoiced = (int) Invoice::where('customer_id', $customer->id)->where('status', '!=', 'void')->sum('total');
        $paid = (int) CustomerPayment::where('customer_id', $customer->id)->sum('amount');
        $customer->forceFill(['balance' => $invoiced - $paid])->saveQuietly();
    }

    private function allocate(CustomerPayment $payment, Invoice $invoice, int $amount): void
    {
        $due = $invoice->total - $invoice->paid;
        if ($amount <= 0 || $amount > $due || $amount > $payment->unallocated || $invoice->status === 'void') {
            throw ValidationException::withMessages(['allocations' => "Cannot allocate that amount to {$invoice->number}."]);
        }
        PaymentAllocation::create(['customer_payment_id' => $payment->id, 'invoice_id' => $invoice->id, 'amount' => $amount]);
        $payment->unallocated -= $amount;
        $payment->save();
        $invoice->paid += $amount;
        $invoice->status = $invoice->paid >= $invoice->total ? 'paid' : 'partial';
        $invoice->save();
    }

    private function dimensions(?Model $source): array
    {
        return match ($source?->getMorphClass()) {
            'animal' => ['animal_id' => $source->getKey()],
            'flock' => ['flock_id' => $source->getKey()],
            'flock_record' => ['flock_id' => $source->flock_id],
            default => [],
        };
    }
}
