import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, Printer } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { date, money, num } from '@/lib/format'
import { downloadCsv, monthStart, today } from '@/lib/utils'
import { Card, Empty, ErrorState, Input, PageHeader, Select, Skeleton, Tabs } from '@/components/ui'

type Tab = 'pnl' | 'cashflow' | 'segments' | 'profitability' | 'receivables' | 'payables' | 'milk' | 'feed'
type Line = { key?: string; name: string; amount: string; section?: string }

export default function ReportsPage() {
  const { t } = useTranslation()
  const { can, farm } = useAuth()
  const [params, setParams] = useSearchParams()
  const finance = can('reports.finance')
  const tab = (params.get('tab') as Tab) ?? (finance ? 'pnl' : 'milk')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [dimension, setDimension] = useState<'animal' | 'flock'>('animal')
  const q = useQuery({ queryKey: ['reports', tab, from, to, dimension], queryFn: () => get<Record<string, unknown>>(`/reports/${tab}`, { from, to, dimension }) })
  const data = q.data as never

  const tabs: Array<{ value: Tab; label: string; fin: boolean }> = [
    { value: 'pnl', label: t('reports.pnl', 'Profit & loss'), fin: true }, { value: 'cashflow', label: t('reports.cashflow', 'Cash flow'), fin: true },
    { value: 'segments', label: t('reports.segments', 'By business'), fin: true }, { value: 'profitability', label: t('reports.unit', 'Per cow / flock'), fin: true },
    { value: 'receivables', label: t('reports.receivables', 'Customer dues'), fin: true }, { value: 'payables', label: t('reports.payables', 'Supplier dues'), fin: true },
    { value: 'milk', label: t('reports.milk', 'Milk'), fin: false }, { value: 'feed', label: t('reports.feed', 'Feed'), fin: false },
  ]
  const periodless = tab === 'receivables' || tab === 'payables'

  return (
    <>
      <PageHeader title={t('nav.reports')} actions={<button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />{t('common.print')}</button>} />
      <div className="print:hidden">
        <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={tabs.filter((x) => !x.fin || finance)} />
        {!periodless && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Input label={t('common.from')} type="date" wrapClass="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label={t('common.to')} type="date" wrapClass="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            {[['month', monthStart(), today()], ['year', today().slice(0, 4) + '-01-01', today()]].map(([k, f, tt]) => (
              <button key={k} className="btn-ghost" onClick={() => { setFrom(f); setTo(tt) }}>{t(`reports.this.${k}`, k === 'month' ? 'This month' : 'This year')}</button>
            ))}
            {tab === 'profitability' && <Select wrapClass="w-40" value={dimension} onChange={(e) => setDimension(e.target.value as 'animal')}
              options={[{ value: 'animal', label: t('nav.livestock') }, { value: 'flock', label: t('nav.poultry') }]} />}
          </div>
        )}
      </div>
      {/* Print header: farm, period, generation date */}
      <div className="mb-4 hidden print:block">
        <h2 className="text-lg font-semibold">{farm?.name} — {tabs.find((x) => x.value === tab)?.label}</h2>
        <p className="text-sm">{periodless ? `${t('reports.asOf', 'As of')} ${date(today())}` : `${date(from)} – ${date(to)}`} · {t('reports.generated', 'Generated')} {new Date().toLocaleString()}</p>
      </div>
      {q.error ? <ErrorState error={q.error} /> : !data ? <Skeleton className="h-80" /> : (
        <>
          {tab === 'pnl' && <PnL d={data} />}
          {tab === 'cashflow' && <CashFlow d={data} />}
          {tab === 'segments' && <Segments rows={data} />}
          {tab === 'profitability' && <UnitProfit rows={data} dimension={dimension} />}
          {tab === 'receivables' && <Receivables d={data} />}
          {tab === 'payables' && <Payables d={data} />}
          {tab === 'milk' && <MilkReport d={data} />}
          {tab === 'feed' && <FeedReport d={data} />}
        </>
      )}
    </>
  )
}

function Row({ label, value, strong, indent, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={`flex justify-between px-4 py-2 text-sm ${strong ? 'border-t border-line font-semibold' : ''} ${indent ? 'pl-8 text-muted' : ''}`}>
      <span>{label}</span><span className={`tabular ${tone === 'good' ? 'text-brand-700' : tone === 'bad' ? 'text-red-600' : ''}`}>{value}</span>
    </div>
  )
}

