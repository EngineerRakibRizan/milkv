import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, Pencil, Plus, ShoppingCart, Wheat } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date, money, num } from '@/lib/format'
import { downloadCsv, today } from '@/lib/utils'
import { useSuppliers, type FeedItem } from '@/lib/lookups'
import { Badge, Card, DataTable, Empty, Input, Modal, PageHeader, Pagination, Select, Spinner, Stat, Tabs, Textarea, type Column } from '@/components/ui'
import { BillModal, FeedIssueModal } from '@/features/shared/forms'

const CATEGORIES = ['cow_feed', 'calf_feed', 'hen_feed', 'duck_feed', 'concentrate', 'green_fodder', 'hay_silage', 'rice_bran', 'supplement', 'medicine', 'other']
const UNITS = ['kg', 'l', 'bag', 'pcs']
type Movement = { id: number; date: string; type: string; item: string; unit: string; quantity: string; unit_cost: string; value: string; target: string | null; notes: string | null; source_type: string | null }

export default function InventoryPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [tab, setTab] = useState<'stock' | 'movements'>('stock')
  const [category, setCategory] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [mvType, setMvType] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ kind: 'item'; item?: FeedItem } | { kind: 'adjust'; item: FeedItem } | { kind: 'purchase' } | { kind: 'issue' } | null>(null)

  const items = useQuery({ queryKey: ['inventory', category, lowOnly], queryFn: () => get<{ data: FeedItem[]; total_value: string }>('/inventory', { category, low: lowOnly ? 1 : undefined }) })
  const moves = useQuery({ queryKey: ['inventory', 'movements', mvType, page], queryFn: () => get<Paginated<Movement>>('/inventory-movements', { type: mvType, page }), enabled: tab === 'movements', placeholderData: keepPreviousData })
  const low = items.data?.data.filter((i) => i.low).length ?? 0

  const cols: Column<FeedItem>[] = [
    { key: 'name', header: t('inventory.item', 'Item'), mobile: 'title', render: (i) => <span className="font-medium">{i.name} <span className="text-xs font-normal text-muted">{i.sku}</span></span> },
    { key: 'cat', header: t('common.category'), mobile: 'subtitle', render: (i) => t(`feedcat.${i.category}`, i.category.replace('_', ' ')) },
    { key: 'stock', header: t('inventory.stock', 'In stock'), mobile: 'meta', className: 'text-right tabular', render: (i) => (
      <span className={i.low ? 'font-semibold text-amber-600' : ''}>{num(i.stock)} {t(`units.${i.unit}`, i.unit)}{i.low && <Badge tone="amber">{t('inventory.low', 'Low')}</Badge>}</span>) },
    { key: 'min', header: t('inventory.min', 'Min'), className: 'text-right tabular text-muted', render: (i) => num(i.min_stock) },
    { key: 'avg', header: t('inventory.avgCost', 'Avg cost'), className: 'text-right tabular', render: (i) => `${money(i.avg_cost)}/${i.unit}` },
    { key: 'val', header: t('inventory.value', 'Value'), className: 'text-right tabular', render: (i) => money(i.stock_value) },
    { key: 'act', header: '', className: 'text-right', render: (i) => can('inventory.update') && (
      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button className="btn-ghost p-1.5" title={t('common.edit')} onClick={() => setModal({ kind: 'item', item: i })}><Pencil className="h-4 w-4" /></button>
        <button className="btn-ghost p-1.5" title={t('inventory.count', 'Stock count')} onClick={() => setModal({ kind: 'adjust', item: i })}><ClipboardCheck className="h-4 w-4" /></button>
      </span>) },
  ]

  return (
    <>
      <PageHeader title={t('nav.inventory')} actions={<>
        {can('inventory.consume') && <button className="btn-secondary" onClick={() => setModal({ kind: 'issue' })}><Wheat className="h-4 w-4" />{t('quick.feed', 'Feed used')}</button>}
        {can('bills.create') && <button className="btn-secondary" onClick={() => setModal({ kind: 'purchase' })}><ShoppingCart className="h-4 w-4" />{t('inventory.purchase', 'Purchase')}</button>}
        {can('inventory.create') && <button className="btn-primary" onClick={() => setModal({ kind: 'item' })}><Plus className="h-4 w-4" />{t('inventory.addItem', 'New item')}</button>}
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-lg">
        <Stat label={t('dashboard.feedValue')} value={money(items.data?.total_value)} />
        <Stat label={t('inventory.lowItems', 'Low on stock')} value={low} tone={low ? 'warn' : 'default'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stock', label: t('inventory.stock', 'Stock') }, { value: 'movements', label: t('inventory.movements', 'Stock movements') }]} />
      {tab === 'stock' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Select wrapClass="w-44" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('common.category')} options={CATEGORIES.map((c) => ({ value: c, label: t(`feedcat.${c}`, c.replace('_', ' ')) }))} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />{t('inventory.lowOnly', 'Low stock only')}</label>
            <button className="btn-ghost ml-auto text-xs" onClick={() => items.data && downloadCsv('inventory.csv', items.data.data)}>{t('common.export')}</button>
          </div>
          <DataTable rows={items.data?.data} columns={cols} rowKey={(i) => i.id} loading={items.isLoading} empty={<Empty title={t('inventory.empty', 'No items yet')} />} />
        </Card>
      ) : (
        <Card>
          <div className="flex gap-2 border-b border-line p-3">
            <Select wrapClass="w-44" value={mvType} onChange={(e) => { setMvType(e.target.value); setPage(1) }} placeholder={t('common.all')}
              options={['purchase', 'consumption', 'wastage', 'spoilage', 'adjustment', 'opening'].map((x) => ({ value: x, label: t(`inventory.${x}`, x) }))} />
          </div>
          <DataTable rows={moves.data?.data} rowKey={(m) => m.id} loading={moves.isLoading} columns={[
            { key: 'd', header: t('common.date'), render: (m) => date(m.date), mobile: 'subtitle' },
            { key: 'i', header: t('inventory.item', 'Item'), mobile: 'title', render: (m) => <>{m.item}{m.target && <span className="text-muted"> → {m.target}</span>}</> },
            { key: 't', header: t('common.type'), render: (m) => <Badge tone={Number(m.quantity) > 0 ? 'green' : m.type === 'consumption' ? 'blue' : 'amber'}>{t(`inventory.${m.type}`, m.type)}</Badge> },
            { key: 'q', header: t('common.quantity'), mobile: 'meta', className: 'text-right tabular', render: (m) => `${Number(m.quantity) > 0 ? '+' : ''}${num(m.quantity)} ${m.unit}` },
            { key: 'v', header: t('inventory.value', 'Value'), className: 'text-right tabular', render: (m) => money(m.value) },
          ]} />
          <Pagination meta={moves.data?.meta} onPage={setPage} />
        </Card>
      )}
      {modal?.kind === 'item' && <ItemForm item={modal.item} onClose={() => setModal(null)} />}
      {modal?.kind === 'adjust' && <AdjustModal item={modal.item} onClose={() => setModal(null)} />}
      {modal?.kind === 'purchase' && <BillModal open kind="purchase" onClose={() => setModal(null)} />}
      {modal?.kind === 'issue' && <FeedIssueModal open onClose={() => setModal(null)} />}
    </>
  )
}

