import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money } from '@/lib/format'
import { today } from '@/lib/utils'
import type { Employee } from '@/lib/lookups'
import { Badge, Card, DataTable, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'

export default function EmployeesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [status, setStatus] = useState('active')
  const [modal, setModal] = useState<'new' | Employee | null>(null)
  const q = useQuery({ queryKey: ['employees', status], queryFn: () => get<Employee[]>('/employees', { status }) })
  return (
    <>
      <PageHeader title={t('nav.employees')} actions={can('employees.create') && <button className="btn-primary" onClick={() => setModal('new')}><Plus className="h-4 w-4" />{t('employees.add', 'Add employee')}</button>} />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'active', label: t('status.active', 'Active') }, { value: 'inactive', label: t('status.inactive', 'Inactive') }]} />
      <Card>
        <DataTable rows={q.data} rowKey={(e) => e.id} loading={q.isLoading} onRowClick={setModal} columns={[
          { key: 'n', header: t('common.name'), mobile: 'title', render: (e) => <span className="font-medium">{e.name} <span className="text-xs font-normal text-muted">{e.code}</span></span> },
          { key: 't', header: t('employees.title', 'Job title'), mobile: 'subtitle', render: (e) => e.title ?? '—' },
          { key: 'p', header: t('common.phone'), render: (e) => e.phone ?? '—' },
          { key: 'r', header: t('employees.route', 'Route'), render: (e) => e.route ?? '—' },
          { key: 's', header: t('employees.salary', 'Monthly salary'), mobile: 'meta', className: 'text-right tabular', render: (e) => money(e.salary) },
        ]} />
      </Card>
      {modal === 'new' && <EmployeeForm onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && <EmployeeDetail employee={modal} onClose={() => setModal(null)} />}
    </>
  )
}

function EmployeeForm({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ name: employee?.name ?? '', phone: employee?.phone ?? '', title: employee?.title ?? '', salary: employee?.salary ?? '', joined_at: employee?.joined_at ?? today(),
    status: employee?.status ?? 'active', address: employee?.address ?? '', emergency_contact: employee?.emergency_contact ?? '', route: employee?.route ?? '', notes: employee?.notes ?? '' })
  const m = useApiMutation({ method: employee ? 'put' : 'post', url: employee ? `/employees/${employee.id}` : '/employees', invalidate: [['employees']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={employee ? t('common.edit') : t('employees.add', 'Add employee')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('common.name')} required {...f.bind('name')} />
        <Input label={t('common.phone')} type="tel" {...f.bind('phone')} />
        <Input label={t('employees.title', 'Job title')} {...f.bind('title')} />
        <Input label={t('employees.salary', 'Monthly salary')} type="number" {...f.bind('salary')} />
        <Input label={t('employees.joined', 'Joining date')} type="date" {...f.bind('joined_at')} />
        <Select label={t('common.status')} {...f.bind('status')} options={['active', 'inactive'].map((s) => ({ value: s, label: t(`status.${s}`, s) }))} />
        <Input label={t('employees.route', 'Delivery route / duty')} {...f.bind('route')} />
        <Input label={t('employees.emergency', 'Emergency contact')} {...f.bind('emergency_contact')} />
        <Input label={t('customers.address', 'Address')} wrapClass="sm:col-span-2" {...f.bind('address')} />
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

type Detail = { employee: Employee; outstanding_advance: string; payments: Array<{ id: number; type: string; period: string | null; date: string; gross: string; deduction: string; net: string; method: string }> }

function EmployeeDetail({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ['employees', 'one', employee.id], queryFn: () => get<Detail>(`/employees/${employee.id}`) })
  const f = useForm({ type: 'salary', period: today().slice(0, 7), date: today(), gross: employee.salary, deduction: '', method: 'cash', notes: '' })
  const pay = useApiMutation({ url: `/employees/${employee.id}/salary`, invalidate: [['employees']], success: t('employees.paid', 'Payment recorded'), onSuccess: onClose })
  if (editing) return <EmployeeForm employee={employee} onClose={onClose} />
  return (
    <Modal size="lg" open onClose={onClose} title={employee.name} footer={<>
      {can('employees.update') && <button className="btn-secondary mr-auto" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      {can('salaries.create') && <button className="btn-primary" disabled={pay.isPending} onClick={() => pay.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{pay.isPending && <Spinner />}{t('employees.pay', 'Record payment')}</button>}</>}>
      <p className="text-sm text-muted">{employee.title} · {employee.phone} · {t('employees.salary', 'Salary')} {money(employee.salary)}</p>
      {q.data && Number(q.data.outstanding_advance) > 0 && <p className="mt-1 text-sm text-amber-600">{t('employees.advance', 'Outstanding advance')}: {money(q.data.outstanding_advance)}</p>}
      {can('salaries.create') && (
        <div className="mt-3 grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-3">
          <Select label={t('common.type')} {...f.bind('type')} options={['salary', 'advance', 'bonus'].map((x) => ({ value: x, label: t(`employees.t.${x}`, x) }))} />
          <Input label={t('employees.period', 'Month')} type="month" {...f.bind('period')} />
          <Input label={t('common.date')} type="date" {...f.bind('date')} />
          <Input label={t('employees.gross', 'Amount')} type="number" {...f.bind('gross')} />
          {f.values.type === 'salary' && <Input label={t('employees.deduction', 'Advance recovered')} type="number" {...f.bind('deduction')} />}
          <Select label={t('common.method')} {...f.bind('method')} options={methodOptions(t)} />
        </div>
      )}
      <p className="mb-1 mt-4 text-xs font-semibold uppercase text-muted">{t('employees.history', 'Payment history')}</p>
      <ul className="divide-y divide-line text-sm">{(q.data?.payments ?? []).map((p) => (
        <li key={p.id} className="flex justify-between py-2"><span>{date(p.date)} · <Badge tone={p.type === 'advance' ? 'amber' : 'green'}>{t(`employees.t.${p.type}`, p.type)}</Badge> {p.period}</span>
          <span className="tabular">{money(p.net)}{Number(p.deduction) > 0 && <span className="text-xs text-muted"> (−{money(p.deduction)})</span>}</span></li>))}
      </ul>
    </Modal>
  )
}
