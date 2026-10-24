import { lazy, Suspense, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Archive, Pencil, Scale, CalendarPlus, Tag } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money, num } from '@/lib/format'
import { today } from '@/lib/utils'
import { useCustomers, type Animal } from '@/lib/lookups'
import { Badge, Card, Confirm, DataTable, Empty, ErrorState, Input, Modal, Select, Skeleton, Spinner, Stat, Tabs, Textarea } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'
import { AnimalForm } from './AnimalForm'
import type { Treatment, Vaccination } from '@/features/vet/VetPage'

const MiniLine = lazy(() => import('@/features/shared/MiniLine'))

type Profile = {
  animal: Animal
  mother: { id: number; tag: string; name: string | null } | null
  calves: Array<{ id: number; tag: string; name: string | null; birth_date: string | null; gender: string; status: string }>
  weights: Array<{ id: number; date: string; weight: string; notes: string | null }>
  events: Array<{ id: number; type: string; date: string; details: Record<string, string> | null; notes: string | null; related: { id: number; tag: string; name: string | null } | null }>
  treatments: Treatment[]
  vaccinations: Vaccination[]
  milk: Array<{ date: string; litres: string }>
  milk_total_60d: string
  feed: Array<{ id: number; date: string; item: string; unit: string; quantity: string; value: string }>
  expenses: Array<{ id: number; number: string; date: string; description: string | null; category: string; total: string; status: string }>
}