function Csv({ name, rows }: { name: string; rows: object[] }) {
  const { t } = useTranslation()
  return <button className="btn-ghost p-1.5 text-xs print:hidden" onClick={() => downloadCsv(name, rows as Record<string, unknown>[])} title={t('common.export')}><Download className="h-4 w-4" /></button>
}

function PnL({ d }: { d: { revenue: Line[]; expenses: Line[]; total_revenue: string; direct_costs: string; gross_profit: string; operating_expenses: string; net_profit: string } }) {
  const { t } = useTranslation()
  const direct = d.expenses.filter((e) => e.section === 'direct')
  const operating = d.expenses.filter((e) => e.section !== 'direct')
  return (
    <Card title={t('reports.pnl', 'Profit & loss')} actions={<Csv name="profit-and-loss.csv" rows={[...d.revenue.map((r) => ({ type: 'revenue', ...r })), ...d.expenses.map((r) => ({ type: 'expense', ...r }))]} />} className="max-w-3xl">
      <Row label={<b>{t('reports.revenue', 'Revenue')}</b>} value="" />
      {d.revenue.map((r) => <Row key={r.key} indent label={r.name} value={money(r.amount)} />)}
      <Row strong label={t('reports.totalRevenue', 'Total revenue')} value={money(d.total_revenue)} />
      <Row label={<b>{t('reports.direct', 'Direct costs (feed, vet)')}</b>} value="" />
      {direct.map((r) => <Row key={r.key} indent label={r.name} value={money(r.amount)} />)}
      <Row strong label={t('reports.gross', 'Gross profit')} value={money(d.gross_profit)} />
      <Row label={<b>{t('reports.operating', 'Operating expenses')}</b>} value="" />
      {operating.map((r) => <Row key={r.key} indent label={r.name} value={money(r.amount)} />)}
      <Row strong label={t('reports.totalOperating', 'Total operating expenses')} value={money(d.operating_expenses)} />
      <div className="border-t-2 border-line"><Row strong label={t('reports.net', 'Net profit')} value={money(d.net_profit)} tone={Number(d.net_profit) >= 0 ? 'good' : 'bad'} /></div>
      <p className="border-t border-line px-4 py-3 text-xs text-muted">{t('reports.pnlNote', 'Accrual basis: sales count when delivered/invoiced, feed counts when consumed. Animal and equipment purchases are assets, not expenses.')}</p>
    </Card>
  )
}

function CashFlow({ d }: { d: { opening: string; inflow: string; outflow: string; net: string; closing: string; by_activity: Array<{ activity: string; inflow: string; outflow: string }>; by_account: Array<{ account: string; inflow: string; outflow: string }> } }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('reports.cashflow', 'Cash flow')} actions={<Csv name="cash-flow.csv" rows={d.by_activity} />}>
        <Row label={t('reports.opening', 'Opening cash & bank')} value={money(d.opening)} />
        {d.by_activity.map((a) => <Row key={a.activity} indent label={a.activity} value={<>{Number(a.inflow) > 0 && <span className="text-brand-700">+{money(a.inflow)} </span>}{Number(a.outflow) > 0 && <span className="text-red-600">−{money(a.outflow)}</span>}</>} />)}
        <Row strong label={t('reports.netCash', 'Net cash movement')} value={money(d.net)} tone={Number(d.net) >= 0 ? 'good' : 'bad'} />
        <Row strong label={t('reports.closing', 'Closing cash & bank')} value={money(d.closing)} />
      </Card>
      <Card title={t('reports.byAccount', 'By account')}>
        {d.by_account.map((a) => <Row key={a.account} label={a.account} value={<><span className="text-brand-700">+{money(a.inflow)}</span> / <span className="text-red-600">−{money(a.outflow)}</span></>} />)}
        <p className="px-4 py-3 text-xs text-muted">{t('reports.cashNote', 'Cash flow shows money actually received and paid, which differs from profit when customers or suppliers have open balances.')}</p>
      </Card>
    </div>
  )
}

