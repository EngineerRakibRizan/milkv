import { lazy, Suspense, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Egg, Pencil, Wheat } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { date, money, num } from '@/lib/format'
import { downloadCsv } from '@/lib/utils'
import type { Flock } from '@/lib/lookups'
import { Badge, Card, DataTable, ErrorState, Skeleton, Stat } from '@/components/ui'
import { FeedIssueModal } from '@/features/shared/forms'
import { DailyRecordModal, FlockForm } from './PoultryPage'

const MiniLine = lazy(() => import('@/features/shared/MiniLine'))

type FlockRecord = { id: number; date: string; opening_count: number; added: number; deaths: number; sold: number; culled: number; closing_count: number; eggs: number; eggs_broken: number; sick: number; notes: string | null }
type Detail = { flock: Flock; records: FlockRecord[]; totals: { eggs: number; deaths: number; sold: number; mortality_pct: number }
  feed: Array<{ id: number; date: string; item: string; unit: string; quantity: string; value: string }> }

export default function FlockPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const [modal, setModal] = useState<'edit' | 'record' | 'feed' | null>(null)
  const q = useQuery({ queryKey: ['flocks', 'detail', id], queryFn: () => get<Detail>(`/flocks/${id}`) })
  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) return <Skeleton className="h-72" />
  const { flock: f, totals, records } = q.data
  const layRate = f.current_count && records[0] ? Math.round((records[0].eggs / records[0].opening_count) * 100) : 0
  const feedCost = q.data.feed.reduce((s, x) => s - Number(x.value), 0)

  return (
    <div className="space-y-5">
      <Link to="/poultry" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />{t('nav.poultry')}</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{f.name} <Badge status={f.status} /></h1>
          <p className="text-sm text-muted">{f.code} · {t(`poultry.${f.species}`, f.species)} · {f.breed ?? '—'} · {f.age_weeks} {t('poultry.weeks', 'weeks')} · {f.location ?? ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('flocks.update') && <button className="btn-secondary" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" />{t('common.edit')}</button>}
          {can('inventory.consume') && <button className="btn-secondary" onClick={() => setModal('feed')}><Wheat className="h-4 w-4" />{t('quick.feed', 'Feed used')}</button>}
          {can('flocks.record') && f.status === 'active' && <button className="btn-primary" onClick={() => setModal('record')}><Egg className="h-4 w-4" />{t('poultry.daily', 'Daily record')}</button>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('poultry.birds', 'Birds')} value={num(f.current_count, 0)} hint={`${t('poultry.initial', 'Started with')} ${num(f.initial_count, 0)}`} />
        <Stat label={t('poultry.layRate', 'Laying rate (last day)')} value={`${layRate}%`} />
        <Stat label={t('poultry.mortality', 'Mortality')} value={`${totals.mortality_pct}%`} hint={`${totals.deaths} ${t('poultry.deaths', 'deaths')}`} tone={totals.mortality_pct > 5 ? 'bad' : 'default'} />
        <Stat label={t('livestock.feedCost', 'Recent feed cost')} value={money(feedCost)} />
      </div>
      <Card title={t('poultry.eggTrend', 'Egg production')}>
        <Suspense fallback={<Skeleton className="m-4 h-56" />}>
          <MiniLine data={[...records].reverse().map((r) => ({ x: r.date.slice(5), y: r.eggs }))} />
        </Suspense>
      </Card>
      <Card title={t('poultry.records', 'Daily records')} actions={<button className="btn-ghost text-xs" onClick={() => downloadCsv(`flock-${f.code}.csv`, records)}>{t('common.export')}</button>}>
        <DataTable rows={records} rowKey={(r) => r.id} columns={[
          { key: 'd', header: t('common.date'), mobile: 'title', render: (r) => date(r.date) },
          { key: 'o', header: t('poultry.opening', 'Opening'), className: 'text-right tabular', render: (r) => r.opening_count },
          { key: 'x', header: t('poultry.changes', '+ / −'), mobile: 'subtitle', render: (r) => <span className="text-xs">{r.added ? `+${r.added} ` : ''}{r.deaths ? <span className="text-red-600">†{r.deaths} </span> : ''}{r.sold ? `${t('poultry.soldShort', 'sold')} ${r.sold} ` : ''}{r.culled ? `−${r.culled}` : ''}</span> },
          { key: 'c', header: t('poultry.closing', 'Closing'), className: 'text-right tabular', render: (r) => r.closing_count },
          { key: 'e', header: t('poultry.eggsCollected', 'Eggs'), mobile: 'meta', className: 'text-right tabular font-medium', render: (r) => `${r.eggs}${r.eggs_broken ? ` (−${r.eggs_broken})` : ''}` },
        ]} />
      </Card>
      {modal === 'edit' && <FlockForm flock={f} onClose={() => setModal(null)} />}
      {modal === 'record' && <DailyRecordModal flock={f} onClose={() => setModal(null)} />}
      {modal === 'feed' && <FeedIssueModal open preset={{ target_type: 'flock', target_id: f.id }} onClose={() => setModal(null)} />}
    </div>
  )
}
