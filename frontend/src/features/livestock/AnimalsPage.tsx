import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useDebounced } from '@/hooks/useForm'
import { downloadCsv } from '@/lib/utils'
import { num } from '@/lib/format'
import type { Animal } from '@/lib/lookups'
import { Badge, Card, DataTable, Empty, PageHeader, Pagination, SearchInput, Select, Tabs, type Column } from '@/components/ui'
import { AnimalForm } from './AnimalForm'

export default function AnimalsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('active')
  const [type, setType] = useState('')
  const [health, setHealth] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const q = useDebounced(search)
  const params = status === 'archived'
    ? { archived: 1, status: 'all', type, health, search: q, page }
    : { status, type, health, search: q, page }

  const list = useQuery({
    queryKey: ['animals', params],
    queryFn: () => get<Paginated<Animal>>('/animals', params),
    placeholderData: keepPreviousData,
  })

  const cols: Column<Animal>[] = [
    { key: 'tag', header: t('livestock.tag', 'Tag'), mobile: 'title', render: (a) => <span className="font-medium">{a.tag}{a.name && <span className="font-normal text-muted"> · {a.name}</span>}</span> },
    { key: 'type', header: t('common.type'), mobile: 'subtitle', render: (a) => `${t(`animal.${a.type}`, a.type)} · ${a.breed ?? '—'}` },
    { key: 'age', header: t('livestock.age', 'Age'), render: (a) => a.age_months == null ? '—' : a.age_months >= 24 ? `${Math.floor(a.age_months / 12)} y` : `${a.age_months} m` },
    { key: 'weight', header: t('livestock.weight', 'Weight'), className: 'text-right tabular', render: (a) => (a.weight ? `${num(a.weight, 0)} kg` : '—') },
    { key: 'lact', header: t('livestock.production', 'Production'), mobile: 'meta', render: (a) => a.lactation_status ? <Badge status={a.lactation_status} /> : a.reproductive_status === 'pregnant' ? <Badge status="pregnant" /> : null },
    { key: 'health', header: t('livestock.health', 'Health'), render: (a) => <Badge status={a.health_status} /> },
    { key: 'status', header: t('common.status'), mobile: 'meta', render: (a) => a.status !== 'active' ? <Badge status={a.status} /> : null },
  ]

  return (
    <>
      <PageHeader title={t('nav.livestock')} subtitle={list.data ? `${list.data.meta.total} ${t('livestock.animals', 'animals')}` : undefined} actions={<>
        <button className="btn-secondary" onClick={() => list.data && downloadCsv('animals.csv', list.data.data.map(({ archived: _a, ...r }) => r))}>{t('common.export')}</button>
        {can('animals.create') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('livestock.add', 'Register animal')}</button>}
      </>} />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1) }} tabs={[
        { value: 'active', label: t('status.active', 'Active') }, { value: 'sold', label: t('status.sold', 'Sold') },
        { value: 'deceased', label: t('status.deceased', 'Deceased') }, { value: 'all', label: t('common.all') },
        { value: 'archived', label: t('common.archived', 'Archived') }]} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('livestock.search', 'Tag, name or breed…')} />
          <Select wrapClass="w-36" value={type} onChange={(e) => setType(e.target.value)} placeholder={t('common.type')} options={['cow', 'heifer', 'bull', 'calf'].map((x) => ({ value: x, label: t(`animal.${x}`, x) }))} />
          <Select wrapClass="w-40" value={health} onChange={(e) => setHealth(e.target.value)} placeholder={t('livestock.health', 'Health')} options={['healthy', 'sick', 'under_treatment'].map((x) => ({ value: x, label: t(`status.${x}`, x.replace('_', ' ')) }))} />
        </div>
        <DataTable rows={list.data?.data} columns={cols} rowKey={(a) => a.id} loading={list.isLoading} onRowClick={(a) => navigate(`/livestock/${a.id}`)}
          empty={<Empty title={t('livestock.empty', 'No animals yet')} action={can('animals.create') && <button className="btn-primary" onClick={() => setAdding(true)}>{t('livestock.add', 'Register animal')}</button>} />} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>
      {adding && <AnimalForm open onClose={() => setAdding(false)} onSaved={(a) => navigate(`/livestock/${a.id}`)} />}
    </>
  )
}
