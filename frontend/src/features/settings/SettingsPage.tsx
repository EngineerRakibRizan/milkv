import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { useAccounts } from '@/lib/lookups'
import { queryClient } from '@/lib/queryClient'
import { Badge, Card, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'

type Farm = { id: number; name: string; address: string | null; phone: string | null; email: string | null; currency: string; timezone: string; locale: string; default_milk_price: string }
type Member = { id: number; name: string; email: string; role: string; status: string }
const ROLES = ['owner', 'manager', 'vet', 'accountant', 'delivery', 'worker']

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { can } = useAuth()
  const [tab, setTab] = useState<'farm' | 'team' | 'categories' | 'data'>('farm')
  const farm = useQuery({ queryKey: ['farm'], queryFn: () => get<Farm>('/farm') })
  const canEdit = can('settings.update')

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'farm', label: t('settings.farm', 'Farm') }, ...(can('users.view') ? [{ value: 'team' as const, label: t('settings.team', 'Users & roles') }] : []),
        { value: 'categories', label: t('settings.categories', 'Income & expense categories') }, { value: 'data', label: t('settings.data', 'Data & backup') }]} />
      {tab === 'farm' && farm.data && <FarmForm farm={farm.data} disabled={!canEdit} />}
      {tab === 'farm' && (
        <Card title={t('settings.personal', 'This device')} className="mt-4 max-w-3xl">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Select label={t('common.language')} value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
          </div>
        </Card>
      )}
      {tab === 'team' && <Team />}
      {tab === 'categories' && <Categories canEdit={canEdit} />}
      {tab === 'data' && (
        <Card className="max-w-3xl" title={t('settings.data', 'Data & backup')}>
          <div className="space-y-3 p-4 text-sm">
            <p>{t('settings.export', 'Every list has an “Export CSV” button and reports can be printed or saved as PDF from the print dialog.')}</p>
            <p>{t('settings.backup', 'Database backups run on the server (see docs/OPERATIONS.md). Ask your administrator for the restore procedure.')}</p>
            <button className="btn-secondary" onClick={() => { queryClient.clear(); location.reload() }}>{t('settings.clearCache', 'Clear offline cache on this device')}</button>
          </div>
        </Card>
      )}
    </>
  )
}

function FarmForm({ farm, disabled }: { farm: Farm; disabled: boolean }) {
  const { t } = useTranslation()
  const f = useForm({ name: farm.name, address: farm.address ?? '', phone: farm.phone ?? '', email: farm.email ?? '', currency: farm.currency, timezone: farm.timezone,
    locale: farm.locale, default_milk_price: farm.default_milk_price })
  const m = useApiMutation({ method: 'put', url: '/farm', invalidate: [['farm'], ['me']], success: t('common.saved', 'Saved') })
  return (
    <Card className="max-w-3xl" title={t('settings.farm', 'Farm profile')}>
      <fieldset disabled={disabled} className="grid gap-3 p-4 sm:grid-cols-2">
        <Input label={t('auth.farmName')} {...f.bind('name')} />
        <Input label={t('common.phone')} {...f.bind('phone')} />
        <Input label={t('customers.address', 'Address')} wrapClass="sm:col-span-2" {...f.bind('address')} />
        <Input label={t('auth.email')} type="email" {...f.bind('email')} />
        <Input label={t('settings.milkPrice', 'Default milk price per litre')} type="number" {...f.bind('default_milk_price')} />
        <Select label={t('settings.currency', 'Currency')} {...f.bind('currency')} options={[{ value: 'BDT', label: 'BDT — Bangladeshi Taka (৳)' }, { value: 'INR', label: 'INR — Indian Rupee' }, { value: 'USD', label: 'USD — US Dollar' }, { value: 'EUR', label: 'EUR — Euro' }]} />
        <Select label={t('settings.timezone', 'Time zone')} {...f.bind('timezone')} options={['Asia/Dhaka', 'Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York']} />
        <Select label={t('settings.defaultLang', 'Default language')} {...f.bind('locale')} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
      </fieldset>
      {!disabled && <div className="flex justify-end border-t border-line px-4 py-3"><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></div>}
    </Card>
  )
}

