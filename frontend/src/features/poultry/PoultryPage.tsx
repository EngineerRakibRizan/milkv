import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bird, Egg, Plus } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { num } from '@/lib/format'
import { today } from '@/lib/utils'
import { useCustomers, type Flock } from '@/lib/lookups'
import { Badge, Card, Empty, Input, Modal, PageHeader, Select, Skeleton, Spinner, Stat, Tabs, Textarea } from '@/components/ui'
import { methodOptions } from '@/features/shared/forms'

export default function PoultryPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [species, setSpecies] = useState('')
  const [modal, setModal] = useState<{ kind: 'add' } | { kind: 'record'; flock: Flock } | null>(null)
  const q = useQuery({ queryKey: ['flocks', species], queryFn: () => get<Flock[]>('/flocks', { species }) })
  const flocks = q.data ?? []
  const birds = (s: string) => flocks.filter((f) => f.species === s).reduce((a, f) => a + f.current_count, 0)
  const eggs7 = flocks.reduce((a, f) => a + (f.eggs_7d ?? 0), 0)

  return (
    <>
      <PageHeader title={t('nav.poultry')} actions={can('flocks.create') && <button className="btn-primary" onClick={() => setModal({ kind: 'add' })}><Plus className="h-4 w-4" />{t('poultry.add', 'New flock')}</button>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label={t('dashboard.hens')} value={num(birds('hen'), 0)} icon={<Bird className="h-4 w-4" />} />
        <Stat label={t('dashboard.ducks')} value={num(birds('duck'), 0)} icon={<Bird className="h-4 w-4" />} />
        <Stat label={t('poultry.eggs7', 'Eggs, last 7 days')} value={num(eggs7, 0)} icon={<Egg className="h-4 w-4" />} hint={`${num(eggs7 / 7, 0)} / ${t('poultry.day', 'day')}`} />
      </div>
      <Tabs value={species} onChange={setSpecies} tabs={[{ value: '', label: t('common.all') }, { value: 'hen', label: t('dashboard.hens') }, { value: 'duck', label: t('dashboard.ducks') }]} />
      {q.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>
        : !flocks.length ? <Card><Empty title={t('poultry.empty', 'No flocks yet')} /></Card>
        : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {flocks.map((f) => (
              <div key={f.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between">
                  <Link to={`/poultry/${f.id}`} className="min-w-0">
                    <p className="truncate font-semibold hover:underline">{f.name}</p>
                    <p className="text-xs text-muted">{f.code} · {t(`poultry.${f.species}`, f.species)} · {f.breed ?? '—'}</p>
                  </Link>
                  <Badge status={f.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div><p className="tabular text-lg font-semibold">{num(f.current_count, 0)}</p><p className="text-xs text-muted">{t('poultry.birds', 'Birds')}</p></div>
                  <div><p className="tabular text-lg font-semibold">{num((f.eggs_7d ?? 0) / 7, 0)}</p><p className="text-xs text-muted">{t('poultry.eggsDay', 'Eggs/day')}</p></div>
                  <div><p className={`tabular text-lg font-semibold ${(f.deaths_7d ?? 0) > 0 ? 'text-red-600' : ''}`}>{f.deaths_7d ?? 0}</p><p className="text-xs text-muted">{t('poultry.deaths7', 'Deaths 7d')}</p></div>
                </div>
                <p className="mt-3 text-xs text-muted">{f.age_weeks != null && `${f.age_weeks} ${t('poultry.weeks', 'weeks old')}`}{f.location && ` · ${f.location}`}</p>
                {can('flocks.record') && f.status === 'active' && (
                  <button className="btn-primary mt-3 w-full py-2.5" onClick={() => setModal({ kind: 'record', flock: f })}><Egg className="h-4 w-4" />{t('poultry.daily', 'Daily record')}</button>
                )}
              </div>
            ))}
          </div>
        )}
      {modal?.kind === 'add' && <FlockForm onClose={() => setModal(null)} />}
      {modal?.kind === 'record' && <DailyRecordModal flock={modal.flock} onClose={() => setModal(null)} />}
    </>
  )
}

export function FlockForm({ flock, onClose }: { flock?: Flock; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({
    code: flock?.code ?? '', name: flock?.name ?? '', species: flock?.species ?? 'hen', breed: flock?.breed ?? '', purpose: flock?.purpose ?? 'layer',
    started_at: flock?.started_at ?? today(), initial_count: flock ? String(flock.initial_count) : '', cost: flock && Number(flock.cost) ? flock.cost : '',
    location: flock?.location ?? '', status: flock?.status ?? 'active', notes: flock?.notes ?? '',
  })
  const m = useApiMutation({ method: flock ? 'put' : 'post', url: flock ? `/flocks/${flock.id}` : '/flocks', invalidate: [['flocks']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={flock ? t('common.edit') : t('poultry.add', 'New flock')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('poultry.code', 'Flock ID')} required {...f.bind('code')} placeholder="F-H2" />
        <Input label={t('common.name')} required {...f.bind('name')} />
        <Select label={t('common.type')} {...f.bind('species')} options={[{ value: 'hen', label: t('poultry.hen', 'Hen') }, { value: 'duck', label: t('poultry.duck', 'Duck') }]} />
        <Select label={t('poultry.purpose', 'Purpose')} {...f.bind('purpose')} options={['layer', 'broiler', 'breeder', 'mixed'].map((x) => ({ value: x, label: t(`poultry.p.${x}`, x) }))} />
        <Input label={t('livestock.breed', 'Breed')} {...f.bind('breed')} />
        <Input label={t('poultry.started', 'Hatch / arrival date')} type="date" {...f.bind('started_at')} />
        {!flock && <Input label={t('poultry.initial', 'Number of birds')} type="number" required {...f.bind('initial_count')} />}
        <Input label={t('poultry.cost', 'Purchase / production cost')} type="number" {...f.bind('cost')} />
        <Input label={t('poultry.location', 'Housing')} {...f.bind('location')} />
        {flock && <Select label={t('common.status')} {...f.bind('status')} options={[{ value: 'active', label: t('status.active', 'Active') }, { value: 'closed', label: t('status.closed', 'Closed') }]} />}
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

export function DailyRecordModal({ flock, onClose }: { flock: Flock; onClose: () => void }) {
  const { t } = useTranslation()
  const customers = useCustomers()
  const f = useForm({ date: today(), eggs: '', eggs_broken: '', deaths: '', sick: '', added: '', sold: '', culled: '', eggs_sold: '', egg_price: '', bird_price: '', customer_id: '', paid_method: 'cash', notes: '' })
  const n = (k: keyof typeof f.values) => Number(f.values[k] || 0)
  const closing = flock.current_count + n('added') - n('deaths') - n('sold') - n('culled')
  const m = useApiMutation({ url: `/flocks/${flock.id}/records`, invalidate: [['flocks']], offline: true, label: `Flock ${flock.code}`, success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal size="lg" open onClose={onClose} title={`${flock.name} — ${t('poultry.daily', 'Daily record')}`} footer={<>
      <span className={`mr-auto self-center text-sm ${closing < 0 ? 'text-red-600' : ''}`}>{t('poultry.closing', 'Closing count')}: <b className="tabular">{num(closing, 0)}</b></span>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending || closing < 0} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label={t('common.date')} type="date" wrapClass="col-span-2" {...f.bind('date')} />
        <Input label={t('poultry.eggsCollected', 'Eggs collected')} type="number" inputMode="numeric" {...f.bind('eggs')} />
        <Input label={t('poultry.broken', 'Broken')} type="number" {...f.bind('eggs_broken')} />
        <Input label={t('poultry.deaths', 'Deaths')} type="number" {...f.bind('deaths')} />
        <Input label={t('poultry.sick', 'Sick')} type="number" {...f.bind('sick')} />
        <Input label={t('poultry.added', 'Added')} type="number" {...f.bind('added')} />
        <Input label={t('poultry.culled', 'Culled / other')} type="number" {...f.bind('culled')} />
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('poultry.sales', 'Sales (optional)')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label={t('poultry.eggsSold', 'Eggs sold')} type="number" {...f.bind('eggs_sold')} />
        <Input label={t('poultry.eggPrice', 'Price / egg')} type="number" {...f.bind('egg_price')} />
        <Input label={t('poultry.birdsSold', 'Birds sold')} type="number" {...f.bind('sold')} />
        <Input label={t('poultry.birdPrice', 'Price / bird')} type="number" {...f.bind('bird_price')} />
        <Select label={t('livestock.buyer', 'Buyer')} wrapClass="col-span-2" {...f.bind('customer_id')} placeholder={t('livestock.walkIn', 'Walk-in buyer')} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select label={t('bills.paidNow', 'Paid now')} wrapClass="col-span-2" {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'Not paid yet')} options={methodOptions(t)} />
        <Input label={t('common.notes')} wrapClass="col-span-2 sm:col-span-4" {...f.bind('notes')} />
      </div>
      <p className="mt-3 text-xs text-muted">{t('poultry.hint', 'Opening count')}: {num(flock.current_count, 0)}. {t('poultry.formula', 'Closing = opening + added − deaths − sold − culled.')}</p>
    </Modal>
  )
}
