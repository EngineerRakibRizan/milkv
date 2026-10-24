import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Droplets, Save } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, num } from '@/lib/format'
import { shiftDate, today } from '@/lib/utils'
import { Card, Empty, Input, Modal, PageHeader, Select, Skeleton, Spinner, Stat } from '@/components/ui'

const MiniLine = lazy(() => import('@/features/shared/MiniLine'))

type Row = { animal_id: number; tag: string; name: string | null; morning: string; evening: string; other: string; total: string; notes: string | null; recorded: boolean }
type Sheet = { date: string; rows: Row[]; summary: { produced: string; delivered: string; internal_use: string; spoilage: string; stock: string } }

const shift = shiftDate
const clean = (v: string) => (Number(v) ? String(Number(v)) : '')

export default function MilkPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [day, setDay] = useState(today())
  const [draft, setDraft] = useState<Record<number, { morning: string; evening: string }>>({})
  const [outOpen, setOutOpen] = useState(false)

  const sheet = useQuery({ queryKey: ['milk', 'sheet', day], queryFn: () => get<Sheet>('/milk/sheet', { date: day }) })
  const history = useQuery({
    queryKey: ['milk', 'history', day],
    queryFn: () => get<Array<{ date: string; total: string }>>('/milk/history', { from: shift(day, -29), to: day }),
  })

  // Seed the editable grid from the server whenever the day's sheet (re)loads.
  useEffect(() => {
    if (sheet.data) setDraft(Object.fromEntries(sheet.data.rows.map((r) => [r.animal_id, { morning: clean(r.morning), evening: clean(r.evening) }])))
  }, [sheet.data])

  const total = useMemo(() => Object.values(draft).reduce((s, r) => s + Number(r.morning || 0) + Number(r.evening || 0), 0), [draft])
  const dirty = sheet.data?.rows.some((r) => clean(r.morning) !== (draft[r.animal_id]?.morning ?? '') || clean(r.evening) !== (draft[r.animal_id]?.evening ?? ''))

  const save = useApiMutation<{ date: string; rows: unknown[] }, Sheet>({
    url: '/milk/sheet', offline: true, label: `Milk ${day}`, invalidate: [['milk']],
    success: t('milk.saved', 'Milk record saved'),
    // Show the new totals immediately; the server response replaces them.
    optimistic: { key: ['milk', 'sheet', day], update: (old) => old && { ...(old as Sheet), rows: (old as Sheet).rows.map((r) => ({ ...r, ...draft[r.animal_id], recorded: true })) } },
  })

  const submit = () => sheet.data && save.mutate({
    date: day,
    rows: sheet.data.rows.map((r) => ({ animal_id: r.animal_id, morning: draft[r.animal_id]?.morning || 0, evening: draft[r.animal_id]?.evening || 0, other: r.other })),
  })

  const s = sheet.data?.summary
  const editable = can('milk.record') && day <= today()

  return (
    <>
      <PageHeader title={t('nav.milk')} subtitle={t('milk.subtitle', 'Record each cow’s milking. Totals and stock update automatically.')} actions={
        can('milk.record') && <button className="btn-secondary" onClick={() => setOutOpen(true)}>{t('milk.useOrSpoil', 'Internal use / spoilage')}</button>} />

      <div className="mb-4 flex items-center gap-2">
        <button className="btn-secondary px-2" onClick={() => setDay(shift(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" className="input w-auto" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className="btn-secondary px-2" onClick={() => setDay(shift(day, 1))} disabled={day >= today()} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        {day !== today() && <button className="btn-ghost" onClick={() => setDay(today())}>{t('common.today')}</button>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('milk.produced', 'Produced')} value={`${num(s?.produced, 1)} L`} icon={<Droplets className="h-4 w-4" />} />
        <Stat label={t('milk.delivered', 'Delivered')} value={`${num(s?.delivered, 1)} L`} />
        <Stat label={t('milk.internalSpoil', 'Used / spoiled')} value={`${num(Number(s?.internal_use ?? 0) + Number(s?.spoilage ?? 0), 1)} L`} />
        <Stat label={t('dashboard.milkStock')} value={`${num(s?.stock, 1)} L`} tone="good" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title={`${t('milk.sheet', 'Milking sheet')} — ${date(day)}`} actions={<span className="tabular text-sm font-semibold">{num(total, 1)} L</span>}>
          {sheet.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            : !sheet.data?.rows.length ? <Empty title={t('milk.noCows', 'No lactating cows')} hint={t('milk.noCowsHint', 'Mark cows as lactating in Livestock to see them here.')} />
            : (
              <form noValidate onSubmit={(e) => { e.preventDefault(); submit() }}>
                <div className="grid grid-cols-[1fr_5.5rem_5.5rem_4rem] items-center gap-2 border-b border-line bg-canvas/60 px-4 py-2 text-xs font-medium uppercase text-muted">
                  <span>{t('milk.cow', 'Cow')}</span><span>{t('milk.morning', 'Morning')}</span><span>{t('milk.evening', 'Evening')}</span><span className="text-right">{t('common.total')}</span>
                </div>
                <ul className="divide-y divide-line">
                  {sheet.data.rows.map((r) => {
                    const d = draft[r.animal_id] ?? { morning: '', evening: '' }
                    const rowTotal = Number(d.morning || 0) + Number(d.evening || 0)
                    return (
                      <li key={r.animal_id} className="grid grid-cols-[1fr_5.5rem_5.5rem_4rem] items-center gap-2 px-4 py-2">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{r.name ?? r.tag}</p><p className="text-xs text-muted">{r.tag}</p></div>
                        {(['morning', 'evening'] as const).map((k) => (
                          <input key={k} type="number" inputMode="decimal" step="any" min="0" disabled={!editable} placeholder="0"
                            className="input px-2 py-2.5 text-center text-base tabular" value={d[k]} aria-label={`${r.tag} ${k}`}
                            onChange={(e) => setDraft({ ...draft, [r.animal_id]: { ...d, [k]: e.target.value } })} />
                        ))}
                        <span className="tabular text-right text-sm font-semibold">{rowTotal ? num(rowTotal, 1) : '—'}</span>
                      </li>
                    )
                  })}
                </ul>
                {editable && (
                  <div className="sticky bottom-16 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 lg:bottom-0">
                    <span className="text-sm text-muted">{dirty ? t('milk.unsaved', 'Unsaved changes') : t('milk.allSaved', 'All saved')}</span>
                    <button className="btn-primary px-5 py-2.5" disabled={save.isPending || !dirty}>{save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}{t('common.save')}</button>
                  </div>
                )}
              </form>
            )}
        </Card>
        <Card className="lg:col-span-2" title={t('milk.last30', 'Last 30 days')}>
          {history.data?.length ? (
            <Suspense fallback={<Skeleton className="m-4 h-56" />}>
              <MiniLine data={history.data.map((h) => ({ x: h.date.slice(5), y: Number(h.total) }))} unit="L" height={280} />
            </Suspense>
          ) : <Empty />}
        </Card>
      </div>
      {outOpen && <MilkOutModal day={day} onClose={() => setOutOpen(false)} />}
    </>
  )
}

function MilkOutModal({ day, onClose }: { day: string; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ date: day, type: 'internal_use', quantity: '', notes: '' })
  const m = useApiMutation({ url: '/milk/out', invalidate: [['milk']], offline: true, success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={t('milk.useOrSpoil', 'Internal use / spoilage')} size="sm" footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="space-y-3">
        <Select label={t('common.type')} {...f.bind('type')} options={[{ value: 'internal_use', label: t('milk.internal', 'Household / calves') }, { value: 'spoilage', label: t('milk.spoilage', 'Spoiled / rejected') }]} />
        <Input label={`${t('common.quantity')} (L)`} type="number" required {...f.bind('quantity')} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Input label={t('common.notes')} {...f.bind('notes')} />
      </div>
    </Modal>
  )
}
