import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ---------- Layout ---------- */

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, tone = 'default', icon }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn'; icon?: ReactNode
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className={cn('tabular mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl',
        tone === 'good' && 'text-brand-700 dark:text-brand-500', tone === 'bad' && 'text-red-600', tone === 'warn' && 'text-amber-600')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

const badgeTones: Record<string, string> = {
  green: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-500',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}
const statusTone: Record<string, string> = {
  active: 'green', paid: 'green', delivered: 'green', completed: 'green', healthy: 'green', recovered: 'green', lactating: 'green',
  partial: 'amber', pending: 'amber', in_progress: 'blue', prepared: 'blue', out_for_delivery: 'blue', ongoing: 'amber', under_treatment: 'amber', pregnant: 'blue',
  unpaid: 'red', cancelled: 'gray', void: 'gray', sold: 'gray', deceased: 'red', transferred: 'gray', sick: 'red', inactive: 'gray', paused: 'amber',
  dry: 'gray', closed: 'gray', high: 'red', normal: 'gray', low: 'blue', died: 'red', referred: 'blue',
}

export function Badge({ children, tone, status }: { children?: ReactNode; tone?: keyof typeof badgeTones; status?: string }) {
  const { t } = useTranslation()
  const tn = tone ?? (status ? statusTone[status] : undefined) ?? 'gray'
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', badgeTones[tn])}>
      {children ?? (status ? t(`status.${status}`, status.replace(/_/g, ' ')) : null)}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-line/70', className)} />
}

export function Empty({ title, hint, action, icon }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-3 rounded-full bg-canvas p-3 text-muted">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-medium">{title ?? t('common.noData')}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? 'Could not load data'
  return (
    <div className="card border-red-200 p-6 text-center dark:border-red-900">
      <p className="text-sm font-medium text-red-600">{msg}</p>
      {retry && <button className="btn-secondary mt-3" onClick={retry}>Retry</button>}
    </div>
  )
}

/* ---------- Forms ---------- */

type FieldProps = { label?: ReactNode; error?: string | string[]; hint?: ReactNode; className?: string; children: ReactNode; htmlFor?: string; required?: boolean }

export function Field({ label, error, hint, className, children, htmlFor, required }: FieldProps) {
  const msg = Array.isArray(error) ? error[0] : error
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="label">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {msg ? <p className="mt-1 text-xs text-red-600" role="alert">{msg}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string | string[]; hint?: ReactNode; wrapClass?: string }

export function Input({ label, error, hint, wrapClass, className, id, ...rest }: InputProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field label={label} error={error} hint={hint} className={wrapClass} htmlFor={fid} required={rest.required}>
      <input id={fid} className={cn('input', error && 'border-red-400', className)} aria-invalid={!!error}
        {...(rest.type === 'number' ? { inputMode: 'decimal', step: 'any' } : {})} {...rest} />
    </Field>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode; error?: string | string[]; wrapClass?: string
  options: Array<{ value: string | number; label: ReactNode } | string>; placeholder?: string
}

export function Select({ label, error, wrapClass, className, options, placeholder, id, ...rest }: SelectProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field label={label} error={error} className={wrapClass} htmlFor={fid} required={rest.required}>
      <select id={fid} className={cn('input pr-8', className)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label as string}</option>)}
      </select>
    </Field>
  )
}

export function Textarea({ label, error, wrapClass, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string | string[]; wrapClass?: string }) {
  const fid = useId()
  return (
    <Field label={label} error={error} className={wrapClass} htmlFor={fid}>
      <textarea id={fid} rows={3} className={cn('input', className)} {...rest} />
    </Field>
  )
}

/* ---------- Overlays ---------- */

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input,select,textarea')?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div ref={ref} className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({ open, onClose, onConfirm, title, message, danger, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; message?: ReactNode; danger?: boolean; busy?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy && <Spinner />}{t('common.confirm')}</button>
    </>}>
      <p className="text-sm text-muted">{message ?? t('common.areYouSure')}</p>
    </Modal>
  )
}

/* ---------- Data display ---------- */

export type Column<T> = { key: string; header: ReactNode; render: (row: T) => ReactNode; className?: string; mobile?: 'title' | 'subtitle' | 'meta' | 'hide' }

/** Table on desktop, compact cards on phones. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, loading, empty }: {
  rows: T[] | undefined; columns: Column<T>[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; loading?: boolean; empty?: ReactNode
}) {
  if (loading && !rows) {
    return <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
  }
  if (!rows?.length) return <>{empty ?? <Empty />}</>
  const title = columns.find((c) => c.mobile === 'title') ?? columns[0]
  const subtitle = columns.find((c) => c.mobile === 'subtitle')
  const meta = columns.filter((c) => c.mobile === 'meta')
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead className="border-b border-line bg-canvas/60">
            <tr>{columns.map((c) => <th key={c.key} className={cn('th', c.className)}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn(onRowClick && 'cursor-pointer hover:bg-canvas/70')}>
                {columns.map((c) => <td key={c.key} className={cn('td', c.className)}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn('px-4 py-3', onRowClick && 'active:bg-canvas')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{title.render(r)}</div>
                {subtitle && <div className="truncate text-xs text-muted">{subtitle.render(r)}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-sm">{meta.map((c) => <div key={c.key}>{c.render(r)}</div>)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export function Pagination({ meta, onPage }: { meta?: { current_page: number; last_page: number; total: number }; onPage: (p: number) => void }) {
  const { t } = useTranslation()
  if (!meta || meta.last_page <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">{t('common.page', { page: meta.current_page, last: meta.last_page })} · {meta.total}</span>
      <div className="flex gap-1">
        <button className="btn-secondary px-2" disabled={meta.current_page <= 1} onClick={() => onPage(meta.current_page - 1)} aria-label={t('common.previous')}><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn-secondary px-2" disabled={meta.current_page >= meta.last_page} onClick={() => onPage(meta.current_page + 1)} aria-label={t('common.next')}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; count?: number }> }) {
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
      {tabs.map((tb) => (
        <button key={tb.value} onClick={() => onChange(tb.value)}
          className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === tb.value ? 'bg-brand-800 text-white' : 'text-muted hover:bg-surface hover:text-ink')}>
          {tb.label}{tb.count != null && <span className="ml-1.5 opacity-70">{tb.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const { t } = useTranslation()
  return <input type="search" className={cn('input max-w-xs', className)} placeholder={placeholder ?? t('common.search')} value={value} onChange={(e) => onChange(e.target.value)} />
}
