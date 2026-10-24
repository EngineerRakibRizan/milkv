import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money, num } from '@/lib/format'
import { downloadCsv, monthStart, today } from '@/lib/utils'
import { useAccounts } from '@/lib/lookups'
import { Badge, Card, DataTable, Input, Modal, PageHeader, Pagination, Select, Spinner, Stat, Tabs, type Column } from '@/components/ui'
import { BillModal, methodOptions } from '@/features/shared/forms'

export type Bill = { id: number; number: string; date: string; due_date: string | null; supplier_id: number | null; supplier: string | null; kind: string; category: string
  description: string | null; subtotal: string; discount: string; extra_cost: string; total: string; paid: string; due: string; status: string; source_type: string | null
  items: Array<{ description: string; quantity: string; unit_price: string; amount: string }> | null }

export default function ExpensesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const accounts = useAccounts()
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<'new' | Bill | null>(null)
  const name = (k: string) => k === 'feed_inventory' ? t('bills.kind.purchase', 'Stock purchase') : accounts.data?.find((a) => a.key === k)?.name ?? k
  const params = { kind, from, to, category, status, page }
  const q = useQuery({ queryKey: ['bills', params], queryFn: () => get<Paginated<Bill> & { totals: { total: string; paid: string; due: string } }>('/bills', params), placeholderData: keepPreviousData })

  const cols: Column<Bill>[] = [
    { key: 'd', header: t('common.date'), mobile: 'subtitle', render: (b) => `${date(b.date)}${b.supplier ? ` · ${b.supplier}` : ''}` },
    { key: 'c', header: t('common.category'), mobile: 'title', render: (b) => <span className="font-medium">{name(b.category)}</span> },
    { key: 'x', header: t('common.description'), render: (b) => <span className="text-muted">{b.description}</span> },
    { key: 'k', header: t('common.type'), render: (b) => <Badge tone={b.kind === 'expense' ? 'gray' : b.kind === 'purchase' ? 'blue' : 'green'}>{t(`bills.k.${b.kind}`, b.kind)}</Badge> },
    { key: 's', header: t('common.status'), render: (b) => <Badge status={b.status} /> },
    { key: 't', header: t('common.total'), mobile: 'meta', className: 'text-right tabular font-medium', render: (b) => money(b.total) },
    { key: 'u', header: t('income.due', 'Due'), className: 'text-right tabular', render: (b) => Number(b.due) && b.status !== 'void' ? <span className="text-amber-600">{money(b.due)}</span> : '—' },
  ]

  return (
    <>
      <PageHeader title={t('nav.expenses')} subtitle={t('bills.subtitle', 'Bills record what was spent; payments record when money left. Paying a bill never doubles the expense.')}
        actions={can('bills.create') && <button className="btn-primary" onClick={() => setModal('new')}><Plus className="h-4 w-4" />{t('quick.expense', 'Add expense')}</button>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label={t('bills.billed', 'Billed')} value={money(q.data?.totals.total, { compact: true })} />
        <Stat label={t('bills.paidOut', 'Paid')} value={money(q.data?.totals.paid, { compact: true })} />
        <Stat label={t('reports.payables', 'Unpaid')} value={money(q.data?.totals.due, { compact: true })} tone="warn" />
      </div>
      <Tabs value={kind} onChange={(v) => { setKind(v); setPage(1) }} tabs={[{ value: '', label: t('common.all') }, { value: 'expense', label: t('bills.k.expense', 'Expenses') },
        { value: 'purchase', label: t('bills.k.purchase', 'Stock purchases') }, { value: 'asset', label: t('bills.k.asset', 'Assets') }]} />
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <Input type="date" wrapClass="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" wrapClass="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select wrapClass="w-48" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('common.category')}
            options={(accounts.data ?? []).filter((a) => a.type === 'expense').map((a) => ({ value: a.key, label: a.name }))} />
          <Select wrapClass="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('common.status')} options={['unpaid', 'partial', 'paid', 'void'].map((s) => ({ value: s, label: t(`status.${s}`, s) }))} />
          <button className="btn-ghost ml-auto text-xs" onClick={() => q.data && downloadCsv('expenses.csv', q.data.data.map(({ items: _i, ...r }) => r))}>{t('common.export')}</button>
        </div>
        <DataTable rows={q.data?.data} columns={cols} rowKey={(b) => b.id} loading={q.isLoading} onRowClick={(b) => setModal(b)} />
        <Pagination meta={q.data?.meta} onPage={setPage} />
      </Card>
      {modal === 'new' && <BillModal open onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && <BillDetail bill={modal} name={name} onClose={() => setModal(null)} />}
    </>
  )
}

