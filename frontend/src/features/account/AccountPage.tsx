import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useForm } from '@/hooks/useForm'
import { Card, Input, PageHeader, Spinner } from '@/components/ui'

/** Your own login: name, email and password. */
export default function AccountPage() {
  const { t } = useTranslation()
  const { user, farm } = useAuth()
  const qc = useQueryClient()
  const profile = useForm({ name: user?.name ?? '', email: user?.email ?? '', current_password: '' })
  const pw = useForm({ current_password: '', password: '', password_confirmation: '' })
  const emailChanged = profile.values.email.trim().toLowerCase() !== (user?.email ?? '').toLowerCase()

  const saveProfile = useApiMutation({
    method: 'put', url: '/auth/me', success: t('account.saved'),
    onSuccess: () => { profile.set('current_password', ''); qc.invalidateQueries({ queryKey: ['me'] }) },
  })
  const savePassword = useApiMutation({
    method: 'put', url: '/auth/me', success: t('account.passwordChanged'),
    onSuccess: () => pw.reset(),
  })

  return (
    <>
      <PageHeader title={t('account.title')} subtitle={farm ? `${farm.name} · ${t(`roles.${farm.role}`)}` : undefined} />
      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-brand-700" />{t('account.profile')}</span>}>
          <form className="space-y-3 p-4" noValidate onSubmit={(e) => {
            e.preventDefault()
            saveProfile.mutate({ name: profile.values.name, email: profile.values.email.trim(), current_password: emailChanged ? profile.values.current_password : undefined },
              { onError: (err) => profile.setErrors(err.errors) })
          }}>
            <Input label={t('common.name')} required autoComplete="name" {...profile.bind('name')} />
            <Input label={t('auth.email')} type="email" required autoComplete="email" {...profile.bind('email')} />
            {emailChanged && (
              <Input label={t('account.currentPassword')} type="password" required autoComplete="current-password"
                hint={t('account.confirmEmail')} {...profile.bind('current_password')} />
            )}
            <button className="btn-primary" disabled={saveProfile.isPending}>{saveProfile.isPending && <Spinner />}{t('common.save')}</button>
          </form>
        </Card>

        <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-700" />{t('account.changePassword')}</span>}>
          <form className="space-y-3 p-4" noValidate onSubmit={(e) => {
            e.preventDefault()
            savePassword.mutate(pw.payload(), { onError: (err) => pw.setErrors(err.errors) })
          }}>
            <Input label={t('account.currentPassword')} type="password" required autoComplete="current-password" {...pw.bind('current_password')} />
            <Input label={t('account.newPassword')} type="password" required minLength={8} autoComplete="new-password" hint={t('account.passwordHint')} {...pw.bind('password')} />
            <Input label={t('account.repeatPassword')} type="password" required autoComplete="new-password" {...pw.bind('password_confirmation')} />
            <button className="btn-primary" disabled={savePassword.isPending}>{savePassword.isPending && <Spinner />}{t('account.changePassword')}</button>
          </form>
        </Card>
      </div>
    </>
  )
}