export default function AnimalProfilePage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const [tab, setTab] = useState<'overview' | 'health' | 'milk' | 'timeline' | 'costs'>('overview')
  const [dialog, setDialog] = useState<'edit' | 'weight' | 'event' | 'status' | 'archive' | null>(null)
  const q = useQuery({ queryKey: ['animals', 'profile', id], queryFn: () => get<Profile>(`/animals/${id}`) })
  const archive = useApiMutation({ method: 'delete', url: `/animals/${id}`, invalidate: [['animals']], success: t('livestock.archived', 'Archived'), onSuccess: () => setDialog(null) })

  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
  const { animal: a } = q.data
  const active = a.status === 'active' && !a.archived
  const feedCost = q.data.feed.reduce((s, f) => s - Number(f.value), 0)
  const vetCost = q.data.expenses.filter((e) => e.status !== 'void').reduce((s, e) => s + Number(e.total), 0)

  return (
    <div className="space-y-5">
      <Link to="/livestock" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />{t('nav.livestock')}</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-xl font-bold text-brand-800 dark:bg-brand-900/30">{a.tag.slice(-3)}</div>
          <div>
            <h1 className="text-2xl font-semibold">{a.name ?? a.tag} {a.name && <span className="text-base font-normal text-muted">#{a.tag}</span>}</h1>
            <p className="text-sm text-muted">{t(`animal.${a.type}`, a.type)} · {a.breed ?? '—'} · {t(`animal.${a.gender}`, a.gender)}{a.age_months != null && ` · ${Math.floor(a.age_months / 12)}y ${a.age_months % 12}m`}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge status={a.status} />{a.lactation_status && <Badge status={a.lactation_status} />}{a.reproductive_status && <Badge status={a.reproductive_status} />}<Badge status={a.health_status} />
              {a.archived && <Badge tone="gray">{t('common.archived', 'Archived')}</Badge>}
            </div>
          </div>
        </div>
        {can('animals.update') && active && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setDialog('edit')}><Pencil className="h-4 w-4" />{t('common.edit')}</button>
            <button className="btn-secondary" onClick={() => setDialog('weight')}><Scale className="h-4 w-4" />{t('livestock.weigh', 'Weight')}</button>
            <button className="btn-secondary" onClick={() => setDialog('event')}><CalendarPlus className="h-4 w-4" />{t('livestock.event', 'Breeding / event')}</button>
            <button className="btn-secondary" onClick={() => setDialog('status')}><Tag className="h-4 w-4" />{t('livestock.sellEtc', 'Sell / death')}</button>
            {can('animals.archive') && <button className="btn-ghost" onClick={() => setDialog('archive')} title={t('common.archive')}><Archive className="h-4 w-4" /></button>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('livestock.milk60', 'Milk, last 60 days')} value={`${num(q.data.milk_total_60d, 0)} L`} />
        <Stat label={t('livestock.weight', 'Weight')} value={a.weight ? `${num(a.weight, 0)} kg` : '—'} />
        <Stat label={t('livestock.feedCost', 'Recent feed cost')} value={money(feedCost)} />
        <Stat label={t('livestock.directCosts', 'Vet & other costs')} value={money(vetCost)} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: t('common.details') }, { value: 'milk', label: t('nav.milk') },
        { value: 'health', label: t('nav.vet'), count: q.data.treatments.length + q.data.vaccinations.length },
        { value: 'timeline', label: t('livestock.timeline', 'Timeline'), count: q.data.events.length }, { value: 'costs', label: t('common.cost') }]} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('common.details')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
              {[[t('livestock.birth', 'Born'), date(a.birth_date)], [t('livestock.acquiredAt', 'Acquired'), `${date(a.acquired_at)} · ${t(`animal.${a.acquisition}`, a.acquisition)}`],
                [t('livestock.purchasePrice', 'Purchase price'), money(a.purchase_price)], [t('livestock.value', 'Current value'), money(a.current_value)],
                [t('livestock.color', 'Colour'), a.color ?? '—'], [t('livestock.feedGroup', 'Feed group'), a.feed_group ?? '—'],
                [t('livestock.mother', 'Mother'), q.data.mother ? <Link className="text-brand-700" to={`/livestock/${q.data.mother.id}`}>{q.data.mother.name ?? q.data.mother.tag}</Link> : '—'],
                [t('livestock.father', 'Sire'), a.father_info ?? '—'],
                ...(a.status !== 'active' ? [[t('common.status'), `${t(`status.${a.status}`, a.status)} · ${date(a.status_date)}${a.sale_price ? ` · ${money(a.sale_price)}` : ''}`]] : []),
              ].map(([k, v], i) => <div key={i}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
            </dl>
            {a.notes && <p className="border-t border-line px-4 py-3 text-sm text-muted">{a.notes}</p>}
          </Card>
          <Card title={t('livestock.calves', 'Calves')}>
            {q.data.calves.length ? (
              <ul className="divide-y divide-line">{q.data.calves.map((c) => (
                <li key={c.id}><Link to={`/livestock/${c.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-canvas">
                  <span>{c.name ?? c.tag} <span className="text-muted">· {t(`animal.${c.gender}`, c.gender)}</span></span><span className="text-muted">{date(c.birth_date)}</span></Link></li>))}
              </ul>
            ) : <Empty />}
            {q.data.weights.length > 0 && (
              <div className="border-t border-line p-4">
                <p className="mb-2 text-xs font-medium text-muted">{t('livestock.weightHistory', 'Weight history')}</p>
                <div className="flex flex-wrap gap-2 text-xs">{q.data.weights.map((w) => <span key={w.id} className="rounded bg-canvas px-2 py-1">{date(w.date)}: <b>{num(w.weight, 0)} kg</b></span>)}</div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'milk' && (
        <Card title={t('livestock.milk60', 'Milk, last 60 days')}>
          {q.data.milk.length ? <Suspense fallback={<Skeleton className="m-4 h-56" />}><MiniLine data={q.data.milk.map((m) => ({ x: m.date.slice(5), y: Number(m.litres) }))} unit="L" /></Suspense> : <Empty />}
        </Card>
      )}

      {tab === 'health' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('vet.treatments', 'Treatments')}>
            {q.data.treatments.length ? <ul className="divide-y divide-line">{q.data.treatments.map((tr) => (
              <li key={tr.id} className="px-4 py-3 text-sm">
                <div className="flex justify-between"><b>{tr.diagnosis ?? t('vet.treatment', 'Treatment')}</b><Badge status={tr.outcome} /></div>
                <p className="text-xs text-muted">{date(tr.date)} · {tr.vet_name ?? '—'} · {money(tr.cost)}</p>
                {tr.medications.length > 0 && <p className="mt-1 text-xs">{tr.medications.map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(' ')).join('; ')}</p>}
              </li>))}</ul> : <Empty />}
          </Card>
          <Card title={t('vet.vaccinations', 'Vaccinations')}>
            {q.data.vaccinations.length ? <ul className="divide-y divide-line">{q.data.vaccinations.map((v) => (
              <li key={v.id} className="flex justify-between px-4 py-3 text-sm"><div><b>{v.vaccine}</b><p className="text-xs text-muted">{date(v.date)} · {v.dose ?? ''}</p></div>
                {v.next_due_date && <span className="text-xs text-muted">{t('vet.next', 'Next')}: {date(v.next_due_date)}</span>}</li>))}</ul> : <Empty />}
          </Card>
        </div>
      )}

      {tab === 'timeline' && (
        <Card>
          {q.data.events.length ? (
            <ol className="relative ml-6 border-l border-line py-4">
              {q.data.events.map((e) => (
                <li key={e.id} className="mb-5 ml-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-brand-600" />
                  <p className="text-sm font-medium">{t(`event.${e.type}`, e.type.replace('_', ' '))}
                    {e.related && <> · <Link to={`/livestock/${e.related.id}`} className="text-brand-700">{e.related.name ?? e.related.tag}</Link></>}</p>
                  <p className="text-xs text-muted">{date(e.date)}{e.details && Object.entries(e.details).map(([k, v]) => ` · ${k}: ${v}`).join('')}</p>
                  {e.notes && <p className="mt-0.5 text-sm text-muted">{e.notes}</p>}
                </li>
              ))}
            </ol>
          ) : <Empty />}
        </Card>
      )}

      {tab === 'costs' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('livestock.feedRecords', 'Feed records')}>
            <DataTable rows={q.data.feed} rowKey={(r) => r.id} columns={[
              { key: 'd', header: t('common.date'), render: (r) => date(r.date), mobile: 'subtitle' },
              { key: 'i', header: t('inventory.item', 'Item'), render: (r) => `${r.item} · ${num(-Number(r.quantity))} ${r.unit}`, mobile: 'title' },
              { key: 'v', header: t('common.cost'), className: 'text-right tabular', render: (r) => money(-Number(r.value)), mobile: 'meta' },
            ]} />
          </Card>
          <Card title={t('livestock.expenses', 'Linked expenses')}>
            <DataTable rows={q.data.expenses} rowKey={(r) => r.id} columns={[
              { key: 'd', header: t('common.date'), render: (r) => date(r.date), mobile: 'subtitle' },
              { key: 'x', header: t('common.description'), render: (r) => r.description ?? r.category, mobile: 'title' },
              { key: 'v', header: t('common.amount'), className: 'text-right tabular', render: (r) => money(r.total), mobile: 'meta' },
            ]} />
          </Card>
        </div>
      )}

      {dialog === 'edit' && <AnimalForm open animal={a} onClose={() => setDialog(null)} />}
      {dialog === 'weight' && <WeightModal id={a.id} onClose={() => setDialog(null)} />}
      {dialog === 'event' && <EventModal id={a.id} female={a.gender === 'female'} onClose={() => setDialog(null)} />}
      {dialog === 'status' && <StatusModal animal={a} onClose={() => setDialog(null)} />}
      <Confirm open={dialog === 'archive'} onClose={() => setDialog(null)} onConfirm={() => archive.mutate(undefined)} busy={archive.isPending}
        title={t('livestock.archiveTitle', 'Archive this animal?')} message={t('livestock.archiveMsg', 'It will be hidden from lists. All history is kept and it can be restored.')} />
    </div>
  )
}

function WeightModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ date: today(), weight: '', notes: '' })
  const m = useApiMutation({ url: `/animals/${id}/weights`, invalidate: [['animals']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={t('livestock.weigh', 'Record weight')} size="sm" footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="space-y-3">
        <Input label={t('livestock.weight', 'Weight (kg)')} type="number" required {...f.bind('weight')} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Input label={t('common.notes')} {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

function EventModal({ id, female, onClose }: { id: number; female: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ type: female ? 'heat' : 'note', date: today(), result: '', notes: '' })
  const m = useApiMutation({ url: `/animals/${id}/events`, invalidate: [['animals']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const types = female ? ['heat', 'insemination', 'pregnancy_check', 'dry_off', 'note'] : ['note']
  return (
    <Modal open onClose={onClose} title={t('livestock.event', 'Breeding / event')} size="sm" footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="space-y-3">
        <Select label={t('common.type')} {...f.bind('type')} options={types.map((x) => ({ value: x, label: t(`event.${x}`, x.replace('_', ' ')) }))} />
        {f.values.type === 'pregnancy_check' && <Select label={t('livestock.result', 'Result')} {...f.bind('result')} placeholder="—" options={[{ value: 'pregnant', label: t('status.pregnant', 'Pregnant') }, { value: 'open', label: t('status.open', 'Open') }]} />}
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Textarea label={t('common.notes')} {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

function StatusModal({ animal, onClose }: { animal: Animal; onClose: () => void }) {
  const { t } = useTranslation()
  const customers = useCustomers()
  const f = useForm({ status: 'sold', date: today(), sale_price: animal.current_value !== '0.00' ? animal.current_value : '', customer_id: '', paid_method: 'cash', cause: '', to: '', notes: '' })
  const m = useApiMutation({ url: `/animals/${animal.id}/status`, invalidate: [['animals']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const s = f.values.status
  return (
    <Modal open onClose={onClose} title={t('livestock.sellEtc', 'Sale, death or transfer')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-danger" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.confirm')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('common.status')} {...f.bind('status')} options={['sold', 'deceased', 'transferred'].map((x) => ({ value: x, label: t(`status.${x}`, x) }))} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        {s === 'sold' && <>
          <Input label={t('livestock.salePrice', 'Sale price')} type="number" required {...f.bind('sale_price')} />
          <Select label={t('livestock.buyer', 'Buyer (customer)')} {...f.bind('customer_id')} placeholder={t('livestock.walkIn', 'Walk-in buyer')} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <Select label={t('bills.paidNow', 'Paid now')} {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'Not paid yet')} options={methodOptions(t)} />
        </>}
        {s === 'deceased' && <Input label={t('livestock.cause', 'Cause')} wrapClass="sm:col-span-2" {...f.bind('cause')} />}
        {s === 'transferred' && <Input label={t('livestock.to', 'Transferred to')} wrapClass="sm:col-span-2" {...f.bind('to')} />}
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
      <p className="mt-3 text-xs text-muted">{t('livestock.statusHint', 'The animal leaves the active herd; its full history stays available.')}</p>
    </Modal>
  )
}
