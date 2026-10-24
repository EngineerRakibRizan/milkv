import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellOff, CheckCheck, Info } from 'lucide-react'
import { get, type Paginated } from '@/lib/api'
import { useApiMutation } from '@/hooks/useApiMutation'
import { dateTime } from '@/lib/format'
import { Card, Empty, PageHeader, Pagination, Skeleton, Tabs } from '@/components/ui'

type Note = { id: number; type: string; severity: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string }

export default function NotificationsPage() {
  const { t } = useTranslation()
  const [unread, setUnread] = useState<'1' | ''>('1')
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['notifications', unread, page], queryFn: () => get<Paginated<Note> & { unread: number }>('/notifications', { unread, page }), placeholderData: keepPreviousData })
  const read = useApiMutation<{ ids?: number[] }>({ url: '/notifications/read', invalidate: [['notifications']] })

  return (
    <>
      <PageHeader title={t('nav.notifications')} subtitle={t('notifications.subtitle', 'Generated hourly from your farm data. Email/SMS delivery is an optional integration and is not enabled.')}
        actions={!!q.data?.unread && <button className="btn-secondary" onClick={() => read.mutate({})}><CheckCheck className="h-4 w-4" />{t('notifications.readAll', 'Mark all read')}</button>} />
      <Tabs value={unread} onChange={(v) => { setUnread(v); setPage(1) }} tabs={[{ value: '1', label: t('notifications.unread', 'Unread'), count: q.data?.unread }, { value: '', label: t('common.all') }]} />
      <Card>
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !q.data?.data.length ? <Empty icon={<BellOff className="h-6 w-6" />} title={t('dashboard.noAlerts')} />
          : <ul className="divide-y divide-line">{q.data.data.map((n) => {
              const Icon = n.severity === 'info' ? Info : AlertTriangle
              return (
                <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.read ? 'opacity-60' : ''}`}>
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${n.severity === 'danger' ? 'text-red-600' : n.severity === 'warning' ? 'text-amber-500' : 'text-sky-600'}`} />
                  <div className="min-w-0 flex-1">
                    {n.link ? <Link to={n.link} onClick={() => !n.read && read.mutate({ ids: [n.id] })} className="text-sm font-medium hover:underline">{n.title}</Link> : <p className="text-sm font-medium">{n.title}</p>}
                    {n.body && <p className="text-sm text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-muted">{dateTime(n.created_at)}</p>
                  </div>
                  {!n.read && <button className="btn-ghost h-8 px-2 text-xs" onClick={() => read.mutate({ ids: [n.id] })}>{t('notifications.markRead', 'Mark read')}</button>}
                </li>
              )
            })}</ul>}
        <Pagination meta={q.data?.meta} onPage={setPage} />
      </Card>
    </>
  )
}
