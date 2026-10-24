import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HandCoins, Plus } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useDebounced, useForm } from '@/hooks/useForm'
import { useApiMutation } from '@/hooks/useApiMutation'
import { money, num } from '@/lib/format'
import { downloadCsv } from '@/lib/utils'
import { useEmployees, type Customer } from '@/lib/lookups'
import { Badge, Card, DataTable, Empty, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Stat, Tabs, Textarea, type Column } from '@/components/ui'
import { PaymentModal } from '@/features/shared/forms'

type ListResp = Paginated<Customer> & { areas: string[]; total_due: string }

export default function CustomersPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [balance, setBalance] = useState<'' | 'due' | 'advance'>('')
  const [status, setStatus] = useState('')
  const [area, setArea] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<'add' | 'pay' | null>(null)
  const params = { balance, status, area, search: useDebounced(search), page, sort: balance === 'due' ? 'balance' : 'name' }
  const q = useQuery({ queryKey: ['customers', params], queryFn: () => get<ListResp>('/customers', params), placeholderData: keepPreviousData })

  const cols: Column<Customer>[] = [
    { key: 'name', header: t('common.name'), mobile: 'title', render: (c) => <span className="font-medium">{c.name} <span className="text-xs font-normal text-muted">{c.code}</span></span> },
    { key: 'phone', header: t('common.phone'), mobile: 'subtitle', render: (c) => <>{c.phone ?? '—'}{c.area && <span className="text-muted"> · {c.area}</span>}</> },
    { key: 'qty', header: t('customers.daily', 'Daily'), className: 'text-right tabular', render: (c) => Number(c.default_qty) ? `${num(c.default_qty, 1)} L` : '—' },
    { key: 'price', header: t('deliveries.price', 'Price / L'), className: 'text-right tabular', render: (c) => c.price ? money(c.price) : <span className="text-muted">{t('deliveries.default', 'default')}</span> },
    { key: 'status', header: t('common.status'), render: (c) => <Badge status={c.status} /> },
    { key: 'bal', header: t('common.balance'), mobile: 'meta', className: 'text-right tabular', render: (c) => (
      <span className={Number(c.balance) > 0 ? 'font-semibold text-amber-600' : Number(c.balance) < 0 ? 'text-brand-700' : 'text-muted'}>
        {Number(c.balance) < 0 ? `${money(-Number(c.balance))} ${t('customers.adv', 'adv.')}` : money(c.balance)}</span>) },
  ]

  return (
    <>
      <PageHeader title={t('nav.customers')} actions={<>
        <button className="btn-secondary" onClick={() => q.data && downloadCsv('customers.csv', q.data.data as unknown as Record<string, unknown>[])}>{t('common.export')}</button>
        {can('payments.create') && <button className="btn-secondary" onClick={() => setModal('pay')}><HandCoins className="h-4 w-4" />{t('quick.payment', 'Payment')}</button>}
        {can('customers.create') && <button className="btn-primary" onClick={() => setModal('add')}><Plus className="h-4 w-4" />{t('customers.add', 'Add customer')}</button>}
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label={t('dashboard.receivables')} value={money(q.data?.total_due)} tone="warn" />
        <Stat label={t('customers.count', 'Customers')} value={q.data?.meta.total ?? '—'} />
      </div>
      <Tabs value={balance} onChange={(v) => { setBalance(v); setPage(1) }} tabs={[
        { value: '', label: t('common.all') }, { value: 'due', label: t('customers.withDues', 'With dues') }, { value: 'advance', label: t('customers.advances', 'Advance paid') }]} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('customers.search', 'Name, phone or ID…')} />
          <Select wrapClass="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('common.status')} options={['active', 'paused', 'inactive'].map((s) => ({ value: s, label: t(`status.${s}`, s) }))} />
          {!!q.data?.areas.length && <Select wrapClass="w-40" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t('deliveries.allAreas', 'All areas')} options={q.data.areas} />}
        </div>
        <DataTable rows={q.data?.data} columns={cols} rowKey={(c) => c.id} loading={q.isLoading} onRowClick={(c) => navigate(`/customers/${c.id}`)}
          empty={<Empty title={t('customers.empty', 'No customers yet')} />} />
        <Pagination meta={q.data?.meta} onPage={setPage} />
      </Card>
      {modal === 'add' && <CustomerForm onClose={() => setModal(null)} onSaved={(c) => navigate(`/customers/${c.id}`)} />}
      {modal === 'pay' && <PaymentModal open onClose={() => setModal(null)} />}
    </>
  )
}

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const { t } = useTranslation()
  const employees = useEmployees()
  const f = useForm({
    name: customer?.name ?? '', phone: customer?.phone ?? '', alt_phone: customer?.alt_phone ?? '', address: customer?.address ?? '', area: customer?.area ?? '',
    type: customer?.type ?? 'household', default_qty: customer && Number(customer.default_qty) ? customer.default_qty : '', price: customer?.price ?? '',
    schedule: customer?.schedule ?? 'daily', payment_terms: customer?.payment_terms ?? 'monthly', employee_id: customer?.employee_id ? String(customer.employee_id) : '',
    status: customer?.status ?? 'active', notes: customer?.notes ?? '',
  })
  const m = useApiMutation<Record<string, unknown>, Customer>({
    method: customer ? 'put' : 'post', url: customer ? `/customers/${customer.id}` : '/customers', invalidate: [['customers']],
    success: t('common.saved', 'Saved'), onSuccess: (c) => { onSaved?.(c); onClose() },
  })
  return (
    <Modal size="lg" open onClose={onClose} title={customer ? t('common.edit') : t('customers.add', 'Add customer')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t('customers.name', 'Name / business')} wrapClass="sm:col-span-2" required {...f.bind('name')} />
        <Select label={t('common.type')} {...f.bind('type')} options={['household', 'shop', 'restaurant', 'wholesale'].map((x) => ({ value: x, label: t(`customers.type.${x}`, x) }))} />
        <Input label={t('common.phone')} type="tel" inputMode="tel" placeholder="01XXXXXXXXX" {...f.bind('phone')} />
        <Input label={t('customers.altPhone', 'Alternative phone')} type="tel" {...f.bind('alt_phone')} />
        <Input label={t('customers.area', 'Area')} {...f.bind('area')} />
        <Input label={t('customers.address', 'Delivery address')} wrapClass="sm:col-span-3" {...f.bind('address')} />
        <Input label={t('customers.defaultQty', 'Daily quantity (L)')} type="number" {...f.bind('default_qty')} />
        <Input label={t('deliveries.price', 'Price per litre')} type="number" {...f.bind('price')} hint={t('customers.priceHint', 'Leave empty to use the farm default')} />
        <Select label={t('customers.schedule', 'Schedule')} {...f.bind('schedule')} options={['daily', 'alternate', 'weekly', 'on_demand'].map((x) => ({ value: x, label: t(`customers.sched.${x}`, x.replace('_', ' ')) }))} />
        <Select label={t('customers.terms', 'Payment terms')} {...f.bind('payment_terms')} options={['daily', 'weekly', 'monthly', 'advance'].map((x) => ({ value: x, label: t(`terms.${x}`, x) }))} />
        <Select label={t('deliveries.person', 'Delivery person')} {...f.bind('employee_id')} placeholder="—" options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
        <Select label={t('common.status')} {...f.bind('status')} options={['active', 'paused', 'inactive'].map((s) => ({ value: s, label: t(`status.${s}`, s) }))} />
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-3" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}
