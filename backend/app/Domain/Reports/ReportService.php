<?php

namespace App\Domain\Reports;

use App\Models\Bill;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Models\MilkMovement;
use App\Models\MilkRecord;
use App\Models\Supplier;
use App\Support\Units;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Every financial figure is read from the journal, so P&L, cash flow,
 * receivables and the dashboard always agree with each other.
 */
final class ReportService
{
    /** Sum of (debit − credit) per account for a period. */
    private function accountTotals(string $from, string $to, array $types)
    {
        return JournalLine::query()
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereBetween('journal_lines.date', [$from, $to])
            ->whereIn('accounts.type', $types)
            ->groupBy('accounts.key', 'accounts.name', 'accounts.type', 'accounts.section', 'accounts.code')
            ->orderBy('accounts.code')
            ->selectRaw('accounts.key, accounts.name, accounts.type, accounts.section, accounts.code, SUM(journal_lines.debit) - SUM(journal_lines.credit) as net')
            ->get();
    }

    public function profitAndLoss(string $from, string $to): array
    {
        $rows = $this->accountTotals($from, $to, ['revenue', 'expense']);
        $revenue = $rows->where('type', 'revenue')->map(fn ($r) => ['key' => $r->key, 'name' => $r->name, 'amount' => -(int) $r->net])->values();
        $expenses = $rows->where('type', 'expense')->map(fn ($r) => ['key' => $r->key, 'name' => $r->name, 'section' => $r->section, 'amount' => (int) $r->net])->values();
        $totalRevenue = $revenue->sum('amount');
        $direct = $expenses->where('section', 'direct')->sum('amount');
        $operating = $expenses->where('section', '!=', 'direct')->sum('amount');

        return [
            'from' => $from, 'to' => $to,
            'revenue' => $revenue->map(fn ($r) => [...$r, 'amount' => Units::m($r['amount'])])->all(),
            'expenses' => $expenses->map(fn ($r) => [...$r, 'amount' => Units::m($r['amount'])])->all(),
            'total_revenue' => Units::m($totalRevenue),
            'direct_costs' => Units::m($direct),
            'gross_profit' => Units::m($totalRevenue - $direct),
            'operating_expenses' => Units::m($operating),
            'net_profit' => Units::m($totalRevenue - $direct - $operating),
        ];
    }

    public function cashFlow(string $from, string $to): array
    {
        $cash = fn ($q) => $q->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')->where('accounts.section', 'cash');
        $opening = (int) $cash(JournalLine::query())->where('journal_lines.date', '<', $from)
            ->selectRaw('COALESCE(SUM(debit) - SUM(credit), 0) as v')->value('v');

        $bySource = $cash(JournalLine::query())
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->whereBetween('journal_lines.date', [$from, $to])
            ->groupBy('journal_entries.source_type')
            ->selectRaw('journal_entries.source_type as source, SUM(debit) as inflow, SUM(credit) as outflow')
            ->get();

        $byAccount = $cash(JournalLine::query())->whereBetween('journal_lines.date', [$from, $to])
            ->groupBy('accounts.key', 'accounts.name')->selectRaw('accounts.key, accounts.name, SUM(debit) as inflow, SUM(credit) as outflow')->get();

        $labels = ['customer_payment' => 'Collections from customers', 'supplier_payment' => 'Payments to suppliers',
            'salary_payment' => 'Salaries & advances', 'invoice' => 'Cash sales', 'bill' => 'Cash purchases'];
        $in = (int) $bySource->sum('inflow');
        $out = (int) $bySource->sum('outflow');

        return [
            'from' => $from, 'to' => $to, 'opening' => Units::m($opening),
            'inflow' => Units::m($in), 'outflow' => Units::m($out), 'net' => Units::m($in - $out), 'closing' => Units::m($opening + $in - $out),
            'by_activity' => $bySource->map(fn ($r) => ['activity' => $labels[$r->source] ?? ucfirst(str_replace('_', ' ', $r->source)),
                'inflow' => Units::m((int) $r->inflow), 'outflow' => Units::m((int) $r->outflow)])->values()->all(),
            'by_account' => $byAccount->map(fn ($r) => ['account' => $r->name, 'inflow' => Units::m((int) $r->inflow), 'outflow' => Units::m((int) $r->outflow)])->values()->all(),
        ];
    }

