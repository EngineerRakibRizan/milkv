<?php

namespace App\Http\Controllers\Api;

use App\Domain\Reports\DashboardService;
use App\Domain\Reports\ReportService;
use App\Http\Controllers\Controller;
use App\Models\JournalLine;
use App\Support\Units;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function __construct(private ReportService $reports) {}

    public function dashboard(DashboardService $dashboard)
    {
        $this->allow('dashboard.view');

        return $dashboard->build($this->current()->can('dashboard.finance') || $this->current()->can('reports.finance'));
    }

    public function show(Request $r, string $type)
    {
        $finance = ['pnl', 'cashflow', 'receivables', 'payables', 'segments', 'profitability', 'ledger'];
        $this->allow(in_array($type, $finance, true) ? 'reports.finance' : 'reports.operational');
        $d = $r->validate(['from' => 'nullable|date', 'to' => 'nullable|date|after_or_equal:from', 'dimension' => 'nullable|in:animal,flock']);
        $from = $d['from'] ?? now()->startOfMonth()->toDateString();
        $to = $d['to'] ?? now()->toDateString();

        return match ($type) {
            'pnl' => $this->reports->profitAndLoss($from, $to),
            'cashflow' => $this->reports->cashFlow($from, $to),
            'receivables' => $this->reports->receivables(),
            'payables' => $this->reports->payables(),
            'segments' => $this->reports->segments($from, $to),
            'profitability' => $this->reports->unitProfitability($d['dimension'] ?? 'animal', $from, $to),
            'milk' => $this->reports->milkSummary($from, $to),
            'feed' => $this->reports->feedReport($from, $to),
            'ledger' => $this->ledger($r, $from, $to),
            default => abort(404),
        };
    }

    /** Journal lines for one account: drill-down from any report figure to its source documents. */
    private function ledger(Request $r, string $from, string $to): array
    {
        $key = $r->validate(['account' => 'required|string|max:40'])['account'];
        $lines = JournalLine::with('entry:id,memo,source_type,source_id')->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('accounts.key', $key)->whereBetween('journal_lines.date', [$from, $to])
            ->orderBy('journal_lines.date')->orderBy('journal_lines.id')->select('journal_lines.*')->limit(1000)->get();

        return ['account' => $key, 'lines' => $lines->map(fn ($l) => [
            'date' => $l->date->toDateString(), 'memo' => $l->entry->memo, 'source_type' => $l->entry->source_type, 'source_id' => $l->entry->source_id,
            'debit' => Units::m($l->debit), 'credit' => Units::m($l->credit),
        ])];
    }
}
