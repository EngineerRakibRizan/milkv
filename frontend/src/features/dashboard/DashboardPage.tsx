import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bird, CalendarClock, Droplets, HardDriveDownload, Package, ShieldCheck, Truck, TrendingUp, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { get, toApiError } from '@/lib/api'
import { downloadFrom } from '@/lib/download'
import { useAuth } from '@/lib/auth'
import { date, dateTime, money, num } from '@/lib/format'
import { Badge, Card, Empty, ErrorState, PageHeader, Skeleton, Spinner, Stat } from '@/components/ui'
import { CowIcon } from '@/components/layout/icons'

const Charts = lazy(() => import('./DashboardCharts'))

export type Dashboard = {
  date: string
  counts: { cows: number; calves: number; bulls: number; active_animals: number; lactating: number; hens: number; ducks: number }
  milk: { produced_today: string; delivered_today: string; stock: string; trend: Array<{ date: string; produced: string; delivered: string }> }
  deliveries_today: Record<string, number>
  feed_value: string
  low_stock: Array<{ id: number; name: string; unit: string; stock: string; min: string }>
  upcoming_vet: Array<{ kind: string; title: string; date: string; subject: string | null }>
  tasks: Array<{ id: number; title: string; due_date: string; due_time: string | null; priority: string; status: string; employee: { name: string } | null }>
  alerts: Array<{ id: number; severity: string; title: string; body: string | null; link: string | null }>
  population: Array<{ name: string; value: number }>
  finance?: {
    income_today: string; expense_today: string; cash_in_today: string; cash_out_today: string; net_cash_today: string
    month_revenue: string; month_expenses: string; month_profit: string; receivables: string; payables: string
    monthly: Array<{ month: string; revenue: string; expenses: string; profit: string }>
    expense_mix: Array<{ key: string; name: string; amount: string }>
    recent_payments: Array<{ id: number; customer: string | null; date: string; amount: string; method: string }>
  }
}

