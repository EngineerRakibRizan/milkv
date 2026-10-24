import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, HandCoins, Pencil, Phone, Printer } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { date, money, num } from '@/lib/format'
import { monthStart, today, downloadCsv } from '@/lib/utils'
import type { Customer } from '@/lib/lookups'
import { Badge, Card, DataTable, ErrorState, Input, Skeleton, Stat, Tabs } from '@/components/ui'
import { PaymentModal } from '@/features/shared/forms'
import { CustomerForm } from './CustomersPage'
import type { Delivery } from '@/features/deliveries/DeliveriesPage'

type Invoice = { id: number; number: string; date: string; total: string; paid: string; due: string; status: string; description: string | null; category: string }
type Detail = {
  customer: Customer
  stats: { total_invoiced: string; total_paid: string; month_litres: string; month_amount: string }
  deliveries: Delivery[]
  payments: Array<{ id: number; date: string; amount: string; method: string; reference: string | null; unallocated: string }>
  open_invoices: Invoice[]
}
type Statement = { opening: string; closing: string; total_debit: string; total_credit: string
  lines: Array<{ date: string; type: string; ref: string; description: string; debit: string; credit: string; balance: string }> }

export default function CustomerPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { can } = useAuth()
  const [tab, setTab] = useState<'deliveries' | 'payments' | 'statement'>('deliveries')
  const [modal, setModal] = useState<'edit' | 'pay' | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const q = useQuery({ queryKey: ['customers', 'detail', id], queryFn: () => get<Detail>(`/customers/${id}`) })
  const st = useQuery({ queryKey: ['customers', 'statement', id, from, to], queryFn: () => get<Statement>(`/customers/${id}/statement`, { from, to }), enabled: tab === 'statement' })

  if (q.error) return <ErrorState error={q.error} />
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-60" /></div>
  const { customer: c, stats } = q.data
  const bal = Number(c.balance)

  return (
    <div className="space-y-5">
      <Link to="/customers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink print:hidden"><ArrowLeft className="h-4 w-4" />{t('nav.customers')}</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <span>{c.code}</span>
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-brand-700"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
            {c.area && <span>{c.area}</span>}<Badge status={c.status} />
          </p>
          {c.address && <p className="text-sm text-muted">{c.address}</p>}
        </div>
        <div className="flex gap-2 print:hidden">
          {can('customers.update') && <button className="btn-secondary" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" />{t('common.edit')}</button>}
          {can('payments.create') && <button className="btn-primary" onClick={() => setModal('pay')}><HandCoins className="h-4 w-4" />{t('quick.payment', 'Record payment')}</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={bal >= 0 ? t('customers.outstanding', 'Outstanding') : t('customers.advance', 'Advance')} value={money(Math.abs(bal))} tone={bal > 0 ? 'warn' : 'good'} />
        <Stat label={t('customers.thisMonth', 'This month')} value={`${num(stats.month_litres, 1)} L`} hint={money(stats.month_amount)} />
        <Stat label={t('customers.totalPurchases', 'Total purchases')} value={money(stats.total_invoiced, { compact: true })} />
        <Stat label={t('customers.totalPaid', 'Total paid')} value={money(stats.total_paid, { compact: true })} />
      </div>

      <div className="print:hidden">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'deliveries', label: t('nav.deliveries') }, { value: 'payments', label: t('customers.payments', 'Payments') }, { value: 'statement', label: t('customers.statement', 'Statement') }]} />
      </div>

      {tab === 'deliveries' && (
        <Card>
          <DataTable rows={q.data.deliveries} rowKey={(d) => d.id} columns={[
            { key: 'd', header: t('common.date'), mobile: 'title', render: (d) => date(d.date) },
            { key: 'q', header: t('common.quantity'), mobile: 'subtitle', render: (d) => `${num(d.delivered !== '0.000' ? d.delivered : d.ordered, 1)} L @ ${money(d.unit_price)}` },
            { key: 's', header: t('common.status'), mobile: 'meta', render: (d) => <Badge status={d.status} /> },
            { key: 'a', header: t('common.amount'), mobile: 'meta', className: 'text-right tabular', render: (d) => money(d.amount) },
          ]} />
        </Card>
      )}
      {tab === 'payments' && (
        <Card>
          <DataTable rows={q.data.payments} rowKey={(p) => p.id} columns={[
            { key: 'd', header: t('common.date'), mobile: 'title', render: (p) => date(p.date) },
            { key: 'm', header: t('common.method'), mobile: 'subtitle', render: (p) => `${t(`method.${p.method}`, p.method)}${p.reference ? ` · ${p.reference}` : ''}` },
            { key: 'u', header: t('customers.unapplied', 'Unapplied'), className: 'text-right tabular', render: (p) => Number(p.unallocated) ? money(p.unallocated) : '—' },
            { key: 'a', header: t('common.amount'), mobile: 'meta', className: 'text-right tabular font-medium', render: (p) => money(p.amount) },
          ]} />
        </Card>
      )}
      {tab === 'statement' && (
        <Card title={<span>{t('customers.statement', 'Account statement')} <span className="font-normal text-muted">· {date(from)} – {date(to)}</span></span>} actions={
          <div className="flex gap-2 print:hidden">
            <button className="btn-ghost p-1.5" onClick={() => st.data && downloadCsv(`statement-${c.code}.csv`, st.data.lines)} title={t('common.export')}>CSV</button>
            <button className="btn-ghost p-1.5" onClick={() => window.print()} title={t('common.print')}><Printer className="h-4 w-4" /></button>
          </div>}>
          <div className="flex flex-wrap gap-2 border-b border-line p-3 print:hidden">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} wrapClass="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} wrapClass="w-40" />
          </div>
          {st.data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-canvas/60"><tr>
                  <th className="th">{t('common.date')}</th><th className="th">{t('common.reference')}</th><th className="th">{t('common.description')}</th>
                  <th className="th text-right">{t('customers.charges', 'Charges')}</th><th className="th text-right">{t('customers.paymentsCol', 'Payments')}</th><th className="th text-right">{t('common.balance')}</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  <tr className="bg-canvas/40"><td className="td" colSpan={5}>{t('customers.opening', 'Opening balance')}</td><td className="td text-right tabular font-medium">{money(st.data.opening)}</td></tr>
                  {st.data.lines.map((l, i) => (
                    <tr key={i}><td className="td">{date(l.date)}</td><td className="td">{l.ref}</td><td className="td">{l.description.replace('_', ' ')}</td>
                      <td className="td text-right tabular">{Number(l.debit) ? money(l.debit) : ''}</td><td className="td text-right tabular text-brand-700">{Number(l.credit) ? money(l.credit) : ''}</td>
                      <td className="td text-right tabular">{money(l.balance)}</td></tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold"><td className="td" colSpan={3}>{t('customers.closing', 'Closing balance')}</td>
                    <td className="td text-right tabular">{money(st.data.total_debit)}</td><td className="td text-right tabular">{money(st.data.total_credit)}</td><td className="td text-right tabular">{money(st.data.closing)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {modal === 'edit' && <CustomerForm customer={c} onClose={() => setModal(null)} />}
      {modal === 'pay' && <PaymentModal open customerId={c.id} onClose={() => setModal(null)} />}
    </div>
  )
}
