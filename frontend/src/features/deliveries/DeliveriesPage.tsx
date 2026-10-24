import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, MapPin, Phone, Plus, Printer, Sparkles, X } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { money, num, date } from '@/lib/format'
import { downloadCsv, shiftDate, today } from '@/lib/utils'
import { useCustomers, useEmployees } from '@/lib/lookups'
import { Badge, Card, Empty, Input, Modal, PageHeader, Select, Skeleton, Spinner, Stat, Tabs } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'

export type Delivery = {
  id: number; date: string; customer_id: number; customer: { id: number; name: string; phone: string | null; area: string | null; address: string | null; balance: string } | null
  employee_id: number | null; employee: string | null; ordered: string; delivered: string; unit_price: string; discount: string; amount: string
  status: string; delivered_at: string | null; invoice_id: number | null; notes: string | null
}
type Resp = { data: Delivery[]; summary: { ordered: string; delivered: string; amount: string; by_status: Record<string, number> } }

const OPEN = ['pending', 'prepared', 'out_for_delivery']
const shift = shiftDate

export default function DeliveriesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [day, setDay] = useState(today())
  const [tab, setTab] = useState<'open' | 'done' | 'cancelled' | 'all'>('open')
  const [area, setArea] = useState('')
  const [editing, setEditing] = useState<Delivery | null>(null)
  const [adding, setAdding] = useState(false)
  const key = ['deliveries', day]
  const q = useQuery({ queryKey: key, queryFn: () => get<Resp>('/deliveries', { date: day }) })

  const generate = useApiMutation<{ date: string }, { created: number }>({
    url: '/deliveries/generate', invalidate: [['deliveries']], success: (r) => t('deliveries.generated', { defaultValue: '{{n}} deliveries created', n: r.created }),
  })
  // One-tap "delivered": optimistic so the row flips instantly, queued if offline.
  const quick = useApiMutation<{ id: number; status: string }, Delivery>({
    method: 'patch', url: (v) => `/deliveries/${v.id}`, offline: true, label: 'Delivery', invalidate: [['deliveries'], ['milk'], ['customers']],
    optimistic: { key, update: (old, v) => old && { ...(old as Resp), data: (old as Resp).data.map((d) => d.id === v.id ? { ...d, status: v.status, delivered: v.status === 'delivered' ? d.ordered : d.delivered } : d) } },
  })

  const rows = useMemo(() => (q.data?.data ?? []).filter((d) =>
    (tab === 'all' || (tab === 'open' && OPEN.includes(d.status)) || (tab === 'done' && ['delivered', 'partial'].includes(d.status)) || (tab === 'cancelled' && d.status === 'cancelled'))
    && (!area || d.customer?.area === area)), [q.data, tab, area])
  const areas = [...new Set((q.data?.data ?? []).map((d) => d.customer?.area).filter(Boolean))] as string[]
  const counts = q.data?.data.reduce((c, d) => {
    const k = OPEN.includes(d.status) ? 'open' : ['delivered', 'partial'].includes(d.status) ? 'done' : 'cancelled'
    c[k] = (c[k] ?? 0) + 1
    return c
  }, {} as Record<string, number>) ?? {}

  return (
    <>
      <PageHeader title={t('nav.deliveries')} actions={<>
        <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline">{t('common.print')}</span></button>
        <button className="btn-secondary" onClick={() => q.data && downloadCsv(`deliveries-${day}.csv`, q.data.data.map((d) => ({
          customer: d.customer?.name, area: d.customer?.area, ordered_l: d.ordered, delivered_l: d.delivered, price: d.unit_price, amount: d.amount, status: d.status })))}>{t('common.export')}</button>
        {can('deliveries.create') && <>
          <button className="btn-secondary" onClick={() => generate.mutate({ date: day })} disabled={generate.isPending}><Sparkles className="h-4 w-4" />{t('deliveries.generate', 'Create from schedules')}</button>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('deliveries.add', 'Add')}</button>
        </>}
      </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-secondary px-2" onClick={() => setDay(shift(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" className="input w-auto" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className="btn-secondary px-2" onClick={() => setDay(shift(day, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        {areas.length > 1 && <Select wrapClass="w-44" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t('deliveries.allAreas', 'All areas')} options={areas} />}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label={t('deliveries.ordered', 'Ordered')} value={`${num(q.data?.summary.ordered, 1)} L`} />
        <Stat label={t('milk.delivered', 'Delivered')} value={`${num(q.data?.summary.delivered, 1)} L`} tone="good" />
        <Stat label={t('deliveries.sales', 'Sales')} value={money(q.data?.summary.amount)} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'open', label: t('deliveries.open', 'To deliver'), count: counts.open ?? 0 }, { value: 'done', label: t('deliveries.done', 'Delivered'), count: counts.done ?? 0 },
        { value: 'cancelled', label: t('status.cancelled', 'Cancelled'), count: counts.cancelled ?? 0 }, { value: 'all', label: t('common.all') }]} />

      <Card>
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          : !rows.length ? <Empty title={t('deliveries.empty', 'No deliveries')} hint={tab === 'open' && !q.data?.data.length ? t('deliveries.emptyHint', 'Use “Create from schedules” to build today’s list from customer defaults.') : undefined} />
          : (
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/customers/${d.customer_id}`} className="truncate font-medium hover:underline">{d.customer?.name}</Link>
                      <Badge status={d.status} />
                    </div>
                    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      {d.customer?.area && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{d.customer.area}</span>}
                      {d.customer?.phone && <a href={`tel:${d.customer.phone}`} className="inline-flex items-center gap-1 text-brand-700"><Phone className="h-3 w-3" />{d.customer.phone}</a>}
                      {d.employee && <span>🚚 {d.employee}</span>}
                      {Number(d.customer?.balance) > 0 && <span className="text-amber-600">{t('common.balance')}: {money(d.customer!.balance)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold">{['delivered', 'partial'].includes(d.status) ? num(d.delivered, 1) : num(d.ordered, 1)} L</p>
                      <p className="tabular text-xs text-muted">{['delivered', 'partial'].includes(d.status) ? money(d.amount) : `@ ${money(d.unit_price)}`}</p>
                    </div>
                    {can('deliveries.update') && OPEN.includes(d.status) && (
                      <>
                        <button className="btn-primary h-11 w-11 p-0" title={t('deliveries.markDelivered', 'Delivered')} aria-label={t('deliveries.markDelivered', 'Delivered')}
                          onClick={() => quick.mutate({ id: d.id, status: 'delivered' })}><Check className="h-5 w-5" /></button>
                        <button className="btn-secondary h-11 px-3 text-xs" onClick={() => setEditing(d)}>{t('common.details')}</button>
                      </>
                    )}
                    {can('deliveries.update') && !OPEN.includes(d.status) && <button className="btn-ghost text-xs" onClick={() => setEditing(d)}>{t('common.edit')}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>
      {editing && <DeliveryModal delivery={editing} onClose={() => setEditing(null)} />}
      {adding && <AddDeliveryModal day={day} onClose={() => setAdding(false)} />}
    </>
  )
}

function DeliveryModal({ delivery: d, onClose }: { delivery: Delivery; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ status: OPEN.includes(d.status) ? 'delivered' : d.status, delivered: d.status === 'pending' ? d.ordered : d.delivered, collected: '', method: 'cash', notes: d.notes ?? '' })
  const m = useApiMutation({ method: 'patch', url: `/deliveries/${d.id}`, invalidate: [['deliveries'], ['milk'], ['customers']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const completed = ['delivered', 'partial'].includes(f.values.status)
  const amount = completed ? Number(f.values.delivered || 0) * Number(d.unit_price) - Number(d.discount) : 0
  return (
    <Modal open onClose={onClose} title={`${d.customer?.name} · ${date(d.date)}`} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="mb-3 flex flex-wrap gap-2">
        {['prepared', 'out_for_delivery', 'delivered', 'cancelled'].map((s) => (
          <button key={s} className={f.values.status === s || (s === 'delivered' && f.values.status === 'partial') ? 'btn-primary' : 'btn-secondary'} onClick={() => f.set('status', s)}>
            {s === 'cancelled' ? <X className="h-4 w-4" /> : null}{t(`status.${s}`, s.replace(/_/g, ' '))}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {completed && <Input label={`${t('deliveries.deliveredQty', 'Delivered quantity')} (L)`} type="number" hint={`${t('deliveries.ordered', 'Ordered')}: ${num(d.ordered, 1)} L`} {...f.bind('delivered')} />}
        {completed && <div className="self-end pb-2 text-sm">{t('common.amount')}: <b className="tabular">{money(amount)}</b></div>}
        {completed && <Input label={t('deliveries.collected', 'Cash collected now')} type="number" {...f.bind('collected')} hint={Number(d.customer?.balance) > 0 ? `${t('common.balance')}: ${money(d.customer!.balance)}` : undefined} />}
        {completed && f.values.collected && <Select label={t('common.method')} {...f.bind('method')} options={methodOptions(t)} />}
        <Input label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
      <p className="mt-3 text-xs text-muted">{t('deliveries.postHint', 'Marking delivered takes the milk out of stock and adds the sale to the customer’s account in one step.')}</p>
    </Modal>
  )
}

function AddDeliveryModal({ day, onClose }: { day: string; onClose: () => void }) {
  const { t } = useTranslation()
  const customers = useCustomers()
  const employees = useEmployees()
  const f = useForm({ customer_id: '', date: day, quantity: '', unit_price: '', employee_id: '', notes: '' })
  const c = customers.data?.find((x) => String(x.id) === f.values.customer_id)
  const m = useApiMutation({ url: '/deliveries', invalidate: [['deliveries']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={t('deliveries.add', 'Add delivery')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('nav.customers')} wrapClass="sm:col-span-2" required {...f.bind('customer_id')} placeholder="—" options={(customers.data ?? []).map((x) => ({ value: x.id, label: `${x.name}${x.area ? ` · ${x.area}` : ''}` }))} />
        <Input label={`${t('common.quantity')} (L)`} type="number" required {...f.bind('quantity')} placeholder={c ? c.default_qty : ''} />
        <Input label={t('deliveries.price', 'Price per litre')} type="number" {...f.bind('unit_price')} placeholder={c?.price ?? t('deliveries.default', 'default')} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Select label={t('deliveries.person', 'Delivery person')} {...f.bind('employee_id')} placeholder="—" options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
      </div>
    </Modal>
  )
}