    public function receivables(): array
    {
        $today = CarbonImmutable::today();
        $open = Invoice::whereIn('status', ['unpaid', 'partial'])->whereNotNull('customer_id')
            ->get(['customer_id', 'date', 'due_date', 'total', 'paid']);
        $aging = [];
        foreach ($open as $inv) {
            $days = ($inv->due_date ?? $inv->date)->diffInDays($today, false);
            $bucket = $days <= 30 ? 'current' : ($days <= 60 ? 'd31_60' : ($days <= 90 ? 'd61_90' : 'd90_plus'));
            $aging[$inv->customer_id][$bucket] = ($aging[$inv->customer_id][$bucket] ?? 0) + $inv->total - $inv->paid;
        }
        $customers = Customer::where('balance', '!=', 0)->orderByDesc('balance')->get(['id', 'code', 'name', 'phone', 'area', 'balance']);

        return [
            'total' => Units::m((int) $customers->where('balance', '>', 0)->sum('balance')),
            'advances' => Units::m(-(int) $customers->where('balance', '<', 0)->sum('balance')),
            'customers' => $customers->map(fn ($c) => [
                'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'phone' => $c->phone, 'area' => $c->area,
                'balance' => Units::m($c->balance),
                'aging' => array_map(fn ($v) => Units::m($v), $aging[$c->id] ?? []),
            ])->all(),
        ];
    }

    public function payables(): array
    {
        $suppliers = Supplier::where('balance', '!=', 0)->orderByDesc('balance')->get(['id', 'name', 'phone', 'balance']);
        $unassigned = (int) Bill::whereNull('supplier_id')->whereIn('status', ['unpaid', 'partial'])->sum(DB::raw('total - paid'));

        return [
            'total' => Units::m((int) $suppliers->sum('balance') + $unassigned),
            'unassigned' => Units::m($unassigned),
            'suppliers' => $suppliers->map(fn ($s) => ['id' => $s->id, 'name' => $s->name, 'phone' => $s->phone, 'balance' => Units::m($s->balance)])->all(),
        ];
    }