function BillDetail({ bill, name, onClose }: { bill: Bill; name: (k: string) => string; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['bills', 'one', bill.id], queryFn: () => get<Bill>(`/bills/${bill.id}`) })
  const b = q.data ?? bill
  const f = useForm({ amount: b.due, method: 'cash', date: today(), reference: '' })
  const pay = useApiMutation({ url: '/supplier-payments', invalidate: [['bills'], ['suppliers']], success: t('bills.paid', 'Payment recorded'), onSuccess: onClose })
  const voidM = useApiMutation({ url: `/bills/${bill.id}/void`, invalidate: [['bills'], ['suppliers']], success: t('income.voided', 'Voided'), onSuccess: onClose })
  const open = ['unpaid', 'partial'].includes(b.status)
  return (
    <Modal open onClose={onClose} title={`${b.number} · ${name(b.category)}`} footer={<>
      {can('bills.void') && b.status === 'unpaid' && b.kind !== 'purchase' && !b.source_type && <button className="btn-danger mr-auto" onClick={() => voidM.mutate(undefined)}>{t('income.void', 'Void')}</button>}
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      {open && can('bills.pay') && <button className="btn-primary" disabled={pay.isPending}
        onClick={() => pay.mutate({ bill_id: b.id, ...f.payload() }, { onError: (e) => f.setErrors(e.errors) })}>{pay.isPending && <Spinner />}{t('bills.pay', 'Pay')}</button>}</>}>
      <p className="text-sm text-muted">{date(b.date)}{b.supplier && ` · ${b.supplier}`} · <Badge status={b.status} />{b.source_type && <> · {t('bills.linked', 'linked to')} {b.source_type}</>}</p>
      {b.description && <p className="mt-1 text-sm">{b.description}</p>}
      <table className="mt-3 w-full text-sm"><tbody className="divide-y divide-line">
        {(b.items ?? []).map((it, k) => <tr key={k}><td className="py-2">{it.description}</td><td className="py-2 text-right tabular text-muted">{num(it.quantity)} × {money(it.unit_price)}</td><td className="py-2 text-right tabular">{money(it.amount)}</td></tr>)}
      </tbody></table>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        {Number(b.discount) > 0 && <div className="flex justify-between"><dt>{t('bills.discount', 'Discount')}</dt><dd>−{money(b.discount)}</dd></div>}
        {Number(b.extra_cost) > 0 && <div className="flex justify-between"><dt>{t('bills.extra', 'Extra cost')}</dt><dd>+{money(b.extra_cost)}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>{t('common.total')}</dt><dd>{money(b.total)}</dd></div>
        <div className="flex justify-between text-amber-600"><dt>{t('income.due', 'Due')}</dt><dd>{money(b.due)}</dd></div>
      </dl>
      {open && can('bills.pay') && (
        <div className="mt-4 grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-3">
          <Input label={t('common.amount')} type="number" {...f.bind('amount')} />
          <Select label={t('common.method')} {...f.bind('method')} options={methodOptions(t)} />
          <Input label={t('common.date')} type="date" {...f.bind('date')} />
        </div>
      )}
    </Modal>
  )
}