function Segments({ rows }: { rows: Array<{ segment: string; revenue: string; costs: string; profit: string }> }) {
  const { t } = useTranslation()
  return (
    <Card title={t('reports.segments', 'Profit by business area')} actions={<Csv name="segments.csv" rows={rows} />} className="max-w-3xl">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas/60"><tr><th className="th">{t('reports.area', 'Area')}</th><th className="th text-right">{t('reports.revenue', 'Revenue')}</th><th className="th text-right">{t('common.cost')}</th><th className="th text-right">{t('reports.profit', 'Profit')}</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r) => (
          <tr key={r.segment}><td className="td font-medium">{t(`reports.seg.${r.segment}`, { dairy: 'Dairy (milk & cattle)', poultry: 'Poultry (eggs & birds)', unallocated: 'Shared overheads' }[r.segment] ?? r.segment)}</td>
            <td className="td text-right tabular">{money(r.revenue)}</td><td className="td text-right tabular">{money(r.costs)}</td>
            <td className={`td text-right tabular font-semibold ${Number(r.profit) >= 0 ? 'text-brand-700' : 'text-red-600'}`}>{money(r.profit)}</td></tr>))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-xs text-muted">{t('reports.segNote', 'Direct costs follow the animal or flock they were recorded against. Costs not tied to one (salaries, electricity…) stay in shared overheads rather than being guessed.')}</p>
    </Card>
  )
}

function UnitProfit({ rows, dimension }: { rows: Array<{ id: number; label: string; revenue: string; estimated_milk_revenue: string; costs: string; profit: string }>; dimension: string }) {
  const { t } = useTranslation()
  if (!rows.length) return <Card><Empty /></Card>
  return (
    <Card title={dimension === 'flock' ? t('reports.perFlock', 'Profit per flock') : t('reports.perCow', 'Profit per animal')} actions={<Csv name={`profit-per-${dimension}.csv`} rows={rows} />}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas/60"><tr><th className="th">{t('common.name')}</th><th className="th text-right">{t('reports.revenue', 'Revenue')}</th>
          {dimension === 'animal' && <th className="th text-right">{t('reports.milkEst', 'of which milk (est.)')}</th>}<th className="th text-right">{t('reports.directCost', 'Direct costs')}</th><th className="th text-right">{t('reports.profit', 'Profit')}</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r) => (
          <tr key={r.id}><td className="td font-medium">{r.label}</td><td className="td text-right tabular">{money(r.revenue)}</td>
            {dimension === 'animal' && <td className="td text-right tabular text-muted">{money(r.estimated_milk_revenue)}</td>}
            <td className="td text-right tabular">{money(r.costs)}</td><td className={`td text-right tabular font-semibold ${Number(r.profit) >= 0 ? 'text-brand-700' : 'text-red-600'}`}>{money(r.profit)}</td></tr>))}
        </tbody>
      </table></div>
      {dimension === 'animal' && <p className="border-t border-line px-4 py-3 text-xs text-muted">{t('reports.estNote', 'Milk revenue is allocated to each cow by litres produced — an estimate, since customers buy pooled milk.')}</p>}
    </Card>
  )
}

function Receivables({ d }: { d: { total: string; advances: string; customers: Array<{ id: number; code: string; name: string; phone: string | null; area: string | null; balance: string; aging: Record<string, string> }> } }) {
  const { t } = useTranslation()
  const b = (r: Record<string, string>, k: string) => (r[k] ? money(r[k]) : '—')
  return (
    <Card title={`${t('reports.receivables', 'Customer dues')} · ${money(d.total)}`} actions={<Csv name="receivables.csv" rows={d.customers.map(({ aging, ...c }) => ({ ...c, ...aging }))} />}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas/60"><tr><th className="th">{t('nav.customers')}</th><th className="th">{t('common.phone')}</th>
          <th className="th text-right">0–30</th><th className="th text-right">31–60</th><th className="th text-right">61–90</th><th className="th text-right">90+</th><th className="th text-right">{t('common.balance')}</th></tr></thead>
        <tbody className="divide-y divide-line">{d.customers.map((c) => (
          <tr key={c.id}><td className="td font-medium">{c.name}<span className="text-xs text-muted"> · {c.area}</span></td><td className="td">{c.phone}</td>
            <td className="td text-right tabular">{b(c.aging, 'current')}</td><td className="td text-right tabular">{b(c.aging, 'd31_60')}</td><td className="td text-right tabular text-amber-600">{b(c.aging, 'd61_90')}</td>
            <td className="td text-right tabular text-red-600">{b(c.aging, 'd90_plus')}</td><td className={`td text-right tabular font-semibold ${Number(c.balance) < 0 ? 'text-brand-700' : ''}`}>{money(c.balance)}</td></tr>))}
        </tbody>
      </table></div>
      {Number(d.advances) > 0 && <p className="border-t border-line px-4 py-3 text-xs text-muted">{t('reports.advances', 'Customer advances held')}: {money(d.advances)}</p>}
    </Card>
  )
}

