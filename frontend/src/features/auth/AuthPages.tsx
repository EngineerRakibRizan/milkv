import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input, Spinner } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { toApiError } from '@/lib/api'

/** Public sign-up is off on single-farm production servers (VITE_REGISTRATION=false). */
export const REGISTRATION_OPEN = import.meta.env.VITE_REGISTRATION !== 'false'

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-3 h-12 w-12" />
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.subtitle')}</p>
        </div>
        <div className="card p-6">{children}</div>
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          {footer}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => i18n.changeLanguage(i18n.language === 'bn' ? 'en' : 'bn')}>
            {i18n.language === 'bn' ? 'English' : 'বাংলা'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      const a = toApiError(err)
      setError(a.errors.email?.[0] ?? a.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.welcome')} footer={REGISTRATION_OPEN
      ? <span>{t('auth.noAccount')} <Link className="font-medium text-brand-700" to="/register">{t('auth.register')}</Link></span>
      : <Link className="font-medium text-brand-700" to="/">← {t('nav.website', 'Website')}</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t('auth.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('auth.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button className="btn-primary w-full py-2.5" disabled={busy}>{busy && <Spinner />}{t('auth.login')}</button>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { t, i18n } = useTranslation()
  const { register } = useAuth()
  const navigate = useNavigate()
  const [v, setV] = useState({ name: '', email: '', password: '', farm_name: '' })
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const bind = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }), error: errors[k] })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await register({ ...v, locale: i18n.language })
      navigate('/')
    } catch (err) {
      setErrors(toApiError(err).errors)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.register')} footer={<span>{t('auth.haveAccount')} <Link className="font-medium text-brand-700" to="/login">{t('auth.login')}</Link></span>}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t('auth.farmName')} required {...bind('farm_name')} />
        <Input label={t('auth.name')} required autoComplete="name" {...bind('name')} />
        <Input label={t('auth.email')} type="email" required autoComplete="email" {...bind('email')} />
        <Input label={t('auth.password')} type="password" required minLength={8} autoComplete="new-password" {...bind('password')} />
        <button className="btn-primary w-full py-2.5" disabled={busy}>{busy && <Spinner />}{t('auth.register')}</button>
      </form>
    </AuthLayout>
  )
}
