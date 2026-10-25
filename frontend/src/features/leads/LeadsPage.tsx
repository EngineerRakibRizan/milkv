import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, MessageCircle, Phone, PhoneCall, UserPlus, X } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useDebounced, useForm } from '@/hooks/useForm'
import { date, dateTime, num } from '@/lib/format'
import { useEmployees } from '@/lib/lookups'
import { Badge, Card, Empty, Input, Modal, PageHeader, Pagination, SearchInput, Select, Skeleton, Spinner, Tabs, Textarea } from '@/components/ui'

type Lead = { id: number; name: string; phone: string; area: string | null; address: string | null; quantity: string; start_date: string | null
  message: string | null; source: string; status: string; notes: string | null; customer_id: number | null; created_at: string; contacted_at: string | null }
type Resp = Paginated<Lead> & { counts: Record<string, number> }

const STATUS_TONE: Record<string, 'blue' | 'amber' | 'green' | 'gray'> = { new: 'blue', contacted: 'amber', converted: 'green', lost: 'gray' }

export default function LeadsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [status, setStatus] = useState('new')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ kind: 'convert' | 'notes'; lead: Lead } | null>(null)
  const params = { status: status === 'all' ? undefined : status, search: useDebounced(search), page }
  const q = useQuery({ queryKey: ['leads', params], queryFn: () => get<Resp>('/leads', params), placeholderData: keepPreviousData })
  const update = useApiMutation<{ id: number; status?: string; notes?: string }>({
    method: 'patch', url: (v) => `/leads/${v.id}`, invalidate: [['leads']], success: t('common.saved', 'Saved'),
  })
  const c = q.data?.counts ?? {}

  return (
    <>
      <PageHeader title={t('nav.leads')} subtitle={t('leads.subtitle')} actions={
        <Link to="/order" target="_blank" className="btn-secondary"><ExternalLink className="h-4 w-4" />{t('leads.openPage')}</Link>} />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1) }} tabs={[
        { value: 'new', label: t('leads.s.new'), count: c.new ?? 0 }, { value: 'contacted', label: t('leads.s.contacted'), count: c.contacted ?? 0 },
        { value: 'converted', label: t('leads.s.converted'), count: c.converted ?? 0 }, { value: 'lost', label: t('leads.s.lost'), count: c.lost ?? 0 },
        { value: 'all', label: t('common.all') }]} />
      <Card>
        <div className="border-b border-line p-3"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('leads.search')} /></div>
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          : !q.data?.data.length ? <Empty title={t('leads.empty')} hint={t('leads.emptyHint')} />
          : (
            <ul className="divide-y divide-line">
              {q.data.data.map((l) => (
                <li key={l.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{l.name}</span>
                      <Badge tone={STATUS_TONE[l.status]}>{t(`leads.s.${l.status}`)}</Badge>
                      <span className="text-xs text-muted">{dateTime(l.created_at)}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 font-medium text-brand-700"><Phone className="h-3.5 w-3.5" />{l.phone}</a>
                      <a href={`https://wa.me/88${l.phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>
                      {Number(l.quantity) > 0 && <span><b>{num(l.quantity, 1)} L</b> / {t('leads.day')}</span>}
                      {l.area && <span className="text-muted">{l.area}</span>}
                      {l.start_date && <span className="text-muted">{t('leads.from')} {date(l.start_date)}</span>}
                    </p>
                    {l.address && <p className="mt-0.5 text-sm text-muted">{l.address}</p>}
                    {l.message && <p className="mt-1 rounded-lg bg-canvas px-3 py-1.5 text-sm">“{l.message}”</p>}
                    {l.notes && <p className="mt-1 text-sm text-muted">📝 {l.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {l.status === 'converted' && l.customer_id
                      ? <Link to={`/customers/${l.customer_id}`} className="btn-secondary">{t('leads.viewCustomer')}</Link>
                      : can('leads.update') && <>
                        {l.status === 'new' && <button className="btn-secondary" onClick={() => update.mutate({ id: l.id, status: 'contacted' })}><PhoneCall className="h-4 w-4" />{t('leads.markCalled')}</button>}
                        <button className="btn-secondary" onClick={() => setModal({ kind: 'notes', lead: l })}>{t('leads.notes')}</button>
                        {can('customers.create') && <button className="btn-primary" onClick={() => setModal({ kind: 'convert', lead: l })}><UserPlus className="h-4 w-4" />{t('leads.convert')}</button>}
                        {l.status !== 'lost' && <button className="btn-ghost" title={t('leads.markLost')} onClick={() => update.mutate({ id: l.id, status: 'lost' })}><X className="h-4 w-4" /></button>}
                      </>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        <Pagination meta={q.data?.meta} onPage={setPage} />
      </Card>
      {modal?.kind === 'convert' && <ConvertModal lead={modal.lead} onClose={() => setModal(null)} />}
      {modal?.kind === 'notes' && <NotesModal lead={modal.lead} onClose={() => setModal(null)} />}
    </>
  )
}

function ConvertModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const employees = useEmployees()
  const f = useForm({ name: lead.name, phone: lead.phone, area: lead.area ?? '', address: lead.address ?? '',
    default_qty: Number(lead.quantity) ? String(Number(lead.quantity)) : '', price: '', schedule: 'daily', employee_id: '' })
  const m = useApiMutation<Record<string, unknown>, { customer_id: number }>({
    url: `/leads/${lead.id}/convert`, invalidate: [['leads'], ['customers']], success: t('leads.converted'),
    onSuccess: (r) => navigate(`/customers/${r.customer_id}`),
  })
  return (
    <Modal open size="lg" onClose={onClose} title={t('leads.convertTitle')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('leads.convert')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('common.name')} required {...f.bind('name')} />
        <Input label={t('common.phone')} {...f.bind('phone')} />
        <Input label={t('customers.area', 'Area')} {...f.bind('area')} />
        <Input label={t('customers.address', 'Address')} {...f.bind('address')} />
        <Input label={t('customers.defaultQty', 'Daily quantity (L)')} type="number" {...f.bind('default_qty')} />
        <Input label={t('deliveries.price', 'Price per litre')} type="number" {...f.bind('price')} hint={t('customers.priceHint')} />
        <Select label={t('customers.schedule', 'Schedule')} {...f.bind('schedule')} options={['daily', 'alternate', 'weekly', 'on_demand'].map((x) => ({ value: x, label: t(`customers.sched.${x}`, x) }))} />
        <Select label={t('deliveries.person', 'Delivery person')} {...f.bind('employee_id')} placeholder="—" options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
      </div>
      <p className="mt-3 text-xs text-muted">{t('leads.convertHint')}</p>
    </Modal>
  )
}

function NotesModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ notes: lead.notes ?? '' })
  const m = useApiMutation({ method: 'patch', url: `/leads/${lead.id}`, invalidate: [['leads']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open size="sm" onClose={onClose} title={`${t('leads.notes')} — ${lead.name}`} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <Textarea label={t('leads.notesHint')} rows={4} {...f.bind('notes')} />
    </Modal>
  )
}