function Payables({ d }: { d: { total: string; unassigned: string; suppliers: Array<{ id: number; name: string; phone: string | null; balance: string }> } }) {
  const { t } = useTranslation()
  return (
    <Card title={`${t('reports.payables', 'Supplier dues')} · ${money(d.total)}`} actions={<Csv name="payables.csv" rows={d.suppliers} />} className="max-w-3xl">
      {d.suppliers.map((s) => <Row key={s.id} label={<>{s.name} <span className="text-xs text-muted">{s.phone}</span></>} value={money(s.balance)} />)}
      {Number(d.unassigned) > 0 && <Row label={t('reports.noSupplier', 'Bills without supplier')} value={money(d.unassigned)} />}
      {!d.suppliers.length && <Empty />}
    </Card>
  )
}

function MilkReport({ d }: { d: { produced: string; delivered: string; internal_use: string; spoilage: string; direct_cost_per_litre: string | null; cost_note: string
  daily: Array<Record<string, string>>; by_cow: Array<{ id: number; tag: string; name: string | null; litres: string; avg_per_day: string }> } }) {
  const { t } = useTranslation()
  const closing = Number(d.produced) - Number(d.delivered) - Number(d.internal_use) - Number(d.spoilage)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('reports.milkBalance', 'Milk reconciliation')} actions={<Csv name="milk-daily.csv" rows={d.daily} />}>
        <Row label={t('milk.produced', 'Produced')} value={`${num(d.produced, 1)} L`} />
        <Row indent label={t('milk.delivered', 'Delivered (sold)')} value={`− ${num(d.delivered, 1)} L`} />
        <Row indent label={t('milk.internal', 'Household / calves')} value={`− ${num(d.internal_use, 1)} L`} />
        <Row indent label={t('milk.spoilage', 'Spoiled / rejected')} value={`− ${num(d.spoilage, 1)} L`} />
        <Row strong label={t('reports.unsold', 'Remaining from period')} value={`${num(closing, 1)} L`} />
        {d.direct_cost_per_litre && <Row label={t('reports.costPerLitre', 'Direct cost per litre (est.)')} value={money(d.direct_cost_per_litre)} />}
        <p className="px-4 pb-3 text-xs text-muted">{d.cost_note}</p>
      </Card>
      <Card title={t('reports.topCows', 'Production by cow')} actions={<Csv name="milk-by-cow.csv" rows={d.by_cow} />}>
        {d.by_cow.map((c, i) => <Row key={c.id} label={<>{i + 1}. {c.name ?? c.tag} <span className="text-xs text-muted">{c.tag}</span></>} value={<>{num(c.litres, 0)} L <span className="text-xs text-muted">({num(c.avg_per_day, 1)}/day)</span></>} />)}
        {!d.by_cow.length && <Empty />}
      </Card>
    </div>
  )
}

function FeedReport({ d }: { d: { consumption_value: string; purchase_value: string; items: Array<Record<string, string>> } }) {
  const { t } = useTranslation()
  return (
    <Card title={`${t('reports.feed', 'Feed')} · ${t('reports.consumed', 'consumed')} ${money(d.consumption_value)} · ${t('reports.bought', 'bought')} ${money(d.purchase_value)}`} actions={<Csv name="feed.csv" rows={d.items} />}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas/60"><tr><th className="th">{t('inventory.item', 'Item')}</th><th className="th text-right">{t('inventory.purchase', 'Purchased')}</th>
          <th className="th text-right">{t('inventory.consumption', 'Consumed')}</th><th className="th text-right">{t('reports.consumedValue', 'Consumed value')}</th><th className="th text-right">{t('inventory.wastage', 'Wasted')}</th></tr></thead>
        <tbody className="divide-y divide-line">{d.items.map((i) => (
          <tr key={i.id}><td className="td font-medium">{i.name}</td><td className="td text-right tabular">{i.purchase_qty ? `${num(i.purchase_qty)} ${i.unit}` : '—'}</td>
            <td className="td text-right tabular">{i.consumption_qty ? `${num(i.consumption_qty)} ${i.unit}` : '—'}</td><td className="td text-right tabular">{i.consumption_value ? money(i.consumption_value) : '—'}</td>
            <td className="td text-right tabular">{i.wastage_qty ? `${num(i.wastage_qty)} ${i.unit}` : '—'}</td></tr>))}
        </tbody>
      </table></div>
    </Card>
  )
}
