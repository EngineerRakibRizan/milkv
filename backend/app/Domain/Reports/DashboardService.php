<?php

namespace App\Domain\Reports;

use App\Domain\Milk\MilkLedger;
use App\Models\Animal;
use App\Models\CustomerPayment;
use App\Models\Delivery;
use App\Models\FarmNotification;
use App\Models\FarmTask;
use App\Models\FeedItem;
use App\Models\Flock;
use App\Models\JournalLine;
use App\Models\MilkMovement;
use App\Models\Treatment;
use App\Models\Vaccination;
use App\Support\CurrentFarm;
use App\Support\FarmChanges;
use App\Support\Units;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * The whole dashboard in one request. The result is cached per farm and
 * keyed by the farm's data version, so any write invalidates it at once and
 * repeated opens cost a single cache read.
 */
final class DashboardService
{
    public function __construct(private ReportService $reports, private MilkLedger $milk, private CurrentFarm $current) {}

    public function build(bool $finance): array
    {
        $farm = $this->current->farm();
        $today = CarbonImmutable::now($farm->timezone)->toDateString();
        $key = sprintf('dash:%d:%s:%s:%d', $farm->id, FarmChanges::version($farm->id), $today, (int) $finance);

        // Cache plain arrays only: the cache refuses to unserialize objects
        // (config cache.serializable_classes = false), so Collections/models
        // would come back as __PHP_Incomplete_Class on the next hit.
        return Cache::remember($key, now()->addMinutes(10),
            fn () => json_decode(json_encode($this->compute($today, $finance)), true));
    }

    private function compute(string $today, bool $finance): array
    {
        $t = CarbonImmutable::parse($today);
        $monthStart = $t->startOfMonth()->toDateString();

        $animals = Animal::where('status', 'active')->selectRaw('type, COUNT(*) as n')->groupBy('type')->pluck('n', 'type');
        $birds = Flock::where('status', 'active')->selectRaw('species, SUM(current_count) as n')->groupBy('species')->pluck('n', 'species');
        $milkToday = MilkMovement::where('date', $today)->selectRaw('type, SUM(qty_ml) as ml')->groupBy('type')->pluck('ml', 'type');

        $milkTrend = MilkMovement::whereBetween('date', [$t->subDays(29)->toDateString(), $today])
            ->whereIn('type', ['production', 'delivery'])->selectRaw('date, type, SUM(qty_ml) as ml')->groupBy('date', 'type')->get();
        $trend = [];
        for ($i = 29; $i >= 0; $i--) {
            $d = $t->subDays($i)->toDateString();
            $trend[$d] = ['date' => $d, 'produced' => '0', 'delivered' => '0'];
        }
        foreach ($milkTrend as $r) {
            $trend[$r->date->toDateString()][$r->type === 'production' ? 'produced' : 'delivered'] = Units::q(abs((int) $r->ml));
        }

        $data = [
            'date' => $today,
            'counts' => [
                'cows' => (int) ($animals['cow'] ?? 0) + (int) ($animals['heifer'] ?? 0),
                'calves' => (int) ($animals['calf'] ?? 0),
                'bulls' => (int) ($animals['bull'] ?? 0),
                'active_animals' => (int) $animals->sum(),
                'lactating' => Animal::where('status', 'active')->where('lactation_status', 'lactating')->count(),
                'hens' => (int) ($birds['hen'] ?? 0),
                'ducks' => (int) ($birds['duck'] ?? 0),
            ],
            'milk' => [
                'produced_today' => Units::q((int) ($milkToday['production'] ?? 0)),
                'delivered_today' => Units::q(-(int) ($milkToday['delivery'] ?? 0)),
                'stock' => Units::q($this->milk->available()),
                'trend' => array_values($trend),
            ],
            'deliveries_today' => Delivery::where('date', $today)->selectRaw('status, COUNT(*) as n')->groupBy('status')->pluck('n', 'status'),
            'feed_value' => Units::m((int) FeedItem::sum('stock_value')),
            'low_stock' => FeedItem::whereColumn('stock_milli', '<=', 'min_stock_milli')->where('min_stock_milli', '>', 0)
                ->orderBy('name')->limit(8)->get(['id', 'name', 'unit', 'stock_milli', 'min_stock_milli'])
                ->map(fn ($f) => ['id' => $f->id, 'name' => $f->name, 'unit' => $f->unit, 'stock' => Units::q($f->stock_milli), 'min' => Units::q($f->min_stock_milli)]),
            'upcoming_vet' => $this->upcomingVet($today, $t->addDays(7)->toDateString()),
            'tasks' => FarmTask::with('employee:id,name')->whereIn('status', ['pending', 'in_progress'])->where('due_date', '<=', $today)
                ->orderBy('due_date')->orderBy('due_time')->limit(8)->get(['id', 'title', 'due_date', 'due_time', 'priority', 'status', 'employee_id']),
            'alerts' => FarmNotification::whereNull('read_at')->latest()->limit(6)->get(['id', 'type', 'severity', 'title', 'body', 'link', 'created_at']),
            'population' => [
                ['name' => 'cows', 'value' => (int) ($animals['cow'] ?? 0) + (int) ($animals['heifer'] ?? 0)],
                ['name' => 'calves', 'value' => (int) ($animals['calf'] ?? 0)],
                ['name' => 'bulls', 'value' => (int) ($animals['bull'] ?? 0)],
                ['name' => 'hens', 'value' => (int) ($birds['hen'] ?? 0)],
                ['name' => 'ducks', 'value' => (int) ($birds['duck'] ?? 0)],
            ],
        ];

        if ($finance) {
            $data['finance'] = $this->finance($t, $today, $monthStart);
        }

        return $data;
    }

