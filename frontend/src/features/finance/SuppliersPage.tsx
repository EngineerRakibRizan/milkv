import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useDebounced, useForm } from '@/hooks/useForm'
import { date, money } from '@/lib/format'
import { today } from '@/lib/utils'
import type { Supplier } from '@/lib/lookups'
import { Badge, Card, DataTable, Input, Modal, PageHeader, SearchInput, Select, Spinner, Stat, Textarea } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'
import type { Bill } from './ExpensesPage'

export default function SuppliersPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'new' | Supplier | null>(null)
  const q = useQuery({ queryKey: ['suppliers', useDebounced(search)], queryFn: () => get<Supplier[]>('/suppliers', { search }) })
  const payable = (q.data ?? []).reduce((s, x) => s + Math.max(0, Number(x.balance)), 0)
  return (
    <>
      <PageHeader title={t('nav.suppliers')} actions={can('suppliers.create') && <button className="btn-primary" onClick={() => setModal('new')}><Plus className="h-4 w-4" />{t('suppliers.add', 'Add supplier')}</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label={t('reports.payables', 'Payables')} value={money(payable)} tone="warn" />
        <Stat label={t('suppliers.count', 'Suppliers')} value={q.data?.length ?? '—'} />
      </div>
      <Card>
        <div className="border-b border-line p-3"><SearchInput value={search} onChange={setSearch} /></div>
        <DataTable rows={q.data} rowKey={(s) => s.id} loading={q.isLoading} onRowClick={setModal} columns={[
          { key: 'n', header: t('common.name'), mobile: 'title', render: (s) => <span className="font-medium">{s.name}</span> },
          { key: 'p', header: t('common.phone'), mobile: 'subtitle', render: (s) => s.phone ?? '—' },
          { key: 't', header: t('common.type'), render: (s) => s.type ? t(`suppliers.t.${s.type}`, s.type) : '—' },
          { key: 'b', header: t('common.balance'), mobile: 'meta', className: 'text-right tabular', render: (s) => <span className={Number(s.balance) > 0 ? 'font-semibold text-amber-600' : 'text-muted'}>{money(s.balance)}</span> },
        ]} />
      </Card>
      {modal === 'new' && <SupplierForm onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && <SupplierDetail supplier={modal} onClose={() => setModal(null)} />}
    </>
  )
}

function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', address: supplier?.address ?? '', type: supplier?.type ?? 'feed', notes: supplier?.notes ?? '' })
  const m = useApiMutation({ method: supplier ? 'put' : 'post', url: supplier ? `/suppliers/${supplier.id}` : '/suppliers', invalidate: [['suppliers']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={supplier ? t('common.edit') : t('suppliers.add', 'Add supplier')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('common.name')} required {...f.bind('name')} />
        <Input label={t('common.phone')} type="tel" {...f.bind('phone')} />
        <Select label={t('common.type')} {...f.bind('type')} options={['feed', 'medicine', 'equipment', 'animals', 'services', 'other'].map((x) => ({ value: x, label: t(`suppliers.t.${x}`, x) }))} />
        <Input label={t('customers.address', 'Address')} {...f.bind('address')} />
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

function SupplierDetail({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ['suppliers', 'one', supplier.id], queryFn: () => get<{ supplier: Supplier; bills: Bill[]; payments: Array<{ id: number; date: string; amount: string; method: string }> }>(`/suppliers/${supplier.id}`) })
  const s = q.data?.supplier ?? supplier
  const f = useForm({ amount: Number(s.balance) > 0 ? s.balance : '', method: 'cash', date: today(), reference: '' })
  const pay = useApiMutation({ url: '/supplier-payments', invalidate: [['suppliers'], ['bills']], success: t('bills.paid', 'Payment recorded'), onSuccess: onClose })
  if (editing) return <SupplierForm supplier={s} onClose={onClose} />
  return (
    <Modal size="lg" open onClose={onClose} title={s.name} footer={<>
      {can('suppliers.update') && <button className="btn-secondary mr-auto" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      {can('bills.pay') && Number(s.balance) > 0 && <button className="btn-primary" disabled={pay.isPending}
        onClick={() => pay.mutate({ supplier_id: s.id, ...f.payload() }, { onError: (e) => f.setErrors(e.errors) })}>{pay.isPending && <Spinner />}{t('bills.pay', 'Pay supplier')}</button>}</>}>
      <p className="text-sm text-muted">{s.phone} {s.address && `· ${s.address}`}</p>
      <p className="mt-2 text-sm">{t('common.balance')}: <b className="text-amber-600">{money(s.balance)}</b></p>
      {can('bills.pay') && Number(s.balance) > 0 && (
        <div className="mt-3 grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-3">
          <Input label={t('common.amount')} type="number" {...f.bind('amount')} />
          <Select label={t('common.method')} {...f.bind('method')} options={methodOptions(t)} />
          <Input label={t('common.date')} type="date" {...f.bind('date')} />
        </div>
      )}
      <p className="mb-1 mt-4 text-xs font-semibold uppercase text-muted">{t('suppliers.bills', 'Bills')}</p>
      <ul className="divide-y divide-line text-sm">
        {(q.data?.bills ?? []).slice(0, 15).map((b) => (
          <li key={b.id} className="flex justify-between py-2"><span>{date(b.date)} · {b.description ?? b.number}</span><span className="flex items-center gap-2"><Badge status={b.status} /><span className="tabular">{money(b.total)}</span></span></li>
        ))}
      </ul>
    </Modal>
  )
}