    /**
     * Profit by business area. Direct postings carry an animal or flock
     * dimension; sales accounts without a dimension are assigned by product.
     * Shared overheads stay "unallocated" rather than being guessed.
     */
    public function segments(string $from, string $to): array
    {
        $rows = JournalLine::query()->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereBetween('journal_lines.date', [$from, $to])->whereIn('accounts.type', ['revenue', 'expense'])
            ->selectRaw("CASE
                WHEN journal_lines.animal_id IS NOT NULL OR accounts.key IN ('milk_sales','animal_sales') THEN 'dairy'
                WHEN journal_lines.flock_id IS NOT NULL OR accounts.key IN ('egg_sales','poultry_sales') THEN 'poultry'
                ELSE 'unallocated' END as segment, accounts.type, SUM(debit) - SUM(credit) as net")
            ->groupBy('segment', 'accounts.type')->get();

        $out = [];
        foreach (['dairy', 'poultry', 'unallocated'] as $seg) {
            $rev = -(int) $rows->where('segment', $seg)->where('type', 'revenue')->sum('net');
            $exp = (int) $rows->where('segment', $seg)->where('type', 'expense')->sum('net');
            $out[] = ['segment' => $seg, 'revenue' => Units::m($rev), 'costs' => Units::m($exp), 'profit' => Units::m($rev - $exp)];
        }

        return $out;
    }

    /** Direct revenue and cost per animal or flock. */
    public function unitProfitability(string $dimension, string $from, string $to): array
    {
        $col = $dimension === 'flock' ? 'flock_id' : 'animal_id';
        $table = $dimension === 'flock' ? 'flocks' : 'animals';
        $label = $dimension === 'flock' ? "{$table}.name" : "COALESCE({$table}.name, {$table}.tag)";

        $rows = JournalLine::query()->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->join($table, "{$table}.id", '=', "journal_lines.{$col}")
            ->whereBetween('journal_lines.date', [$from, $to])->whereIn('accounts.type', ['revenue', 'expense'])
            ->groupBy("journal_lines.{$col}", "{$table}.name", $dimension === 'flock' ? "{$table}.code" : "{$table}.tag")
            ->selectRaw("journal_lines.{$col} as id, {$label} as label,
                SUM(CASE WHEN accounts.type = 'revenue' THEN credit - debit ELSE 0 END) as revenue,
                SUM(CASE WHEN accounts.type = 'expense' THEN debit - credit ELSE 0 END) as costs")
            ->get();

        // Milk revenue is booked per customer, not per cow: estimate each cow's share by litres produced.
        $milkShare = [];
        if ($dimension === 'animal') {
            $milkRevenue = -(int) JournalLine::query()->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
                ->whereBetween('journal_lines.date', [$from, $to])->where('accounts.key', 'milk_sales')
                ->selectRaw('COALESCE(SUM(debit) - SUM(credit), 0) as v')->value('v');
            $litres = MilkRecord::whereBetween('date', [$from, $to])->groupBy('animal_id')->selectRaw('animal_id, SUM(total_ml) as ml')->pluck('ml', 'animal_id');
            $all = max(1, (int) $litres->sum());
            foreach ($litres as $animalId => $ml) {
                $milkShare[$animalId] = intdiv($milkRevenue * (int) $ml, $all);
            }
            $missing = array_diff(array_keys($milkShare), $rows->pluck('id')->all());
            if ($missing) {
                $names = \App\Models\Animal::whereIn('id', $missing)->get(['id', 'tag', 'name']);
                foreach ($names as $a) {
                    $rows->push((object) ['id' => $a->id, 'label' => $a->name ?? $a->tag, 'revenue' => 0, 'costs' => 0]);
                }
            }
        }

        return $rows->map(function ($r) use ($milkShare) {
            $est = $milkShare[$r->id] ?? 0;
            $rev = (int) $r->revenue + $est;

            return ['id' => $r->id, 'label' => $r->label, 'revenue' => Units::m($rev), 'estimated_milk_revenue' => Units::m($est),
                'costs' => Units::m((int) $r->costs), 'profit' => Units::m($rev - (int) $r->costs)];
        })->sortByDesc(fn ($r) => (float) $r['profit'])->values()->all();
    }

    public function milkSummary(string $from, string $to): array
    {
        $daily = MilkMovement::whereBetween('date', [$from, $to])->groupBy('date', 'type')
            ->selectRaw('date, type, SUM(qty_ml) as ml')->get();
        $byCow = MilkRecord::query()->join('animals', 'animals.id', '=', 'milk_records.animal_id')
            ->whereBetween('milk_records.date', [$from, $to])->groupBy('animals.id', 'animals.tag', 'animals.name')
            ->selectRaw('animals.id, animals.tag, animals.name, SUM(total_ml) as ml, COUNT(*) as days')
            ->orderByDesc('ml')->get();

        $produced = (int) $daily->where('type', 'production')->sum('ml');
        $feedCost = (int) JournalLine::query()->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereBetween('journal_lines.date', [$from, $to])->whereNotNull('journal_lines.animal_id')
            ->where('accounts.type', 'expense')->selectRaw('COALESCE(SUM(debit) - SUM(credit), 0) as v')->value('v');

        $byDate = [];
        foreach ($daily as $r) {
            $d = $r->date->toDateString();
            $byDate[$d] ??= ['date' => $d, 'production' => 0, 'delivery' => 0, 'internal_use' => 0, 'spoilage' => 0, 'adjustment' => 0];
            $byDate[$d][$r->type] = abs((int) $r->ml);
        }
        ksort($byDate);

        return [
            'produced' => Units::q($produced),
            'delivered' => Units::q(-(int) $daily->where('type', 'delivery')->sum('ml')),
            'internal_use' => Units::q(-(int) $daily->where('type', 'internal_use')->sum('ml')),
            'spoilage' => Units::q(-(int) $daily->where('type', 'spoilage')->sum('ml')),
            'direct_cost_per_litre' => $produced > 0 ? Units::m(intdiv($feedCost * 1000, $produced)) : null,
            'cost_note' => 'Estimate: direct feed and vet costs booked to cows ÷ litres produced. Shared overheads excluded.',
            'daily' => array_map(fn ($d) => array_map(fn ($v) => is_int($v) ? Units::q($v) : $v, $d), array_values($byDate)),
            'by_cow' => $byCow->map(fn ($c) => ['id' => $c->id, 'tag' => $c->tag, 'name' => $c->name, 'litres' => Units::q((int) $c->ml),
                'avg_per_day' => Units::q(intdiv((int) $c->ml, max(1, (int) $c->days)))])->all(),
        ];
    }

    public function feedReport(string $from, string $to): array
    {
        $rows = DB::table('inventory_movements')->join('feed_items', 'feed_items.id', '=', 'inventory_movements.feed_item_id')
            ->where('inventory_movements.farm_id', app(\App\Support\CurrentFarm::class)->id())
            ->whereBetween('inventory_movements.date', [$from, $to])
            ->groupBy('feed_items.id', 'feed_items.name', 'feed_items.unit', 'inventory_movements.type')
            ->selectRaw('feed_items.id, feed_items.name, feed_items.unit, inventory_movements.type, SUM(qty_milli) as qty, SUM(value) as value')
            ->get();
        $items = [];
        foreach ($rows as $r) {
            $items[$r->id] ??= ['id' => $r->id, 'name' => $r->name, 'unit' => $r->unit];
            $items[$r->id][$r->type.'_qty'] = Units::q(abs((int) $r->qty));
            $items[$r->id][$r->type.'_value'] = Units::m(abs((int) $r->value));
        }
        $consumed = (int) $rows->where('type', 'consumption')->sum('value');

        return ['items' => array_values($items), 'consumption_value' => Units::m(-$consumed),
            'purchase_value' => Units::m((int) $rows->where('type', 'purchase')->sum('value'))];
    }
}