function Team() {
  const { t } = useTranslation()
  const { can, user } = useAuth()
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: ['farm', 'members'], queryFn: () => get<Member[]>('/farm/members') })
  const update = useApiMutation<{ id: number; role?: string; status?: string }>({ method: 'patch', url: (v) => `/farm/members/${v.id}`, invalidate: [['farm']], success: t('common.saved', 'Saved') })
  return (
    <Card className="max-w-3xl" title={t('settings.team', 'Users & roles')} actions={can('users.manage') && <button className="btn-primary py-1.5" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('settings.invite', 'Add user')}</button>}>
      <ul className="divide-y divide-line">{(q.data ?? []).map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{m.name}</p><p className="text-xs text-muted">{m.email}</p></div>
          {can('users.manage') && m.id !== user?.id ? <>
            <select className="input w-auto py-1.5" value={m.role} onChange={(e) => update.mutate({ id: m.id, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</select>
            <button className="btn-ghost text-xs" onClick={() => update.mutate({ id: m.id, status: m.status === 'active' ? 'disabled' : 'active' })}>{m.status === 'active' ? t('settings.disable', 'Disable') : t('settings.enable', 'Enable')}</button>
          </> : <Badge tone="green">{t(`roles.${m.role}`)}</Badge>}
          {m.status !== 'active' && <Badge tone="gray">{m.status}</Badge>}
        </li>))}
      </ul>
      <p className="border-t border-line px-4 py-3 text-xs text-muted">{t('settings.rolesNote', 'Permissions are enforced by the server. Hiding a button is only a convenience.')}</p>
      {adding && <AddMember onClose={() => setAdding(false)} />}
    </Card>
  )
}

function AddMember({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const f = useForm({ name: '', email: '', role: 'worker' })
  const [temp, setTemp] = useState<string | null>(null)
  const m = useApiMutation<Record<string, unknown>, { temporary_password: string | null }>({ url: '/farm/members', invalidate: [['farm']], success: t('common.saved', 'Saved'),
    onSuccess: (r) => (r.temporary_password ? setTemp(r.temporary_password) : onClose()) })
  return (
    <Modal open size="sm" onClose={onClose} title={t('settings.invite', 'Add user')} footer={temp ? <button className="btn-primary" onClick={onClose}>{t('common.confirm')}</button> : <>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{m.isPending && <Spinner />}{t('common.save')}</button></>}>
      {temp ? (
        <div className="space-y-2 text-sm">
          <p>{t('settings.tempPw', 'Share this temporary password with the user privately. They should change it after signing in.')}</p>
          <p className="rounded-lg bg-canvas p-3 font-mono text-base">{temp}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Input label={t('common.name')} required {...f.bind('name')} />
          <Input label={t('auth.email')} type="email" required {...f.bind('email')} />
          <Select label={t('settings.role', 'Role')} {...f.bind('role')} options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
        </div>
      )}
    </Modal>
  )
}

function Categories({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation()
  const accounts = useAccounts()
  const f = useForm({ name: '', type: 'expense' })
  const m = useApiMutation({ url: '/accounts', invalidate: [['accounts']], success: t('common.saved', 'Saved'), onSuccess: () => f.reset() })
  const group = (type: string) => (accounts.data ?? []).filter((a) => a.type === type)
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      {(['revenue', 'expense'] as const).map((type) => (
        <Card key={type} title={type === 'revenue' ? t('nav.income') : t('nav.expenses')}>
          <ul className="divide-y divide-line text-sm">{group(type).map((a) => (
            <li key={a.id} className="flex justify-between px-4 py-2"><span>{a.name}</span>{!a.is_system && <Badge tone="blue">{t('settings.custom', 'custom')}</Badge>}</li>))}
          </ul>
        </Card>
      ))}
      {canEdit && (
        <Card title={t('settings.addCategory', 'Add category')} className="md:col-span-2">
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Input label={t('common.name')} wrapClass="flex-1 min-w-48" {...f.bind('name')} />
            <Select label={t('common.type')} wrapClass="w-40" {...f.bind('type')} options={[{ value: 'expense', label: t('nav.expenses') }, { value: 'revenue', label: t('nav.income') }]} />
            <button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate(f.payload(), { onError: (e) => f.setErrors(e.errors) })}>{t('common.add')}</button>
          </div>
        </Card>
      )}
    </div>
  )
}
