import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HandCoins, Plus, Trash2 } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money, num } from '@/lib/format'
import { downloadCsv, monthStart, today } from '@/lib/utils'
import { useAccounts, useCustomers } from '@/lib/lookups'
import { Badge, Card, DataTable, Input, Modal, PageHeader, Pagination, Select, Spinner, Stat, Tabs, type Column } from '@/components/ui'
import { PaymentModal, methodOptions } from '@/features/shared/forms'

export type Invoice = { id: number; number: string; date: string; due_date: string | null; customer_id: number | null; customer: string | null; category: string
  description: string | null; subtotal: string; discount: string; total: string; paid: string; due: string; status: string; source_type: string | null
  items: Array<{ description: string; quantity: string; unit_price: string; amount: string }> | null }
type Payment = { id: number; date: string; customer: string | null; amount: string; unallocated: string; method: string; reference: string | null }

export default function IncomePage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const accounts = useAccounts()
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<'sale' | 'payment' | Invoice | null>(null)
  const revenue = (accounts.data ?? []).filter((a) => a.type === 'revenue')
  const catName = (k: string) => revenue.find((a) => a.key === k)?.name ?? k

  const inv = useQuery({ queryKey: ['invoices', from, to, category, status, page], placeholderData: keepPreviousData, enabled: tab === 'invoices',
    queryFn: () => get<Paginated<Invoice> & { totals: { total: string; paid: string; due: string } }>('/invoices', { from, to, category, status, page }) })
  const pays = useQuery({ queryKey: ['payments', from, to, page], placeholderData: keepPreviousData, enabled: tab === 'payments',
    queryFn: () => get<Paginated<Payment> & { total: string }>('/payments', { from, to, page }) })

  const cols: Column<Invoice>[] = [
    { key: 'n', header: '#', render: (i) => <span className="text-xs text-muted">{i.number}</span> },
    { key: 'd', header: t('common.date'), mobile: 'subtitle', render: (i) => `${date(i.date)}${i.customer ? ` · ${i.customer}` : ''}` },
    { key: 'c', header: t('common.category'), mobile: 'title', render: (i) => <span className="font-medium">{catName(i.category)}</span> },
    { key: 'x', header: t('common.description'), render: (i) => <span className="text-muted">{i.description ?? (i.source_type === 'delivery' ? t('income.fromDelivery', 'Milk delivery') : '')}</span> },
    { key: 's', header: t('common.status'), render: (i) => <Badge status={i.status} /> },
    { key: 't', header: t('common.total'), mobile: 'meta', className: 'text-right tabular font-medium', render: (i) => money(i.total) },
    { key: 'u', header: t('income.due', 'Due'), className: 'text-right tabular', render: (i) => Number(i.due) && i.status !== 'void' ? <span className="text-amber-600">{money(i.due)}</span> : '—' },
  ]

  return (
    <>
      <PageHeader title={t('nav.income')} actions={<>
        {can('payments.create') && <button className="btn-secondary" onClick={() => setModal('payment')}><HandCoins className="h-4 w-4" />{t('quick.payment', 'Payment')}</button>}
        {can('invoices.create') && <button className="btn-primary" onClick={() => setModal('sale')}><Plus className="h-4 w-4" />{t('income.newSale', 'Record sale / income')}</button>}
      </>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label={t('income.invoiced', 'Sales (revenue)')} value={money(inv.data?.totals.total, { compact: true })} />
        <Stat label={t('income.collected', 'Collected on these')} value={money(inv.data?.totals.paid, { compact: true })} tone="good" />
        <Stat label={t('income.outstanding', 'Still due')} value={money(inv.data?.totals.due, { compact: true })} tone="warn" />
      </div>
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1) }} tabs={[{ value: 'invoices', label: t('income.sales', 'Sales & invoices') }, { value: 'payments', label: t('income.receipts', 'Money received') }]} />
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <Input type="date" wrapClass="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          <Input type="date" wrapClass="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          {tab === 'invoices' && <>
            <Select wrapClass="w-44" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('common.category')} options={revenue.map((a) => ({ value: a.key, label: a.name }))} />
            <Select wrapClass="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('common.status')} options={['unpaid', 'partial', 'paid', 'void'].map((s) => ({ value: s, label: t(`status.${s}`, s) }))} />
          </>}
          <button className="btn-ghost ml-auto text-xs" onClick={() => tab === 'invoices' ? inv.data && downloadCsv('income.csv', inv.data.data.map(({ items: _i, ...r }) => r)) : pays.data && downloadCsv('receipts.csv', pays.data.data)}>{t('common.export')}</button>
        </div>
        {tab === 'invoices' ? <>
          <DataTable rows={inv.data?.data} columns={cols} rowKey={(i) => i.id} loading={inv.isLoading} onRowClick={(i) => setModal(i)} />
          <Pagination meta={inv.data?.meta} onPage={setPage} />
        </> : <>
          <DataTable rows={pays.data?.data} rowKey={(p) => p.id} loading={pays.isLoading} columns={[
            { key: 'd', header: t('common.date'), mobile: 'subtitle', render: (p) => date(p.date) },
            { key: 'c', header: t('nav.customers'), mobile: 'title', render: (p) => <span className="font-medium">{p.customer ?? '—'}</span> },
            { key: 'm', header: t('common.method'), render: (p) => `${t(`method.${p.method}`, p.method)}${p.reference ? ` · ${p.reference}` : ''}` },
            { key: 'u', header: t('customers.unapplied', 'Advance'), className: 'text-right tabular', render: (p) => Number(p.unallocated) ? money(p.unallocated) : '—' },
            { key: 'a', header: t('common.amount'), mobile: 'meta', className: 'text-right tabular font-medium text-brand-700', render: (p) => money(p.amount) },
          ]} />
          <Pagination meta={pays.data?.meta} onPage={setPage} />
        </>}
      </Card>
      {modal === 'sale' && <SaleModal onClose={() => setModal(null)} />}
      {modal === 'payment' && <PaymentModal open onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && <InvoiceModal invoice={modal} catName={catName} onClose={() => setModal(null)} />}
    </>
  )
}

function SaleModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const accounts = useAccounts()
  const customers = useCustomers()
  const f = useForm({ category: 'egg_sales', customer_id: '', date: today(), description: '', discount: '', paid_method: 'cash', items: [{ description: '', quantity: '1', unit_price: '' }] })
  const items = f.values.items
  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0) - Number(f.values.discount || 0)
  const m = useApiMutation({ url: '/invoices', invalidate: [['invoices'], ['customers']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal size="lg" open onClose={onClose} title={t('income.newSale', 'Record sale / income')} footer={<>
      <span className="mr-auto self-center text-sm">{t('common.total')}: <b>{money(total)}</b></span>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label={t('common.category')} {...f.bind('category')} options={(accounts.data ?? []).filter((a) => a.type === 'revenue' && !['milk_sales', 'animal_sales'].includes(a.key)).map((a) => ({ value: a.key, label: a.name }))} />
        <Select label={t('nav.customers')} {...f.bind('customer_id')} placeholder={t('livestock.walkIn', 'Walk-in buyer')} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Input label={t('common.description')} wrapClass="sm:col-span-3" {...f.bind('description')} />
      </div>
      <div className="mt-3 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className="input col-span-12 sm:col-span-6" placeholder={t('common.description')} value={it.description} onChange={(e) => f.set('items', items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
            <input className="input col-span-4 sm:col-span-2" type="number" placeholder={t('common.quantity')} value={it.quantity} onChange={(e) => f.set('items', items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
            <input className="input col-span-6 sm:col-span-3" type="number" placeholder={t('bills.unitPrice', 'Unit price')} value={it.unit_price} onChange={(e) => f.set('items', items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
            <button className="btn-ghost col-span-2 p-2 sm:col-span-1" disabled={items.length === 1} onClick={() => f.set('items', items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="btn-ghost text-brand-700" onClick={() => f.set('items', [...items, { description: '', quantity: '1', unit_price: '' }])}><Plus className="h-4 w-4" />{t('bills.addLine', 'Add line')}</button>
        {Object.entries(f.errors).filter(([k]) => k.startsWith('items')).slice(0, 1).map(([k, v]) => <p key={k} className="text-xs text-red-600">{v[0]}</p>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label={t('bills.discount', 'Discount')} type="number" {...f.bind('discount')} />
        <Select label={t('bills.paidNow', 'Paid now')} {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'On credit')} options={methodOptions(t)} />
      </div>
      <p className="mt-2 text-xs text-muted">{t('income.hint', 'Milk deliveries and animal sales create their income automatically — record them there, not here.')}</p>
    </Modal>
  )
}

function InvoiceModal({ invoice, catName, onClose }: { invoice: Invoice; catName: (k: string) => string; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['invoices', 'one', invoice.id], queryFn: () => get<Invoice>(`/invoices/${invoice.id}`) })
  const voidM = useApiMutation({ url: `/invoices/${invoice.id}/void`, invalidate: [['invoices'], ['customers']], success: t('income.voided', 'Invoice voided'), onSuccess: onClose })
  const i = q.data ?? invoice
  return (
    <Modal open onClose={onClose} title={`${i.number} · ${catName(i.category)}`} footer={<>
      {can('invoices.void') && i.status !== 'void' && i.source_type !== 'delivery' && <button className="btn-danger mr-auto" disabled={voidM.isPending} onClick={() => voidM.mutate({ reason: 'Voided by user' })}>{t('income.void', 'Void')}</button>}
      <button className="btn-secondary" onClick={() => window.print()}>{t('common.print')}</button>
      <button className="btn-primary" onClick={onClose}>{t('common.confirm')}</button></>}>
      <p className="text-sm text-muted">{date(i.date)}{i.customer && ` · ${i.customer}`} · <Badge status={i.status} /></p>
      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-line">
          {(i.items ?? []).map((it, k) => <tr key={k}><td className="py-2">{it.description}</td><td className="py-2 text-right tabular text-muted">{num(it.quantity)} × {money(it.unit_price)}</td><td className="py-2 text-right tabular">{money(it.amount)}</td></tr>)}
        </tbody>
      </table>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        {Number(i.discount) > 0 && <div className="flex justify-between"><dt>{t('bills.discount', 'Discount')}</dt><dd className="tabular">−{money(i.discount)}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>{t('common.total')}</dt><dd className="tabular">{money(i.total)}</dd></div>
        <div className="flex justify-between text-brand-700"><dt>{t('common.paid')}</dt><dd className="tabular">{money(i.paid)}</dd></div>
        <div className="flex justify-between text-amber-600"><dt>{t('income.due', 'Due')}</dt><dd className="tabular">{money(i.due)}</dd></div>
      </dl>
    </Modal>
  )
}
