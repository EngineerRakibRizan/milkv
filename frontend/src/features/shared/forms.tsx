import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Input, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { useForm } from '@/hooks/useForm'
import { useApiMutation } from '@/hooks/useApiMutation'
import { PAYMENT_METHODS, animalLabel, useAccounts, useAnimals, useCustomers, useFeedItems, useFlocks, useSuppliers } from '@/lib/lookups'
import { money } from '@/lib/format'
import { today } from '@/lib/utils'

const methodOptions = (t: (k: string, d: string) => string) => PAYMENT_METHODS.map((m) => ({ value: m, label: t(`method.${m}`, m.toUpperCase() === 'BKASH' ? 'bKash' : m[0].toUpperCase() + m.slice(1)) }))

/* ---------------- Customer payment ---------------- */

export function PaymentModal({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId?: number }) {
  const { t } = useTranslation()
  const customers = useCustomers()
  const f = useForm({ customer_id: customerId ? String(customerId) : '', date: today(), amount: '', method: 'cash', reference: '', notes: '' })
  const selected = customers.data?.find((c) => String(c.id) === String(f.values.customer_id))
  const m = useApiMutation({
    url: '/payments', invalidate: [['customers'], ['payments'], ['invoices']], success: t('payments.saved', 'Payment recorded'),
    onSuccess: () => { f.reset(); onClose() },
  })
  return (
    <Modal open={open} onClose={onClose} title={t('payments.new', 'Record customer payment')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>
        {m.isPending && <Spinner />}{t('common.save')}
      </button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('nav.customers')} wrapClass="sm:col-span-2" required {...f.bind('customer_id')} placeholder="—"
          options={(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.name}${Number(c.balance) ? ` — ${money(c.balance)}` : ''}` }))} />
        {selected && (
          <p className="text-sm text-muted sm:col-span-2">
            {Number(selected.balance) >= 0 ? t('payments.owes', 'Currently owes') : t('payments.credit', 'Credit balance')}: <b className="text-ink">{money(Math.abs(Number(selected.balance)))}</b>
            {Number(selected.balance) > 0 && <button type="button" className="ml-2 text-brand-700 underline" onClick={() => f.set('amount', selected.balance)}>{t('payments.payAll', 'Pay full')}</button>}
          </p>
        )}
        <Input label={t('common.amount')} type="number" min="0" required {...f.bind('amount')} />
        <Input label={t('common.date')} type="date" required {...f.bind('date')} />
        <Select label={t('common.method')} {...f.bind('method')} options={methodOptions(t)} />
        <Input label={t('common.reference')} placeholder="TrxID / cheque no." {...f.bind('reference')} />
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
      <p className="mt-3 text-xs text-muted">{t('payments.hint', 'Payments settle the oldest unpaid invoices first. Any extra is kept as an advance for future deliveries.')}</p>
    </Modal>
  )
}

/* ---------------- Expense / purchase bill ---------------- */

type Line = { feed_item_id: string; description: string; quantity: string; unit_price: string }
const emptyLine: Line = { feed_item_id: '', description: '', quantity: '1', unit_price: '' }

export function BillModal({ open, onClose, kind: initialKind = 'expense' }: { open: boolean; onClose: () => void; kind?: 'expense' | 'purchase' | 'asset' }) {
  const { t } = useTranslation()
  const accounts = useAccounts()
  const suppliers = useSuppliers()
  const items = useFeedItems()
  const f = useForm({
    kind: initialKind as string, category: '', supplier_id: '', date: today(), due_date: '', description: '', discount: '', extra_cost: '',
    paid: true, method: 'cash', notes: '', lines: [{ ...emptyLine }] as Line[],
  })
  const kind = f.values.kind
  const lines = f.values.lines
  const setLine = (i: number, patch: Partial<Line>) => f.set('lines', lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0)
  const total = subtotal - Number(f.values.discount || 0) + Number(f.values.extra_cost || 0)
  const categories = useMemo(() => (accounts.data ?? []).filter((a) => kind === 'asset'
    ? ['livestock_assets', 'equipment_assets'].includes(a.key) : a.type === 'expense' && !['feed_expense', 'inventory_loss'].includes(a.key)), [accounts.data, kind])

  const m = useApiMutation({
    url: '/bills', invalidate: [['bills'], ['inventory'], ['suppliers']], success: t('bills.saved', 'Saved'),
    onSuccess: () => { f.reset(); onClose() },
  })
  const submit = () => {
    const v = f.values
    m.mutate({
      kind: v.kind, category: v.kind === 'purchase' ? undefined : v.category, supplier_id: v.supplier_id || undefined, date: v.date,
      due_date: v.due_date || undefined, description: v.description || undefined, discount: v.discount || undefined, extra_cost: v.extra_cost || undefined,
      paid: v.paid, method: v.paid ? v.method : undefined, notes: v.notes || undefined,
      items: v.lines.map((l) => ({ feed_item_id: v.kind === 'purchase' ? l.feed_item_id : undefined, description: l.description || undefined, quantity: l.quantity, unit_price: l.unit_price })),
    }, { onError: (e) => f.setErrors(e.errors) })
  }

  return (
    <Modal size="lg" open={open} onClose={onClose} title={kind === 'purchase' ? t('bills.newPurchase', 'Feed / stock purchase') : t('bills.newExpense', 'Add expense')} footer={<>
      <span className="mr-auto self-center text-sm">{t('common.total')}: <b className="tabular">{money(total)}</b></span>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={submit}>{m.isPending && <Spinner />}{t('common.save')}</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label={t('common.type')} {...f.bind('kind')} options={[
          { value: 'expense', label: t('bills.kind.expense', 'Operating expense') }, { value: 'purchase', label: t('bills.kind.purchase', 'Stock purchase (feed, medicine)') },
          { value: 'asset', label: t('bills.kind.asset', 'Asset (equipment, building)') }]} />
        {kind !== 'purchase' && <Select label={t('common.category')} required {...f.bind('category')} placeholder="—" options={categories.map((a) => ({ value: a.key, label: a.name }))} />}
        <Select label={t('nav.suppliers')} {...f.bind('supplier_id')} placeholder={t('bills.noSupplier', '— none —')} options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Input label={t('common.date')} type="date" required {...f.bind('date')} />
        <Input label={t('common.description')} wrapClass="sm:col-span-2" {...f.bind('description')} />
      </div>

      <div className="mt-4 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            {kind === 'purchase'
              ? <Select wrapClass="col-span-12 sm:col-span-5" label={i === 0 ? t('inventory.item', 'Item') : undefined} value={l.feed_item_id} placeholder="—"
                  onChange={(e) => setLine(i, { feed_item_id: e.target.value })} error={f.errors[`items.${i}.feed_item_id`]}
                  options={(items.data ?? []).map((it) => ({ value: it.id, label: `${it.name} (${it.unit})` }))} />
              : <Input wrapClass="col-span-12 sm:col-span-5" label={i === 0 ? t('common.description') : undefined} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />}
            <Input wrapClass="col-span-4 sm:col-span-2" label={i === 0 ? t('common.quantity') : undefined} type="number" value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })} error={f.errors[`items.${i}.quantity`]} />
            <Input wrapClass="col-span-5 sm:col-span-3" label={i === 0 ? t('bills.unitPrice', 'Unit price') : undefined} type="number" value={l.unit_price}
              onChange={(e) => setLine(i, { unit_price: e.target.value })} error={f.errors[`items.${i}.unit_price`]} />
            <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-2">
              <span className="tabular truncate text-sm">{money(Number(l.quantity || 0) * Number(l.unit_price || 0))}</span>
              {lines.length > 1 && <button className="btn-ghost p-1" onClick={() => f.set('lines', lines.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
        ))}
        <button className="btn-ghost text-brand-700" onClick={() => f.set('lines', [...lines, { ...emptyLine }])}><Plus className="h-4 w-4" />{t('bills.addLine', 'Add line')}</button>
        {f.errors.items && <p className="text-xs text-red-600">{f.errors.items[0]}</p>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label={t('bills.discount', 'Discount')} type="number" {...f.bind('discount')} />
        <Input label={t('bills.extra', 'Transport / extra cost')} type="number" {...f.bind('extra_cost')} />
        <Input label={t('bills.due', 'Due date')} type="date" {...f.bind('due_date')} />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-canvas p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={!!f.values.paid} onChange={(e) => f.set('paid', e.target.checked)} className="h-4 w-4 accent-brand-700" />
          {t('bills.paidNow', 'Paid now')}
        </label>
        {f.values.paid && <Select wrapClass="w-40" {...f.bind('method')} options={methodOptions(t)} />}
        {!f.values.paid && <p className="text-xs text-muted">{t('bills.unpaidHint', 'Recorded as payable to the supplier. Pay it later from Expenses.')}</p>}
      </div>
    </Modal>
  )
}

/* ---------------- Feed consumption ---------------- */

export function FeedIssueModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: { target_type: 'animal' | 'flock'; target_id: number } }) {
  const { t } = useTranslation()
  const items = useFeedItems()
  const animals = useAnimals({ status: 'active' })
  const flocks = useFlocks()
  const f = useForm({ date: today(), type: 'consumption', feed_item_id: '', quantity: '', target: preset ? `${preset.target_type}:${preset.target_id}` : '', notes: '' })
  const item = items.data?.find((i) => String(i.id) === f.values.feed_item_id)
  const m = useApiMutation({
    url: '/inventory-issues', invalidate: [['inventory']], offline: true, label: 'Feed consumption', success: t('inventory.issued', 'Stock updated'),
    onSuccess: () => { f.reset(); onClose() },
  })
  const submit = () => {
    const [target_type, target_id] = f.values.target ? f.values.target.split(':') : [undefined, undefined]
    m.mutate({ date: f.values.date, type: f.values.type, lines: [{ feed_item_id: f.values.feed_item_id, quantity: f.values.quantity, target_type, target_id, notes: f.values.notes || undefined }] },
      { onError: (e) => f.setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k.replace('lines.0.', ''), v]))) })
  }
  return (
    <Modal open={open} onClose={onClose} title={t('inventory.issueTitle', 'Record feed use')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={submit}>{m.isPending && <Spinner />}{t('common.save')}</button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('common.type')} {...f.bind('type')} options={[
          { value: 'consumption', label: t('inventory.consumption', 'Consumption') }, { value: 'wastage', label: t('inventory.wastage', 'Wastage') },
          { value: 'spoilage', label: t('inventory.spoilage', 'Spoilage') }]} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Select label={t('inventory.item', 'Item')} wrapClass="sm:col-span-2" required {...f.bind('feed_item_id')} placeholder="—"
          options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.name} — ${i.stock} ${i.unit}` }))} />
        <Input label={`${t('common.quantity')}${item ? ` (${item.unit})` : ''}`} type="number" required {...f.bind('quantity')} hint={item ? `${t('inventory.inStock', 'In stock')}: ${item.stock} ${item.unit}` : undefined} />
        {f.values.type === 'consumption' && (
          <Select label={t('inventory.fedTo', 'Fed to (optional)')} {...f.bind('target')} placeholder={t('inventory.general', 'General / whole herd')} options={[
            ...(flocks.data ?? []).map((fl) => ({ value: `flock:${fl.id}`, label: `🐔 ${fl.name}` })),
            ...(animals.data ?? []).map((a) => ({ value: `animal:${a.id}`, label: `🐄 ${animalLabel(a)}` })),
          ]} />
        )}
        <Input label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

export { methodOptions }
