import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Repeat } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { date } from '@/lib/format'
import { today } from '@/lib/utils'
import { useEmployees } from '@/lib/lookups'
import { Badge, Card, Empty, Input, Modal, PageHeader, Select, Skeleton, Spinner, Tabs, Textarea } from '@/components/ui'

type Task = { id: number; title: string; description: string | null; employee_id: number | null; employee: string | null; due_date: string; due_time: string | null
  priority: string; recurrence: string; status: string; completed_at: string | null; overdue: boolean }

export default function TasksPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [view, setView] = useState<'open' | 'today' | 'overdue' | 'done'>('open')
  const [modal, setModal] = useState<'new' | Task | null>(null)
  const key = ['tasks', view]
  const q = useQuery({ queryKey: key, queryFn: () => get<Task[]>('/tasks', { view }) })
  const done = useApiMutation<{ id: number; status: string }>({
    method: 'patch', url: (v) => `/tasks/${v.id}`, invalidate: [['tasks']], offline: true, label: 'Task',
    optimistic: { key, update: (old, v) => (old as Task[] | undefined)?.map((x) => (x.id === v.id ? { ...x, status: v.status } : x)) },
  })

  return (
    <>
      <PageHeader title={t('nav.tasks')} actions={can('tasks.create') && <button className="btn-primary" onClick={() => setModal('new')}><Plus className="h-4 w-4" />{t('tasks.add', 'New task')}</button>} />
      <Tabs value={view} onChange={setView} tabs={[{ value: 'open', label: t('tasks.open', 'Open') }, { value: 'today', label: t('common.today') },
        { value: 'overdue', label: t('tasks.overdue', 'Overdue') }, { value: 'done', label: t('tasks.done', 'Done') }]} />
      <Card>
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !q.data?.length ? <Empty title={t('tasks.empty', 'No tasks here')} />
          : <ul className="divide-y divide-line">{q.data.map((task) => {
              const finished = task.status === 'completed'
              return (
                <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                  <button disabled={finished || task.status === 'cancelled'} onClick={() => done.mutate({ id: task.id, status: 'completed' })} aria-label={t('tasks.complete', 'Mark done')}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${finished ? 'border-brand-600 bg-brand-600 text-white' : 'border-line hover:border-brand-600'}`}>
                    {finished && <Check className="h-4 w-4" />}
                  </button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => can('tasks.create') && setModal(task)}>
                    <p className={`truncate text-sm font-medium ${finished ? 'text-muted line-through' : ''}`}>{task.title}</p>
                    <p className="text-xs text-muted">{task.employee ?? t('tasks.unassigned', 'Unassigned')} · {date(task.due_date)}{task.due_time && ` ${task.due_time}`}
                      {task.recurrence !== 'none' && <Repeat className="ml-1 inline h-3 w-3" />}</p>
                  </button>
                  {task.overdue ? <Badge tone="red">{t('tasks.overdue', 'Overdue')}</Badge> : task.status === 'in_progress' ? <Badge status="in_progress" /> : <Badge status={task.priority} />}
                </li>
              )
            })}</ul>}
      </Card>
      {modal && <TaskForm task={typeof modal === 'object' ? modal : undefined} onClose={() => setModal(null)} />}
    </>
  )
}

function TaskForm({ task, onClose }: { task?: Task; onClose: () => void }) {
  const { t } = useTranslation()
  const employees = useEmployees()
  const f = useForm({ title: task?.title ?? '', description: task?.description ?? '', employee_id: task?.employee_id ? String(task.employee_id) : '', due_date: task?.due_date ?? today(),
    due_time: task?.due_time ?? '', priority: task?.priority ?? 'normal', recurrence: task?.recurrence ?? 'none', status: task?.status ?? 'pending' })
  const m = useApiMutation({ method: task ? 'patch' : 'post', url: task ? `/tasks/${task.id}` : '/tasks', invalidate: [['tasks']], success: t('common.saved', 'Saved'), onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={task ? t('common.edit') : t('tasks.add', 'New task')} footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('tasks.title', 'Task')} wrapClass="sm:col-span-2" required {...f.bind('title')} list="task-presets" />
        <datalist id="task-presets">{['Feed cows', 'Feed hens and ducks', 'Clean animal housing', 'Collect eggs', 'Record milk production', 'Prepare milk deliveries', 'Clean equipment', 'Check feed stock', 'Administer scheduled vet care'].map((x) => <option key={x} value={x} />)}</datalist>
        <Select label={t('tasks.assignee', 'Assigned to')} {...f.bind('employee_id')} placeholder="—" options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
        <Select label={t('tasks.priority', 'Priority')} {...f.bind('priority')} options={['low', 'normal', 'high'].map((p) => ({ value: p, label: t(`status.${p}`, p) }))} />
        <Input label={t('tasks.due', 'Due date')} type="date" {...f.bind('due_date')} />
        <Input label={t('tasks.time', 'Time')} type="time" {...f.bind('due_time')} />
        <Select label={t('tasks.repeat', 'Repeat')} {...f.bind('recurrence')} options={['none', 'daily', 'weekly', 'monthly'].map((r) => ({ value: r, label: t(`tasks.r.${r}`, r) }))} />
        {task && <Select label={t('common.status')} {...f.bind('status')} options={['pending', 'in_progress', 'completed', 'cancelled'].map((s) => ({ value: s, label: t(`status.${s}`, s.replace('_', ' ')) }))} />}
        <Textarea label={t('common.description')} wrapClass="sm:col-span-2" {...f.bind('description')} />
      </div>
    </Modal>
  )
}