/** Owner-only: last server backup at a glance and a one-click full download. */
function BackupCard() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const q = useQuery({ queryKey: ['backups'], queryFn: () => get<{ backups: Array<{ created_at: string }> }>('/backup/stored'), staleTime: 5 * 60_000 })
  const last = q.data?.backups[0]?.created_at
  const download = async () => {
    setBusy(true)
    try { await downloadFrom('/backup/download', { format: 'full' }) } catch (e) { toast.error(toApiError(e).message) } finally { setBusy(false) }
  }
  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <div className="rounded-lg bg-brand-50 p-2.5 text-brand-700 dark:bg-brand-900/30"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <p className="font-semibold">{t('backup.cardTitle')}</p>
          <p className="text-sm text-muted">{last ? t('backup.lastAuto', { when: dateTime(last) }) : t('backup.noAutoYet')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/settings?tab=data" className="btn-secondary">{t('backup.manage')}</Link>
        <button className="btn-primary" disabled={busy} onClick={download}>{busy ? <Spinner /> : <HardDriveDownload className="h-4 w-4" />}{t('backup.downloadFull')}</button>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { user, can } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard'), refetchInterval: 60_000 })
  const d = q.data

  if (q.error && !d) return <ErrorState error={q.error} retry={() => q.refetch()} />
  if (!d) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  const f = d.finance
  const deliveredCount = (d.deliveries_today.delivered ?? 0) + (d.deliveries_today.partial ?? 0)
  const totalDeliveries = Object.values(d.deliveries_today).reduce((a, b) => a + b, 0) - (d.deliveries_today.cancelled ?? 0)

  return (
    <div className="space-y-5">
      <PageHeader title={`${t('dashboard.greeting')}, ${user?.name.split(' ')[0]}`} subtitle={date(d.date)} />

      {/* Production & operations: the five questions an owner asks first. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('dashboard.milkToday')} value={`${num(d.milk.produced_today, 1)} L`} icon={<Droplets className="h-4 w-4" />}
          hint={`${d.counts.lactating} ${t('livestock.lactating', 'lactating')}`} />
        <Stat label={t('dashboard.deliveredToday')} value={`${num(d.milk.delivered_today, 1)} L`} icon={<Truck className="h-4 w-4" />}
          hint={`${deliveredCount}/${totalDeliveries} ${t('deliveries.done', 'done')}`} />
        <Stat label={t('dashboard.milkStock')} value={`${num(d.milk.stock, 1)} L`} tone={Number(d.milk.stock) < 0 ? 'bad' : 'default'} />
        <Stat label={t('dashboard.feedValue')} value={money(d.feed_value, { compact: true })} icon={<Package className="h-4 w-4" />}
          hint={d.low_stock.length ? <span className="text-amber-600">{d.low_stock.length} {t('inventory.lowItems', 'low on stock')}</span> : undefined} />
      </div>

      {f && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('dashboard.incomeToday')} value={money(f.income_today)} hint={`${t('reports.cashIn', 'Cash in')}: ${money(f.cash_in_today)}`} icon={<Wallet className="h-4 w-4" />} />
          <Stat label={t('dashboard.expenseToday')} value={money(f.expense_today)} hint={`${t('reports.cashOut', 'Cash out')}: ${money(f.cash_out_today)}`} />
          <Stat label={t('dashboard.monthProfit')} value={money(f.month_profit, { compact: true })} tone={Number(f.month_profit) >= 0 ? 'good' : 'bad'}
            hint={`${money(f.month_revenue, { compact: true })} − ${money(f.month_expenses, { compact: true })}`} icon={<TrendingUp className="h-4 w-4" />} />
          <Link to="/reports?tab=receivables" className="block"><Stat label={t('dashboard.receivables')} value={money(f.receivables, { compact: true })} tone="warn"
            hint={`${t('reports.payables', 'Payables')}: ${money(f.payables, { compact: true })}`} /></Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[[t('dashboard.cows'), d.counts.cows, CowIcon], [t('dashboard.calves'), d.counts.calves, CowIcon], [t('dashboard.hens'), d.counts.hens, Bird], [t('dashboard.ducks'), d.counts.ducks, Bird]]
          .map(([label, value, Icon]) => {
            const I = Icon as typeof Bird
            return (
              <div key={label as string} className="card flex items-center gap-3 px-4 py-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-700 dark:bg-brand-900/30"><I className="h-5 w-5" /></div>
                <div><p className="tabular text-lg font-semibold">{num(value as number, 0)}</p><p className="text-xs text-muted">{label as string}</p></div>
              </div>
            )
          })}
      </div>

      <Suspense fallback={<Skeleton className="h-80" />}>
        <Charts data={d} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('dashboard.alerts')} actions={<Link to="/notifications" className="text-xs text-brand-700">{t('common.view')}</Link>}>
          {d.alerts.length || d.low_stock.length ? (
            <ul className="divide-y divide-line">
              {d.alerts.map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === 'danger' ? 'text-red-600' : a.severity === 'warning' ? 'text-amber-500' : 'text-sky-600'}`} />
                  <div className="min-w-0 text-sm">
                    {a.link ? <Link to={a.link} className="font-medium hover:underline">{a.title}</Link> : <p className="font-medium">{a.title}</p>}
                    {a.body && <p className="truncate text-xs text-muted">{a.body}</p>}
                  </div>
                </li>
              ))}
              {!d.alerts.length && d.low_stock.map((s) => (
                <li key={s.id} className="flex justify-between px-4 py-3 text-sm"><span>{s.name}</span><span className="text-amber-600">{num(s.stock)} {s.unit}</span></li>
              ))}
            </ul>
          ) : <Empty title={t('dashboard.noAlerts')} />}
        </Card>

        <Card title={t('dashboard.tasksToday')} actions={<Link to="/tasks" className="text-xs text-brand-700">{t('common.view')}</Link>}>
          {d.tasks.length ? (
            <ul className="divide-y divide-line">
              {d.tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{task.title}</p>
                    <p className="text-xs text-muted">{task.employee?.name ?? '—'} · {task.due_time?.slice(0, 5) ?? date(task.due_date)}</p>
                  </div>
                  {task.due_date < d.date ? <Badge tone="red">{t('tasks.overdue', 'Overdue')}</Badge> : <Badge status={task.priority} />}
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Card>

        <Card title={t('dashboard.upcomingVet')} actions={<Link to="/vet" className="text-xs text-brand-700">{t('common.view')}</Link>}>
          {d.upcoming_vet.length ? (
            <ul className="divide-y divide-line">
              {d.upcoming_vet.map((v, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <CalendarClock className="h-4 w-4 shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{v.title}</p><p className="truncate text-xs text-muted">{v.subject}</p></div>
                  <span className="text-xs text-muted">{date(v.date)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Card>
      </div>

      {can('backup.manage') && <BackupCard />}

      {f && f.recent_payments.length > 0 && (
        <Card title={t('dashboard.recent')}>
          <ul className="divide-y divide-line">
            {f.recent_payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{p.customer ?? '—'} <span className="text-xs text-muted">· {t(`method.${p.method}`, p.method)} · {date(p.date)}</span></span>
                <span className="tabular font-medium text-brand-700">+{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