    private function finance(CarbonImmutable $t, string $today, string $monthStart): array
    {
        $pnlToday = $this->reports->profitAndLoss($today, $today);
        $pnlMonth = $this->reports->profitAndLoss($monthStart, $today);
        $cashToday = $this->reports->cashFlow($today, $today);

        // Six months of revenue vs expenses in one grouped query.
        $from = $t->subMonths(5)->startOfMonth()->toDateString();
        $ym = \Illuminate\Support\Facades\DB::connection()->getDriverName() === 'pgsql'
            ? "to_char(journal_lines.date, 'YYYY-MM')" : "strftime('%Y-%m', journal_lines.date)";
        $monthly = JournalLine::query()->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->whereBetween('journal_lines.date', [$from, $today])->whereIn('accounts.type', ['revenue', 'expense'])
            ->selectRaw("{$ym} as ym, accounts.type, SUM(debit) - SUM(credit) as net")->groupBy('ym', 'accounts.type')->get();
        $months = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = $t->subMonths($i)->format('Y-m');
            $rev = -(int) $monthly->where('ym', $m)->where('type', 'revenue')->sum('net');
            $exp = (int) $monthly->where('ym', $m)->where('type', 'expense')->sum('net');
            $months[] = ['month' => $m, 'revenue' => Units::m($rev), 'expenses' => Units::m($exp), 'profit' => Units::m($rev - $exp)];
        }

        $receivables = $this->reports->receivables();

        return [
            'income_today' => $pnlToday['total_revenue'],
            'expense_today' => Units::m(Units::money($pnlToday['direct_costs']) + Units::money($pnlToday['operating_expenses'])),
            'cash_in_today' => $cashToday['inflow'],
            'cash_out_today' => $cashToday['outflow'],
            'net_cash_today' => $cashToday['net'],
            'month_revenue' => $pnlMonth['total_revenue'],
            'month_expenses' => Units::m(Units::money($pnlMonth['direct_costs']) + Units::money($pnlMonth['operating_expenses'])),
            'month_profit' => $pnlMonth['net_profit'],
            'receivables' => $receivables['total'],
            'payables' => $this->reports->payables()['total'],
            'monthly' => $months,
            'expense_mix' => array_values(array_filter($pnlMonth['expenses'], fn ($e) => (float) $e['amount'] > 0)),
            'recent_payments' => CustomerPayment::with('customer:id,name')->latest('id')->limit(5)
                ->get(['id', 'customer_id', 'date', 'amount', 'method'])
                ->map(fn ($p) => ['id' => $p->id, 'customer' => $p->customer?->name, 'date' => $p->date->toDateString(), 'amount' => Units::m($p->amount), 'method' => $p->method]),
        ];
    }

    private function upcomingVet(string $from, string $to): array
    {
        $vacc = Vaccination::with(['animal:id,tag,name', 'flock:id,name'])->whereBetween('next_due_date', [$from, $to])
            ->orderBy('next_due_date')->limit(6)->get()
            ->map(fn ($v) => ['kind' => 'vaccination', 'title' => $v->vaccine, 'date' => $v->next_due_date->toDateString(),
                'subject' => $v->animal ? ($v->animal->name ?? $v->animal->tag) : $v->flock?->name]);
        $follow = Treatment::with(['animal:id,tag,name', 'flock:id,name'])->whereBetween('follow_up_date', [$from, $to])
            ->where('outcome', 'ongoing')->orderBy('follow_up_date')->limit(6)->get()
            ->map(fn ($v) => ['kind' => 'follow_up', 'title' => $v->diagnosis ?: 'Follow-up', 'date' => $v->follow_up_date->toDateString(),
                'subject' => $v->animal ? ($v->animal->name ?? $v->animal->tag) : $v->flock?->name]);

        return $vacc->concat($follow)->sortBy('date')->values()->all();
    }
}
