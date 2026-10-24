<?php

namespace App\Domain\Notifications;

use App\Models\Bill;
use App\Models\Delivery;
use App\Models\Farm;
use App\Models\FarmNotification;
use App\Models\FarmTask;
use App\Models\FeedItem;
use App\Models\Invoice;
use App\Models\MilkMovement;
use App\Models\Treatment;
use App\Models\Vaccination;
use App\Support\CurrentFarm;
use App\Support\FarmChanges;
use Carbon\CarbonImmutable;

/**
 * Scheduled checks that turn real data into notifications. Each alert has a
 * dedupe key, so running the check every hour never repeats a notification.
 * Email/SMS delivery is an optional integration and is not faked here.
 */
final class AlertService
{
    public function runForAll(): int
    {
        $n = 0;
        foreach (Farm::all() as $farm) {
            $n += $this->run($farm);
        }

        return $n;
    }

    public function run(Farm $farm): int
    {
        $current = app(CurrentFarm::class);
        $current->set($farm, 'owner');
        $today = CarbonImmutable::now($farm->timezone);
        $d = $today->toDateString();
        $created = 0;
        $add = function (string $type, string $severity, string $title, ?string $body, ?string $link, string $dedupe) use (&$created) {
            $n = FarmNotification::firstOrCreate(['dedupe_key' => $dedupe],
                ['type' => $type, 'severity' => $severity, 'title' => $title, 'body' => $body, 'link' => $link]);
            $created += $n->wasRecentlyCreated ? 1 : 0;
        };

        foreach (FeedItem::where('min_stock_milli', '>', 0)->whereColumn('stock_milli', '<=', 'min_stock_milli')->get() as $f) {
            $add('low_stock', 'warning', "Low stock: {$f->name}", "Only {$this->q($f->stock_milli)} {$f->unit} left.", '/inventory', "low_stock:{$f->id}:{$d}");
        }
        foreach (FeedItem::whereNotNull('expires_at')->whereBetween('expires_at', [$d, $today->addDays(14)->toDateString()])->where('stock_milli', '>', 0)->get() as $f) {
            $add('expiring', 'warning', "Expiring soon: {$f->name}", 'Expires on '.$f->expires_at->toDateString(), '/inventory', "expiring:{$f->id}:{$f->expires_at->toDateString()}");
        }
        foreach (Vaccination::with('animal:id,tag,name', 'flock:id,name')->whereBetween('next_due_date', [$d, $today->addDays(3)->toDateString()])->get() as $v) {
            $who = $v->animal ? ($v->animal->name ?? $v->animal->tag) : $v->flock?->name;
            $add('vaccination_due', 'info', "Vaccination due: {$v->vaccine}", "{$who} — due {$v->next_due_date->toDateString()}", '/vet', "vacc:{$v->id}:{$v->next_due_date->toDateString()}");
        }
        foreach (Treatment::with('animal:id,tag,name', 'flock:id,name')->where('outcome', 'ongoing')->whereBetween('follow_up_date', [$d, $today->addDays(2)->toDateString()])->get() as $t) {
            $who = $t->animal ? ($t->animal->name ?? $t->animal->tag) : $t->flock?->name;
            $add('follow_up', 'info', "Vet follow-up: {$who}", 'Follow-up on '.$t->follow_up_date->toDateString(), '/vet', "follow:{$t->id}:{$t->follow_up_date->toDateString()}");
        }
        $overdue = Invoice::with('customer:id,name')->whereIn('status', ['unpaid', 'partial'])->whereNotNull('customer_id')
            ->where(fn ($q) => $q->where('due_date', '<', $d)->orWhere(fn ($q) => $q->whereNull('due_date')->where('date', '<', $today->subDays(30)->toDateString())))
            ->selectRaw('customer_id, SUM(total - paid) as due')->groupBy('customer_id')->get();
        foreach ($overdue as $o) {
            $add('overdue_payment', 'danger', "Overdue: {$o->customer?->name}", $farm->currency.' '.number_format($o->due / 100, 2).' is overdue.', "/customers/{$o->customer_id}", "overdue:{$o->customer_id}:{$today->format('o-W')}");
        }
        $unpaidBills = Bill::whereIn('status', ['unpaid', 'partial'])->whereNotNull('due_date')->where('due_date', '<', $d)->count();
        if ($unpaidBills) {
            $add('unpaid_bills', 'warning', "{$unpaidBills} supplier bill(s) past due", null, '/expenses', "bills:{$d}");
        }
        $pending = Delivery::where('date', $d)->whereIn('status', ['pending', 'prepared', 'out_for_delivery'])->count();
        if ($pending && $today->hour >= 12) {
            $add('pending_deliveries', 'info', "{$pending} deliveries still pending today", null, '/deliveries', "deliveries:{$d}");
        }
        $late = FarmTask::whereIn('status', ['pending', 'in_progress'])->where('due_date', '<', $d)->count();
        if ($late) {
            $add('overdue_tasks', 'warning', "{$late} overdue task(s)", null, '/tasks', "tasks:{$d}");
        }
        // Production drop: yesterday vs the 7 days before, at least 15% lower.
        $y = $today->subDay()->toDateString();
        $yesterday = (int) MilkMovement::where('type', 'production')->where('date', $y)->sum('qty_ml');
        $week = (int) MilkMovement::where('type', 'production')->whereBetween('date', [$today->subDays(8)->toDateString(), $today->subDays(2)->toDateString()])->sum('qty_ml');
        if ($week > 0 && $yesterday < ($week / 7) * 0.85) {
            $pct = round(100 - $yesterday * 700 / $week);
            $add('milk_drop', 'warning', "Milk production down {$pct}%", "Yesterday {$this->q($yesterday)} L vs 7-day average {$this->q(intdiv($week, 7))} L.", '/milk', "milkdrop:{$y}");
        }

        if ($created) {
            FarmChanges::touch('notifications');
        }
        $current->clear();

        return $created;
    }

    private function q(int $milli): string
    {
        return rtrim(rtrim(number_format($milli / 1000, 2, '.', ''), '0'), '.');
    }
}
