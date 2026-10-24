<?php

namespace App\Domain\Purchasing;

use App\Domain\Accounting\Ledger;
use App\Domain\Inventory\InventoryLedger;
use App\Models\Bill;
use App\Models\BillAllocation;
use App\Models\Employee;
use App\Models\FeedItem;
use App\Models\SalaryPayment;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Support\FarmChanges;
use App\Support\Sequence;
use App\Support\Units;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Bills (expenses incurred) and supplier payments (cash paid), kept apart:
 *
 *   purchase bill → DR Feed inventory      CR Accounts payable  (+ stock in)
 *   expense bill  → DR <expense category>  CR Accounts payable
 *   asset bill    → DR <capital account>   CR Accounts payable
 *   payment       → DR Accounts payable    CR Cash/Bank/Wallet
 *
 * "Paid now" is just a bill plus an immediate payment, so paying a bill can
 * never record the expense a second time.
 */
final class PurchasingService
{
    public function __construct(private InventoryLedger $inventory) {}

    /**
     * @param  array<int, array{description:string, qty_milli:int, unit_price:int, feed_item_id?:int|null}>  $items
     * @param  array{method:string, amount?:int}|null  $payNow
     */
    public function createBill(array $data, array $items, ?array $payNow = null, ?Model $source = null): Bill
    {
        $kind = $data['kind'];
        $category = $kind === 'purchase' ? 'feed_inventory' : $data['category'];
        $validCategory = match ($kind) {
            'purchase' => true,
            'expense' => \App\Models\Account::where('key', $category)->where('type', 'expense')->exists(),
            'asset' => in_array($category, ['livestock_assets', 'equipment_assets'], true),
            default => false,
        };
        if (! $validCategory) {
            throw ValidationException::withMessages(['category' => 'Choose a valid category.']);
        }

        return DB::transaction(function () use ($data, $items, $payNow, $source, $kind, $category) {
            $lines = array_map(fn ($i) => $i + ['amount' => Units::lineAmount($i['qty_milli'], $i['unit_price'])], $items);
            $subtotal = array_sum(array_column($lines, 'amount'));
            $discount = $data['discount'] ?? 0;
            $extra = $data['extra_cost'] ?? 0;
            $total = $subtotal - $discount + $extra;
            if ($discount < 0 || $extra < 0 || $total <= 0) {
                throw ValidationException::withMessages(['total' => 'The bill total must be positive.']);
            }
            $farmId = app(\App\Support\CurrentFarm::class)->id();
            $supplierId = $data['supplier_id'] ?? null;

            $bill = new Bill([
                'number' => Sequence::next('BILL', $farmId), 'supplier_id' => $supplierId, 'date' => $data['date'],
                'due_date' => $data['due_date'] ?? null, 'kind' => $kind, 'category' => $category,
                'description' => $data['description'] ?? null, 'subtotal' => $subtotal, 'discount' => $discount,
                'extra_cost' => $extra, 'total' => $total, 'status' => 'unpaid', 'notes' => $data['notes'] ?? null,
                'user_id' => auth()->id(),
            ]);
            if ($source) {
                $bill->source()->associate($source);
            }
            if (! empty($data['related_type']) && ! empty($data['related_id'])) {
                $bill->related_type = $data['related_type'];
                $bill->related_id = $data['related_id'];
            }
            $bill->save();
            $bill->items()->createMany($lines);

            if ($kind === 'purchase') {
                $this->receiveStock($bill, $lines, $total);
            }

            $dims = match ($bill->related_type) {
                'animal' => ['animal_id' => $bill->related_id],
                'flock' => ['flock_id' => $bill->related_id],
                default => [],
            };
            Ledger::post($bill, $data['date'], "Bill {$bill->number}".($bill->description ? " — {$bill->description}" : ''), [
                ['account' => $category, 'debit' => $total] + $dims,
                ['account' => 'ap', 'credit' => $total, 'supplier_id' => $supplierId],
            ]);

            if ($payNow) {
                $this->paySupplier($supplierId ? Supplier::find($supplierId) : null, $payNow['amount'] ?? $total,
                    $data['date'], $payNow['method'], null, null, [$bill->id => min($payNow['amount'] ?? $total, $total)]);
            } elseif ($supplierId) {
                $this->applyCredits(Supplier::find($supplierId));
                $this->refreshBalance(Supplier::find($supplierId));
            }
            FarmChanges::touch('bills', 'expenses', 'suppliers');

            return $bill->fresh(['items']);
        });
    }

    /** Void an unpaid expense/asset bill (e.g. a treatment cost was corrected). */
    public function voidBill(Bill $bill): void
    {
        DB::transaction(function () use ($bill) {
            $bill = Bill::lockForUpdate()->findOrFail($bill->id);
            if ($bill->kind === 'purchase') {
                throw ValidationException::withMessages(['bill' => 'Purchase bills affect stock; correct them with a stock adjustment.']);
            }
            foreach ($bill->allocations()->get() as $a) {
                SupplierPayment::whereKey($a->supplier_payment_id)->increment('unallocated', $a->amount);
                $a->delete();
            }
            Ledger::unpost($bill);
            $bill->forceFill(['status' => 'void', 'paid' => 0, 'source_type' => null, 'source_id' => null])->save();
            if ($bill->supplier_id) {
                $this->refreshBalance(Supplier::find($bill->supplier_id));
            }
            FarmChanges::touch('bills', 'expenses', 'suppliers');
        });
    }