function ItemForm({ item, onClose }: { item?: FeedItem; onClose: () => void }) {
  const { t } = useTranslation()
  const suppliers = useSuppliers()
  const f = useForm({ sku: item?.sku ?? '', name: item?.name ?? '', category: item?.category ?? 'concentrate', unit: item?.unit ?? 'kg', min_stock: item ? item.min_stock : '',
    supplier_id: item?.supplier_id ? String(item.supplier_id) : '', location: item?.location ?? '', expires_at: item?.expires_at ?? '', notes: item?.notes ?? '', opening_stock: '', opening_cost: '' })
  const m = useApiMutation({ method: item ? 'put' : 'post', url: item ? `/inventory/${item.id}` : '/inventory', invalidate: [['inventory']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={item ? t('common.edit') : t('inventory.addItem', 'New item')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('common.name')} required {...f.bind('name')} />
        <Input label="SKU" required {...f.bind('sku')} />
        <Select label={t('common.category')} {...f.bind('category')} options={CATEGORIES.map((c) => ({ value: c, label: t(`feedcat.${c}`, c.replace('_', ' ')) }))} />
        <Select label={t('common.unit')} {...f.bind('unit')} options={UNITS.map((u) => ({ value: u, label: t(`units.${u}`, u) }))} />
        <Input label={t('inventory.minStock', 'Low-stock alert at')} type="number" {...f.bind('min_stock')} />
        <Select label={t('nav.suppliers')} {...f.bind('supplier_id')} placeholder="—" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Input label={t('inventory.location', 'Storage location')} {...f.bind('location')} />
        <Input label={t('inventory.expires', 'Expiry date')} type="date" {...f.bind('expires_at')} />
        {!item && <>
          <Input label={t('inventory.opening', 'Opening stock')} type="number" {...f.bind('opening_stock')} />
          <Input label={t('inventory.openingCost', 'Cost per unit')} type="number" {...f.bind('opening_cost')} />
        </>}
        <Textarea label={t('common.notes')} wrapClass="sm:col-span-2" {...f.bind('notes')} />
      </div>
    </Modal>
  )
}

function AdjustModal({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ date: today(), counted: item.stock, notes: '' })
  const m = useApiMutation({ url: `/inventory/${item.id}/adjust`, invalidate: [['inventory']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  const diff = Number(f.values.counted || 0) - Number(item.stock)
  return (
    <Modal open size="sm" onClose={onClose} title={`${t('inventory.count', 'Stock count')} — ${item.name}`} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('inventory.system', 'System stock')}: <b className="text-ink">{num(item.stock)} {item.unit}</b></p>
        <Input label={`${t('inventory.counted', 'Counted quantity')} (${item.unit})`} type="number" {...f.bind('counted')}
          hint={diff ? `${diff > 0 ? '+' : ''}${num(diff)} ${item.unit} ${t('inventory.adjustment', 'adjustment')}` : undefined} />
        <Input label={t('common.date')} type="date" {...f.bind('date')} />
        <Input label={t('inventory.reason', 'Reason')} required {...f.bind('notes')} />
      </div>
    </Modal>
  )
}
