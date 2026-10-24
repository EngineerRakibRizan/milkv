import { Link, useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { get, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { money } from '@/lib/format'
import type { Animal, Customer, FeedItem, Supplier } from '@/lib/lookups'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'

/** Global search fans out to the module endpoints in parallel; results appear as each one answers. */
export default function SearchPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const [animals, customers, items, suppliers] = useQueries({ queries: [
    { queryKey: ['animals', 'search', q], queryFn: () => get<Paginated<Animal>>('/animals', { search: q, status: 'all', per_page: 10 }), enabled: !!q && can('animals.view') },
    { queryKey: ['customers', 'search', q], queryFn: () => get<Paginated<Customer>>('/customers', { search: q, per_page: 10 }), enabled: !!q && can('customers.view') },
    { queryKey: ['inventory', 'search', q], queryFn: () => get<{ data: FeedItem[] }>('/inventory', { search: q }), enabled: !!q && can('inventory.view') },
    { queryKey: ['suppliers', 'search', q], queryFn: () => get<Supplier[]>('/suppliers', { search: q }), enabled: !!q && can('suppliers.view') },
  ] })
  const sections = [
    { title: t('nav.livestock'), rows: animals.data?.data.map((a) => ({ to: `/livestock/${a.id}`, label: a.name ? `${a.tag} · ${a.name}` : a.tag, meta: <Badge status={a.status} /> })) },
    { title: t('nav.customers'), rows: customers.data?.data.map((c) => ({ to: `/customers/${c.id}`, label: `${c.name} · ${c.phone ?? ''}`, meta: money(c.balance) })) },
    { title: t('nav.inventory'), rows: items.data?.data.map((i) => ({ to: '/inventory', label: i.name, meta: `${i.stock} ${i.unit}` })) },
    { title: t('nav.suppliers'), rows: suppliers.data?.map((s) => ({ to: '/suppliers', label: s.name, meta: money(s.balance) })) },
  ].filter((s) => s.rows?.length)

  return (
    <>
      <PageHeader title={`${t('common.search').replace('…', '')}: “${q}”`} />
      {!sections.length ? <Card><Empty /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((s) => (
            <Card key={s.title} title={s.title}>
              <ul className="divide-y divide-line">{s.rows!.map((r, i) => (
                <li key={i}><Link to={r.to} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-canvas"><span>{r.label}</span><span className="text-muted">{r.meta}</span></Link></li>))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