    /** @param array<int,int>|null $allocations bill_id => paisa; null = oldest-first */
    public function paySupplier(?Supplier $supplier, int $amount, string $date, string $method,
        ?string $reference = null, ?string $notes = null, ?array $allocations = null): SupplierPayment
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Amount must be positive.']);
        }

        return DB::transaction(function () use ($supplier, $amount, $date, $method, $reference, $notes, $allocations) {
            $payment = SupplierPayment::create([
                'supplier_id' => $supplier?->id, 'date' => $date, 'amount' => $amount, 'unallocated' => $amount,
                'method' => $method, 'reference' => $reference, 'notes' => $notes, 'user_id' => auth()->id(),
            ]);
            Ledger::post($payment, $date, 'Supplier payment'.($supplier ? " — {$supplier->name}" : ''), [
                ['account' => 'ap', 'debit' => $amount, 'supplier_id' => $supplier?->id],
                ['account' => Ledger::cashAccountFor($method), 'credit' => $amount],
            ]);
            foreach ($allocations ?? [] as $billId => $value) {
                $bill = Bill::lockForUpdate()->findOrFail($billId);
                if ($bill->supplier_id !== $supplier?->id) {
                    throw ValidationException::withMessages(['allocations' => 'Bill belongs to another supplier.']);
                }
                $this->allocate($payment, $bill, $value);
            }
            if ($supplier) {
                $this->applyCredits($supplier);
                $this->refreshBalance($supplier);
            }
            FarmChanges::touch('bills', 'suppliers', 'expenses');

            return $payment->fresh();
        });
    }

    /**
     * Salary, bonus or advance. Advances are an asset (money the worker owes
     * back); a later salary can recover them through `deduction`.
     */
    public function paySalary(Employee $employee, array $d): SalaryPayment
    {
        return DB::transaction(function () use ($employee, $d) {
            $gross = $d['gross'];
            $deduction = $d['type'] === 'salary' ? ($d['deduction'] ?? 0) : 0;
            if ($deduction > $gross) {
                throw ValidationException::withMessages(['deduction' => 'Deduction cannot exceed the gross amount.']);
            }
            $payment = SalaryPayment::create([
                'employee_id' => $employee->id, 'type' => $d['type'], 'period' => $d['period'] ?? null, 'date' => $d['date'],
                'gross' => $gross, 'deduction' => $deduction, 'net' => $gross - $deduction, 'method' => $d['method'],
                'notes' => $d['notes'] ?? null, 'user_id' => auth()->id(),
            ]);
            $cash = Ledger::cashAccountFor($d['method']);
            $lines = $d['type'] === 'advance'
                ? [['account' => 'staff_advances', 'debit' => $gross], ['account' => $cash, 'credit' => $gross]]
                : [['account' => 'salaries', 'debit' => $gross], ['account' => $cash, 'credit' => $gross - $deduction],
                    ['account' => 'staff_advances', 'credit' => $deduction]];
            Ledger::post($payment, $d['date'], ucfirst($d['type'])." — {$employee->name}", $lines);
            FarmChanges::touch('employees', 'expenses');

            return $payment;
        });
    }

    public function applyCredits(Supplier $supplier): void
    {
        $payments = SupplierPayment::where('supplier_id', $supplier->id)->where('unallocated', '>', 0)->orderBy('date')->orderBy('id')->lockForUpdate()->get();
        if ($payments->isEmpty()) {
            return;
        }
        $bills = Bill::where('supplier_id', $supplier->id)->whereIn('status', ['unpaid', 'partial'])->orderBy('date')->orderBy('id')->lockForUpdate()->get();
        foreach ($bills as $bill) {
            foreach ($payments as $payment) {
                $due = $bill->total - $bill->paid;
                if ($due <= 0) {
                    break;
                }
                if ($payment->unallocated > 0) {
                    $this->allocate($payment, $bill, min($due, $payment->unallocated));
                }
            }
        }
    }

    public function refreshBalance(Supplier $supplier): void
    {
        $billed = (int) Bill::where('supplier_id', $supplier->id)->where('status', '!=', 'void')->sum('total');
        $paid = (int) SupplierPayment::where('supplier_id', $supplier->id)->sum('amount');
        $supplier->forceFill(['balance' => $billed - $paid])->saveQuietly();
    }

    private function allocate(SupplierPayment $payment, Bill $bill, int $amount): void
    {
        if ($amount <= 0 || $amount > $bill->total - $bill->paid || $amount > $payment->unallocated || $bill->status === 'void') {
            throw ValidationException::withMessages(['allocations' => "Cannot allocate that amount to {$bill->number}."]);
        }
        BillAllocation::create(['supplier_payment_id' => $payment->id, 'bill_id' => $bill->id, 'amount' => $amount]);
        $payment->unallocated -= $amount;
        $payment->save();
        $bill->paid += $amount;
        $bill->status = $bill->paid >= $bill->total ? 'paid' : 'partial';
        $bill->save();
    }

    /** Spreads the landed total over stock lines (largest remainder) so inventory value == bill total exactly. */
    private function receiveStock(Bill $bill, array $lines, int $total): void
    {
        $stockLines = array_values(array_filter($lines, fn ($l) => ! empty($l['feed_item_id'])));
        if (count($stockLines) !== count($lines)) {
            throw ValidationException::withMessages(['items' => 'Every line of a purchase must be an inventory item.']);
        }
        $subtotal = max(1, array_sum(array_column($lines, 'amount')));
        $values = array_map(fn ($l) => intdiv($l['amount'] * $total, $subtotal), $stockLines);
        $values[count($values) - 1] += $total - array_sum($values);

        foreach ($stockLines as $i => $l) {
            $item = FeedItem::findOrFail($l['feed_item_id']);
            $this->inventory->receive($item, $l['qty_milli'], $values[$i], $bill->date->toDateString(), $bill, $l['batch_no'] ?? null);
        }
    }
}
