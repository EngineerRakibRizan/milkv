import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Syringe, Trash2 } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money } from '@/lib/format'
import { today } from '@/lib/utils'
import { animalLabel, useAnimals, useFlocks } from '@/lib/lookups'
import { Badge, Card, DataTable, Empty, Input, Modal, PageHeader, Pagination, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'

export type Medication = { name: string; dosage?: string; frequency?: string; duration?: string }
export type Treatment = { id: number; date: string; animal_id: number | null; flock_id: number | null; subject: string | null; symptoms: string | null; diagnosis: string | null
  vet_name: string | null; vet_contact: string | null; medications: Medication[]; cost: string; follow_up_date: string | null; outcome: string; notes: string | null }
export type Vaccination = { id: number; date: string; animal_id: number | null; flock_id: number | null; subject: string | null; vaccine: string; next_due_date: string | null
  dose: string | null; vet_name: string | null; cost: string; notes: string | null }

export default function VetPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'treatments' | 'vaccinations' | 'upcoming'>('treatments')
  const [outcome, setOutcome] = useState('')
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<Treatment | Vaccination | null>(null)
  const modal = params.get('new')
  const close = () => { setParams({}); setEdit(null) }

  const tq = useQuery({ queryKey: ['vet', 'treatments', outcome, page], queryFn: () => get<Paginated<Treatment>>('/treatments', { outcome, page }), enabled: tab === 'treatments', placeholderData: keepPreviousData })
  const vq = useQuery({ queryKey: ['vet', 'vaccinations', tab, page], queryFn: () => get<Paginated<Vaccination>>('/vaccinations', { page, upcoming: tab === 'upcoming' ? 1 : undefined }),
    enabled: tab !== 'treatments', placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title={t('nav.vet')} subtitle={t('vet.subtitle', 'Treatment and vaccination records. FarmOS stores what your veterinarian prescribes; it does not diagnose.')} actions={can('vet.create') && <>
        <button className="btn-secondary" onClick={() => setParams({ new: 'vaccination' })}><Syringe className="h-4 w-4" />{t('vet.addVaccination', 'Vaccination')}</button>
        <button className="btn-primary" onClick={() => setParams({ new: 'treatment' })}><Plus className="h-4 w-4" />{t('vet.addTreatment', 'Treatment')}</button>
      </>} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1) }} tabs={[
        { value: 'treatments', label: t('vet.treatments', 'Treatments') }, { value: 'vaccinations', label: t('vet.vaccinations', 'Vaccinations') }, { value: 'upcoming', label: t('vet.upcoming', 'Upcoming') }]} />
      {tab === 'treatments' ? (
        <Card>
          <div className="border-b border-line p-3">
            <Select wrapClass="w-44" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={t('vet.allOutcomes', 'All outcomes')}
              options={['ongoing', 'recovered', 'referred', 'died'].map((o) => ({ value: o, label: t(`status.${o}`, o) }))} />
          </div>
          <DataTable rows={tq.data?.data} rowKey={(r) => r.id} loading={tq.isLoading} onRowClick={can('vet.update') ? setEdit : undefined} empty={<Empty title={t('vet.empty', 'No treatments recorded')} />} columns={[
            { key: 'd', header: t('common.date'), render: (r) => date(r.date) },
            { key: 's', header: t('vet.subject', 'Animal / flock'), mobile: 'title', render: (r) => <span className="font-medium">{r.subject}</span> },
            { key: 'x', header: t('vet.diagnosis', 'Diagnosis'), mobile: 'subtitle', render: (r) => r.diagnosis ?? r.symptoms ?? '—' },
            { key: 'v', header: t('vet.vet', 'Veterinarian'), render: (r) => r.vet_name ?? '—' },
            { key: 'f', header: t('vet.followUp', 'Follow-up'), render: (r) => r.follow_up_date ? date(r.follow_up_date) : '—' },
            { key: 'o', header: t('vet.outcome', 'Outcome'), mobile: 'meta', render: (r) => <Badge status={r.outcome} /> },
            { key: 'c', header: t('common.cost'), className: 'text-right tabular', render: (r) => money(r.cost) },
          ]} />
          <Pagination meta={tq.data?.meta} onPage={setPage} />
        </Card>
      ) : (
        <Card>
          <DataTable rows={vq.data?.data} rowKey={(r) => r.id} loading={vq.isLoading} onRowClick={can('vet.update') ? setEdit : undefined} columns={[
            { key: 'd', header: t('common.date'), render: (r) => date(r.date) },
            { key: 's', header: t('vet.subject', 'Animal / flock'), mobile: 'title', render: (r) => <span className="font-medium">{r.subject}</span> },
            { key: 'v', header: t('vet.vaccine', 'Vaccine'), mobile: 'subtitle', render: (r) => `${r.vaccine}${r.dose ? ` · ${r.dose}` : ''}` },
            { key: 'n', header: t('vet.next', 'Next due'), mobile: 'meta', render: (r) => r.next_due_date ? <Badge tone={r.next_due_date <= today() ? 'red' : 'blue'}>{date(r.next_due_date)}</Badge> : '—' },
            { key: 'c', header: t('common.cost'), className: 'text-right tabular', render: (r) => money(r.cost) },
          ]} />
          <Pagination meta={vq.data?.meta} onPage={setPage} />
        </Card>
      )}
      {(modal === 'treatment' || (edit && 'outcome' in edit)) && <TreatmentForm record={edit as Treatment | null} onClose={close} />}
      {(modal === 'vaccination' || (edit && 'vaccine' in edit)) && <VaccinationForm record={edit as Vaccination | null} onClose={close} />}
    </>
  )
}

