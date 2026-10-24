import { useTranslation } from 'react-i18next'
import { Input, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { useForm } from '@/hooks/useForm'
import { useApiMutation } from '@/hooks/useApiMutation'
import { animalLabel, useAnimals, useSuppliers, type Animal } from '@/lib/lookups'
import { methodOptions } from '@/features/shared/forms'

export function AnimalForm({ open, onClose, animal, onSaved }: { open: boolean; onClose: () => void; animal?: Animal; onSaved?: (a: Animal) => void }) {
  const { t } = useTranslation()
  const mothers = useAnimals({ gender: 'female', status: 'all' })
  const suppliers = useSuppliers()
  const f = useForm({
    tag: animal?.tag ?? '', name: animal?.name ?? '', type: animal?.type ?? 'cow', breed: animal?.breed ?? '', gender: animal?.gender ?? 'female',
    birth_date: animal?.birth_date ?? '', acquired_at: animal?.acquired_at ?? '', acquisition: animal?.acquisition ?? 'born',
    purchase_price: animal && Number(animal.purchase_price) ? animal.purchase_price : '', current_value: animal && Number(animal.current_value) ? animal.current_value : '',
    color: animal?.color ?? '', mother_id: animal?.mother_id ? String(animal.mother_id) : '', father_info: animal?.father_info ?? '',
    reproductive_status: animal?.reproductive_status ?? '', lactation_status: animal?.lactation_status ?? '', health_status: animal?.health_status ?? 'healthy',
    feed_group: animal?.feed_group ?? '', weight: animal?.weight ?? '', notes: animal?.notes ?? '', supplier_id: '', paid_method: '',
  })
  const m = useApiMutation<Record<string, unknown>, Animal>({
    method: animal ? 'put' : 'post', url: animal ? `/animals/${animal.id}` : '/animals', invalidate: [['animals']],
    success: t('common.saved', 'Saved'), onSuccess: (a) => { onSaved?.(a); onClose() },
  })
  const v = f.values
  const purchased = v.acquisition === 'purchased'

  return (
    <Modal size="lg" open={open} onClose={onClose} title={animal ? `${t('common.edit')} ${animal.tag}` : t('livestock.add', 'Register animal')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t('livestock.tag', 'Tag / ID')} required {...f.bind('tag')} />
        <Input label={t('common.name')} {...f.bind('name')} />
        <Select label={t('common.type')} {...f.bind('type')} options={['cow', 'heifer', 'bull', 'calf'].map((x) => ({ value: x, label: t(`animal.${x}`, x) }))} />
        <Select label={t('livestock.gender', 'Gender')} {...f.bind('gender')} options={[{ value: 'female', label: t('animal.female', 'Female') }, { value: 'male', label: t('animal.male', 'Male') }]} />
        <Input label={t('livestock.breed', 'Breed')} {...f.bind('breed')} list="breeds" />
        <datalist id="breeds">{['Holstein Friesian cross', 'Sahiwal', 'Sahiwal cross', 'Jersey cross', 'Red Chittagong', 'Pabna', 'Local (Deshi)'].map((b) => <option key={b} value={b} />)}</datalist>
        <Input label={t('livestock.color', 'Colour / marks')} {...f.bind('color')} />
        <Input label={t('livestock.birth', 'Date of birth')} type="date" {...f.bind('birth_date')} />
        {!animal && <Select label={t('livestock.acquisition', 'Acquired by')} {...f.bind('acquisition')} options={[
          { value: 'born', label: t('animal.born', 'Born on farm') }, { value: 'purchased', label: t('animal.purchased', 'Purchased') }, { value: 'gift', label: t('animal.gift', 'Gift / other') }]} />}
        <Input label={t('livestock.acquiredAt', 'Acquisition date')} type="date" {...f.bind('acquired_at')} />
        {(purchased || animal) && <Input label={t('livestock.purchasePrice', 'Purchase price')} type="number" {...f.bind('purchase_price')} disabled={!!animal} />}
        {purchased && !animal && <>
          <Select label={t('nav.suppliers')} {...f.bind('supplier_id')} placeholder="—" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <Select label={t('bills.paidNow', 'Paid now')} {...f.bind('paid_method')} placeholder={t('bills.notPaid', 'Not paid yet')} options={methodOptions(t)} />
        </>}
        <Input label={t('livestock.value', 'Current value')} type="number" {...f.bind('current_value')} />
        <Select label={t('livestock.mother', 'Mother')} {...f.bind('mother_id')} placeholder="—"
          options={(mothers.data ?? []).filter((a) => a.id !== animal?.id).map((a) => ({ value: a.id, label: animalLabel(a) }))} />
        <Input label={t('livestock.father', 'Sire / semen info')} {...f.bind('father_info')} />
        {v.gender === 'female' && <>
          <Select label={t('livestock.lactation', 'Lactation')} {...f.bind('lactation_status')} placeholder="—" options={[{ value: 'lactating', label: t('status.lactating', 'Lactating') }, { value: 'dry', label: t('status.dry', 'Dry') }]} />
          <Select label={t('livestock.reproduction', 'Reproduction')} {...f.bind('reproductive_status')} placeholder="—" options={['open', 'inseminated', 'pregnant'].map((x) => ({ value: x, label: t(`status.${x}`, x) }))} />
        </>}
        <Select label={t('livestock.health', 'Health')} {...f.bind('health_status')} options={['healthy', 'sick', 'under_treatment'].map((x) => ({ value: x, label: t(`status.${x}`, x.replace('_', ' ')) }))} />
        <Input label={t('livestock.feedGroup', 'Feed group')} {...f.bind('feed_group')} />
        {!animal && <Input label={t('livestock.weight', 'Weight (kg)')} type="number" {...f.bind('weight')} />}
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-3" {...f.bind('notes')} />
      </div>
      {purchased && !animal && <p className="mt-3 text-xs text-muted">{t('livestock.capitalHint', 'The purchase is recorded as a livestock asset, not an operating expense.')}</p>}
    </Modal>
  )
}
