import { Suspense, useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, Bird, Boxes, ChartColumn, ClipboardList, CloudOff, Droplets, HeartPulse, LayoutDashboard, LogOut, Menu, Moon,
  Plus, Receipt, Settings, ShoppingCart, Sun, Truck, Users, UserCog, Wallet, X, Building2, Search, Inbox,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { get } from '@/lib/api'
import { onOutboxChange, flushOutbox } from '@/lib/outbox'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui'
import { QuickAdd } from './QuickAdd'
import { CowIcon } from './icons'

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; ability: string }

const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: '', items: [{ to: '/', label: 'nav.dashboard', icon: LayoutDashboard, ability: 'dashboard.view' }] },
  { group: 'nav.operations', items: [
    { to: '/livestock', label: 'nav.livestock', icon: CowIcon, ability: 'animals.view' },
    { to: '/poultry', label: 'nav.poultry', icon: Bird, ability: 'flocks.view' },
    { to: '/inventory', label: 'nav.inventory', icon: Boxes, ability: 'inventory.view' },
    { to: '/vet', label: 'nav.vet', icon: HeartPulse, ability: 'vet.view' },
  ] },
  { group: 'nav.sales', items: [
    { to: '/milk', label: 'nav.milk', icon: Droplets, ability: 'milk.view' },
    { to: '/deliveries', label: 'nav.deliveries', icon: Truck, ability: 'deliveries.view' },
    { to: '/customers', label: 'nav.customers', icon: Users, ability: 'customers.view' },
    { to: '/leads', label: 'nav.leads', icon: Inbox, ability: 'leads.view' },
  ] },
  { group: 'nav.finance', items: [
    { to: '/income', label: 'nav.income', icon: Wallet, ability: 'invoices.view' },
    { to: '/expenses', label: 'nav.expenses', icon: Receipt, ability: 'bills.view' },
    { to: '/suppliers', label: 'nav.suppliers', icon: ShoppingCart, ability: 'suppliers.view' },
    { to: '/reports', label: 'nav.reports', icon: ChartColumn, ability: 'reports.operational' },
  ] },
  { group: 'nav.team', items: [
    { to: '/employees', label: 'nav.employees', icon: UserCog, ability: 'employees.view' },
    { to: '/tasks', label: 'nav.tasks', icon: ClipboardList, ability: 'tasks.view' },
    { to: '/notifications', label: 'nav.notifications', icon: Bell, ability: 'notifications.view' },
    { to: '/settings', label: 'nav.settings', icon: Settings, ability: 'dashboard.view' },
  ] },
]

// Phones get a bottom bar with the four most frequent daily actions.
const MOBILE_TABS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, ability: 'dashboard.view' },
  { to: '/milk', label: 'nav.milk', icon: Droplets, ability: 'milk.view' },
  { to: '/deliveries', label: 'nav.deliveries', icon: Truck, ability: 'deliveries.view' },
  { to: '/tasks', label: 'nav.tasks', icon: ClipboardList, ability: 'tasks.view' },
]

function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('farmos.theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('farmos.theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark] as const
}

function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(0)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const off = onOutboxChange(setQueued)
    flushOutbox()
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); off() }
  }, [])
  return { online, queued }
}

export function AppShell() {
  const { t, i18n } = useTranslation()
  const { user, farm, farms, can, logout, switchFarm } = useAuth()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useDarkMode()
  const { online, queued } = useConnectivity()
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  useEffect(() => setOpen(false), [location.pathname])

  const unread = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => get<{ unread: number }>('/notifications', { unread: 1, per_page: 5 }),
    enabled: can('notifications.view'),
    refetchInterval: 120_000,
  })

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.ability) || (i.to === '/reports' && can('reports.finance'))) }))
    .filter((g) => g.items.length)

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">FarmOS</p>
          <p className="truncate text-xs text-muted">{farm?.name}</p>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-2">
        {nav.map((g) => (
          <div key={g.group}>
            {g.group && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{t(g.group)}</p>}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'}
                className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition',
                  isActive ? 'bg-brand-800 text-white' : 'text-muted hover:bg-canvas hover:text-ink')}>
                <i.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(i.label)}</span>
                {i.to === '/notifications' && !!unread.data?.unread && (
                  <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{unread.data.unread}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{user?.name?.[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted">{t(`roles.${farm?.role}`)}</p>
          </div>
          <button className="btn-ghost p-1.5" onClick={logout} title={t('common.logout')} aria-label={t('common.logout')}><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <button className="btn-ghost absolute right-2 top-3 p-1.5" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-5">
          <button className="btn-ghost h-10 w-10 p-0 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <form className="relative hidden max-w-sm flex-1 md:block" onSubmit={(e) => {
            e.preventDefault()
            if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`)
          }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input h-10 py-0 pl-9 leading-10" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {(!online || queued > 0) && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800" title={t('common.offlineQueued', { count: queued })}>
                <CloudOff className="h-3.5 w-3.5" />{online ? queued : t('common.offline')}
              </span>
            )}
            <span className="hidden text-xs text-muted xl:block">{new Date().toLocaleDateString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {farms.length > 1 && (
              <label className="hidden items-center gap-1 sm:flex">
                <Building2 className="h-4 w-4 text-muted" />
                <select className="input h-10 py-0" value={farm?.id} onChange={(e) => switchFarm(Number(e.target.value))}>
                  {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            )}
            <button className="btn-ghost h-10 min-w-10 px-2 py-0 text-xs font-semibold" onClick={() => i18n.changeLanguage(i18n.language === 'bn' ? 'en' : 'bn')} title={t('common.language')}>
              {i18n.language === 'bn' ? 'EN' : 'বাং'}
            </button>
            <button className="btn-ghost h-10 w-10 p-0" onClick={() => setDark(!dark)} title={t('common.darkMode')} aria-label={t('common.darkMode')}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {can('notifications.view') && (
              <NavLink to="/notifications" className="btn-ghost relative h-10 w-10 p-0" aria-label={t('nav.notifications')}>
                <Bell className="h-4 w-4" />
                {!!unread.data?.unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-600 ring-2 ring-surface" />}
              </NavLink>
            )}
            <QuickAdd trigger={<><Plus className="h-4 w-4" /><span className="hidden sm:inline">{t('common.quickAdd')}</span></>} />
          </div>
        </header>

        <main className="flex-1 px-3 pb-24 pt-5 sm:px-6 lg:pb-8">
          <div className="mx-auto max-w-7xl">
            <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64" /></div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          {MOBILE_TABS.filter((i) => can(i.ability)).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-muted')}>
              <i.icon className="h-5 w-5" />{t(i.label)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