function SubjectSelect({ f }: { f: ReturnType<typeof useForm<{ subject: string } & Record<string, unknown>>> }) {
  const { t } = useTranslation()
  const animals = useAnimals({ status: 'active' })
  const flocks = useFlocks()
  return <Select label={t('vet.subject', 'Animal / flock')} required {...f.bind('subject')} placeholder="—" options={[
    ...(animals.data ?? []).map((a) => ({ value: `animal:${a.id}`, label: `🐄 ${animalLabel(a)}` })),
    ...(flocks.data ?? []).map((fl) => ({ value: `flock:${fl.id}`, label: `🐔 ${fl.name}` })),
  ]} />
}

const subjectPayload = (s: string) => {
  const [type, id] = s.split(':')
  return type === 'animal' ? { animal_id: id } : type === 'flock' ? { flock_id: id } : {}
}

function TreatmentForm({ record, onClose }: { record: Treatment | null; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({
    subject: record ? (record.animal_id ? `animal:${record.animal_id}` : `flock:${record.flock_id}`) : '', date: record?.date ?? today(), symptoms: record?.symptoms ?? '',
    diagnosis: record?.diagnosis ?? '', vet_name: record?.vet_name ?? '', vet_contact: record?.vet_contact ?? '', cost: record && Number(record.cost) ? record.cost : '',
    follow_up_date: record?.follow_up_date ?? '', outcome: record?.outcome ?? 'ongoing', notes: record?.notes ?? '', paid_method: 'cash',
    medications: (record?.medications.length ? record.medications : [{ name: '', dosage: '', frequency: '', duration: '' }]) as Medication[],
  })
  const m = useApiMutation({ method: record ? 'put' : 'post', url: record ? `/treatments/${record.id}` : '/treatments', invalidate: [['vet'], ['animals'], ['bills']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const meds = f.values.medications
  const submit = () => {
    const { subject, medications, paid_method, ...rest } = f.payload() as typeof f.values
    m.mutate({ ...rest, ...subjectPayload(subject ?? ''), medications: medications?.filter((x) => x.name.trim()), paid_method: record ? undefined : paid_method || undefined },
      { onError: (e) => f.setErrors({ ...e.errors, subject: e.errors.animal_id ?? e.errors.flock_id }) })
  }
  return (
    <Modal size="lg" open onClose={onClose} title={record ? t('vet.editTreatment', 'Edit treatment') : t('vet.addTreatment', 'New treatment')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={submit}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SubjectSelect f={f as never} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Textarea label={t('vet.symptoms', 'Symptoms')} {...f.bind('symptoms')} />
        <Input label={t('vet.diagnosis', 'Diagnosis (by vet)')} {...f.bind('diagnosis')} />
        <Input label={t('vet.vet', 'Veterinarian')} {...f.bind('vet_name')} />
        <Input label={t('vet.contact', 'Clinic / phone')} {...f.bind('vet_contact')} />
      </div>
      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t('vet.prescribed', 'Medication as prescribed')}</p>
      <div className="space-y-2">
        {meds.map((md, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            {(['name', 'dosage', 'frequency', 'duration'] as const).map((k) => (
              <input key={k} className="input" placeholder={t(`vet.med.${k}`, k)} value={md[k] ?? ''}
                onChange={(e) => f.set('medications', meds.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
            <button className="btn-ghost p-2" onClick={() => f.set('medications', meds.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="btn-ghost text-brand-700" onClick={() => f.set('medications', [...meds, { name: '' }])}><Plus className="h-4 w-4" />{t('vet.addMed', 'Add medication')}</button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label={t('vet.cost', 'Treatment cost')} type="number" {...f.bind('cost')} />
        {!record && <Select label={t('bills.paidNow', 'Paid now')} {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'Not paid yet')} options={methodOptions(t)} />}
        <Input label={t('vet.followUp', 'Follow-up date')} type="date" {...f.bind('follow_up_date')} />
        <Select label={t('vet.outcome', 'Outcome')} {...f.bind('outcome')} options={['ongoing', 'recovered', 'referred', 'died'].map((o) => ({ value: o, label: t(`status.${o}`, o) }))} />
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-3" {...f.bind('notes')} />
      </div>
      <p className="mt-2 text-xs text-muted">{t('vet.costHint', 'A cost creates one linked veterinary expense. Changing it later updates that expense; it is never counted twice.')}</p>
    </Modal>
  )
}

function VaccinationForm({ record, onClose }: { record: Vaccination | null; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({
    subject: record ? (record.animal_id ? `animal:${record.animal_id}` : `flock:${record.flock_id}`) : '', vaccine: record?.vaccine ?? '', date: record?.date ?? today(),
    next_due_date: record?.next_due_date ?? '', dose: record?.dose ?? '', vet_name: record?.vet_name ?? '', cost: record && Number(record.cost) ? record.cost : '', notes: record?.notes ?? '', paid_method: 'cash',
  })
  const m = useApiMutation({ method: record ? 'put' : 'post', url: record ? `/vaccinations/${record.id}` : '/vaccinations', invalidate: [['vet'], ['bills']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const submit = () => {
    const { subject, paid_method, ...rest } = f.payload() as typeof f.values
    m.mutate({ ...rest, ...subjectPayload(subject ?? ''), paid_method: record ? undefined : paid_method || undefined }, { onError: (e) => f.setErrors({ ...e.errors, subject: e.errors.animal_id ?? e.errors.flock_id }) })
  }
  return (
    <Modal open onClose={onClose} title={record ? t('vet.editVaccination', 'Edit vaccination') : t('vet.addVaccination', 'New vaccination')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={submit}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SubjectSelect f={f as never} />
        <Input label={t('vet.vaccine', 'Vaccine')} required list="vaccines" {...f.bind('vaccine')} />
        <datalist id="vaccines">{['FMD', 'Anthrax', 'HS (Haemorrhagic Septicaemia)', 'Black Quarter', 'LSD', 'Newcastle (ND)', 'Gumboro (IBD)', 'Fowl Pox', 'Duck Plague', 'Duck Cholera'].map((v) => <option key={v} value={v} />)}</datalist>
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Input label={t('vet.next', 'Next due')} type="date" {...f.bind('next_due_date')} />
        <Input label={t('vet.dose', 'Dose')} {...f.bind('dose')} />
        <Input label={t('vet.vet', 'Veterinarian')} {...f.bind('vet_name')} />
        <Input label={t('common.cost')} type="number" {...f.bind('cost')} />
        {!record && <Select label={t('bills.paidNow', 'Paid now')} {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'Not paid yet')} options={methodOptions(t)} />}
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}
