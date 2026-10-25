import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Check, ChevronDown, Droplets, HeartPulse, MessageCircle, Phone, ReceiptText, Send, ShieldCheck, Truck } from 'lucide-react'
import { get, send, toApiError } from '@/lib/api'
import { money } from '@/lib/format'
import { cn, today } from '@/lib/utils'
import { Spinner } from '@/components/ui'

/** The farm whose leads this public page collects (one landing page per farm deployment). */
const FARM_ID = import.meta.env.VITE_PUBLIC_FARM_ID ?? '1'
type Profile = { name: string; phone: string | null; address: string | null; currency: string; milk_price: string }

export default function LandingPage() {
  const { t, i18n } = useTranslation()
  // Customers are Bangla speakers: first-time visitors see Bangla; a chosen language is respected.
  useEffect(() => {
    if (!localStorage.getItem('farmos.lang') && i18n.language !== 'bn') i18n.changeLanguage('bn')
  }, [i18n])
  const farm = useQuery({ queryKey: ['public-farm', FARM_ID], queryFn: () => get<Profile>(`/public/farms/${FARM_ID}`), staleTime: 10 * 60_000 })
  const name = farm.data?.name ?? 'Aura Dairy & Agro'
  const phone = farm.data?.phone
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'bn' ? 'en' : 'bn')

  return (
    <div className="landing min-h-full bg-[#fffaf0] text-[#10261a]">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-[#fffaf0]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <a href="#top" className="flex min-w-0 items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
            <span className="font-display truncate whitespace-nowrap text-base font-extrabold leading-none text-[#12432a] sm:text-lg">{name}</span>
          </a>
          <nav className="ml-6 hidden items-center gap-6 text-sm font-medium text-[#4b6355] md:flex">
            <a href="#why" className="hover:text-[#166534]">{t('landing.navWhy')}</a>
            <a href="#how" className="hover:text-[#166534]">{t('landing.navHow')}</a>
            <a href="#products" className="hover:text-[#166534]">{t('landing.navProducts')}</a>
            <a href="#faq" className="hover:text-[#166534]">{t('landing.navFaq')}</a>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button onClick={toggleLang} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[#166534] hover:bg-[#e7f5ea]">{i18n.language === 'bn' ? 'EN' : 'বাংলা'}</button>
            <a href="#order" className="hidden whitespace-nowrap rounded-full bg-[#166534] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#12432a] sm:inline-block">{t('landing.ctaOrder')}</a>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section id="top" className="relative overflow-hidden bg-[radial-gradient(120%_90%_at_85%_10%,#1f7a45_0%,#12432a_50%,#0b2e1b_100%)] text-white">
        <div className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:radial-gradient(circle_at_8px_8px,#fff_1.2px,transparent_1.6px)] [background-size:22px_22px]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-24 pt-14 md:grid-cols-[1.15fr_.85fr] md:pb-32 md:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1 text-sm font-medium">
              <span className="h-2 w-2 rounded-full bg-[#f2b632]" />{t('landing.kicker')}
            </span>
            <h1 className="font-display mt-5 text-[2.6rem] font-extrabold leading-[1.05] sm:text-6xl">
              {t('landing.h1a')}<br /><span className="text-[#f2b632]">{t('landing.h1b')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#e3f2e7]">{t('landing.lead')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#order" className="inline-flex items-center gap-2 rounded-full bg-[#f2b632] px-6 py-3.5 text-base font-bold text-[#0b2e1b] shadow-lg shadow-black/20 transition hover:-translate-y-0.5">
                <Droplets className="h-5 w-5" />{t('landing.ctaStart')}
              </a>
              {phone && (
                <a href={`tel:${phone}`} className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3.5 text-base font-semibold hover:bg-white/10">
                  <Phone className="h-5 w-5" />{phone}
                </a>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#cfe8d6]">
              {['trust1', 'trust2', 'trust3'].map((k) => <li key={k} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-[#f2b632]" />{t(`landing.${k}`)}</li>)}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <Bottle />
            {farm.data && Number(farm.data.milk_price) > 0 && (
              <div className="absolute -left-2 top-6 rotate-[-8deg] rounded-2xl bg-white px-4 py-3 text-center text-[#0b2e1b] shadow-xl sm:-left-8">
                <p className="text-xs font-medium text-[#4b6355]">{t('landing.priceFrom')}</p>
                <p className="font-display text-3xl font-extrabold leading-none text-[#166534]">{money(farm.data.milk_price)}</p>
                <p className="text-xs font-medium text-[#4b6355]">{t('landing.perLitre')}</p>
              </div>
            )}
          </div>
        </div>
        <svg className="absolute -bottom-px left-0 h-16 w-full md:h-24" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden>
          <path d="M0 60 C240 0 480 100 720 55 C960 10 1200 70 1440 40 V100 H0Z" fill="#fffaf0" />
        </svg>
      </section>

      {/* ---------- Why ---------- */}
      <Section id="why" title={t('landing.whyTitle')} subtitle={t('landing.whySub')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<ShieldCheck />} title={t('landing.f1')} text={t('landing.f1t')} />
          <Feature icon={<HeartPulse />} title={t('landing.f2')} text={t('landing.f2t')} />
          <Feature icon={<Truck />} title={t('landing.f3')} text={t('landing.f3t')} />
          <Feature icon={<ReceiptText />} title={t('landing.f4')} text={t('landing.f4t')} />
        </div>
      </Section>

      {/* ---------- How ---------- */}
      <Section id="how" title={t('landing.howTitle')} tone="tint">
        <ol className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="relative rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
              <span className="font-display flex h-12 w-12 items-center justify-center rounded-full bg-[#166534] text-xl font-bold text-white ring-8 ring-[#e7f5ea]">
                {i18n.language === 'bn' ? ['১', '২', '৩'][n - 1] : n}
              </span>
              <h3 className="mt-5 text-lg font-bold">{t(`landing.s${n}`)}</h3>
              <p className="mt-1 text-[#4b6355]">{t(`landing.s${n}t`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---------- Products ---------- */}
      <Section id="products" title={t('landing.productsTitle')} subtitle={t('landing.productsSub')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Product emoji="🥛" bg="bg-[#e7f5ea]" title={t('landing.p1')} note={farm.data && Number(farm.data.milk_price) > 0 ? `${money(farm.data.milk_price)} / ${t('landing.litre')}` : t('landing.askPrice')} />
          <Product emoji="🥚" bg="bg-[#fff4dc]" title={t('landing.p2')} note={t('landing.askPrice')} />
          <Product emoji="🦆" bg="bg-[#eef3f7]" title={t('landing.p3')} note={t('landing.askPrice')} />
        </div>
      </Section>

      {/* ---------- Order form ---------- */}
      <section id="order" className="scroll-mt-16 px-4 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 overflow-hidden rounded-[2rem] bg-[#0b2e1b] p-6 text-white md:grid-cols-[.9fr_1.1fr] md:p-12">
          <div>
            <h2 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">{t('landing.orderTitle')}</h2>
            <p className="mt-3 text-[#cfe8d6]">{t('landing.orderSub')}</p>
            <ul className="mt-6 space-y-3 text-[#e3f2e7]">
              {['o1', 'o2', 'o3'].map((k) => <li key={k} className="flex gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-[#f2b632]" />{t(`landing.${k}`)}</li>)}
            </ul>
            {phone && (
              <div className="mt-8 rounded-2xl bg-white/10 p-5">
                <p className="text-sm text-[#cfe8d6]">{t('landing.orCall')}</p>
                <a href={`tel:${phone}`} className="font-display mt-1 block text-3xl font-extrabold tracking-wide">{phone}</a>
                <a href={`https://wa.me/88${phone.replace(/\D/g, '')}`} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#f2b632]" target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />WhatsApp
                </a>
              </div>
            )}
          </div>
          <LeadForm />
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <Section id="faq" title={t('landing.faqTitle')}>
        <div className="mx-auto max-w-3xl divide-y divide-black/5 rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
          {[1, 2, 3, 4].map((n) => <Faq key={n} q={t(`landing.q${n}`)} a={t(`landing.a${n}`)} />)}
        </div>
      </Section>

      {/* ---------- Footer ---------- */}
      <footer className="bg-[#0b2e1b] px-4 pb-28 pt-12 text-[#cfe8d6] md:pb-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <div>
              <p className="font-display text-lg font-bold text-white">{name}</p>
              {farm.data?.address && <p className="text-sm">{farm.data.address}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            {phone && <a href={`tel:${phone}`} className="flex items-center gap-2 hover:text-white"><Phone className="h-4 w-4" />{phone}</a>}
            <Link to="/login" className="opacity-70 hover:opacity-100">{t('landing.staff')}</Link>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl text-xs opacity-60">© {new Date().getFullYear()} {name}</p>
      </footer>

      {/* ---------- Mobile sticky CTA ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-black/5 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {phone && <a href={`tel:${phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[#166534] py-3 font-semibold text-[#166534]"><Phone className="h-4 w-4" />{t('landing.call')}</a>}
        <a href="#order" className="flex flex-[1.4] items-center justify-center gap-2 rounded-full bg-[#166534] py-3 font-semibold text-white"><Droplets className="h-4 w-4" />{t('landing.ctaOrder')}</a>
      </div>
    </div>
  )
}

const QUICK_QTY = ['0.5', '1', '2', '3']

function LeadForm() {
  const { t, i18n } = useTranslation()
  const [v, setV] = useState({ name: '', phone: '', area: '', address: '', quantity: '1', start_date: '', message: '', website: '' })
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const set = (k: keyof typeof v, val: string) => { setV({ ...v, [k]: val }); setErrors(({ [k]: _drop, ...rest }) => rest) }
  const bn = i18n.language === 'bn'
  const qtyLabel = (q: string) => (q === '0.5' ? (bn ? 'আধা লিটার' : '½ litre') : `${bn ? ['১', '২', '৩'][Number(q) - 1] : q} ${t('landing.litre')}`)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setState('sending')
    try {
      await send('post', `/public/farms/${FARM_ID}/leads`, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')))
      setState('done')
      // The form collapses into a short thank-you card: keep it in view.
      requestAnimationFrame(() => document.getElementById('order')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      const a = toApiError(err)
      setErrors(a.status === 429 ? { phone: [t('landing.tooMany')] } : Object.keys(a.errors).length ? a.errors : { phone: [a.message] })
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-8 text-center text-[#10261a]">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e7f5ea] text-[#166534]"><Check className="h-8 w-8" /></div>
        <h3 className="font-display mt-4 text-2xl font-extrabold">{t('landing.thanks')}</h3>
        <p className="mt-2 max-w-sm text-[#4b6355]">{t('landing.thanksSub')}</p>
      </div>
    )
  }

  const field = 'w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-[#10261a] outline-none placeholder:text-[#8aa093] focus:border-[#166534] focus:ring-4 focus:ring-[#166534]/15'
  const err = (k: string) => errors[k]?.[0] && <p className="mt-1 text-sm text-red-600" role="alert">{errors[k][0]}</p>

  return (
    <form onSubmit={submit} noValidate className="rounded-3xl bg-white p-6 text-[#10261a] sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0 sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">{t('landing.fName')} *</span>
          <input className={field} required autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} />{err('name')}</label>
        <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold">{t('landing.fPhone')} *</span>
          <input className={field} required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={v.phone} onChange={(e) => set('phone', e.target.value)} />{err('phone')}</label>
        <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold">{t('landing.fArea')}</span>
          <input className={field} placeholder={t('landing.fAreaPh')} value={v.area} onChange={(e) => set('area', e.target.value)} />{err('area')}</label>
        <label className="block min-w-0 sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">{t('landing.fAddress')}</span>
          <input className={field} autoComplete="street-address" value={v.address} onChange={(e) => set('address', e.target.value)} />{err('address')}</label>
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold">{t('landing.fQty')}</span>
          <div className="flex flex-wrap gap-2">
            {QUICK_QTY.map((q) => (
              <button type="button" key={q} onClick={() => set('quantity', q)}
                className={cn('rounded-full border px-4 py-2 text-sm font-semibold transition', v.quantity === q ? 'border-[#166534] bg-[#166534] text-white' : 'border-black/10 hover:border-[#166534]')}>
                {qtyLabel(q)}
              </button>
            ))}
            <input className={cn(field, 'w-28 py-2')} type="number" inputMode="decimal" step="any" min="0" placeholder={t('landing.other')}
              value={QUICK_QTY.includes(v.quantity) ? '' : v.quantity} onChange={(e) => set('quantity', e.target.value)} aria-label={t('landing.fQty')} />
          </div>
          {err('quantity')}
        </div>
        <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold"><CalendarCheck className="mr-1 inline h-4 w-4" />{t('landing.fStart')}</span>
          <input className={field} type="date" min={today()} value={v.start_date} onChange={(e) => set('start_date', e.target.value)} />{err('start_date')}</label>
        <label className="block min-w-0"><span className="mb-1.5 block text-sm font-semibold">{t('landing.fMsg')}</span>
          <input className={field} value={v.message} onChange={(e) => set('message', e.target.value)} />{err('message')}</label>
        {/* Honeypot: hidden from people, bots fill it and get rejected. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set('website', e.target.value)}
          className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
      </div>
      <button disabled={state === 'sending'} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#166534] py-4 text-lg font-bold text-white shadow-lg shadow-[#166534]/25 transition hover:bg-[#12432a] disabled:opacity-60">
        {state === 'sending' ? <Spinner className="h-5 w-5" /> : <Send className="h-5 w-5" />}{t('landing.submit')}
      </button>
      <p className="mt-3 text-center text-xs text-[#4b6355]">{t('landing.privacy')}</p>
    </form>
  )
}

function Section({ id, title, subtitle, children, tone }: { id: string; title: string; subtitle?: string; children: ReactNode; tone?: 'tint' }) {
  return (
    <section id={id} className={cn('scroll-mt-16 px-4 py-16 md:py-20', tone === 'tint' && 'bg-[#f1f8f2]')}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-extrabold text-[#12432a] sm:text-4xl">{title}</h2>
          {subtitle && <p className="mx-auto mt-3 max-w-2xl text-[#4b6355]">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-1 hover:shadow-md">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f5ea] text-[#166534] [&>svg]:h-6 [&>svg]:w-6">{icon}</div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-[#4b6355]">{text}</p>
    </div>
  )
}

function Product({ emoji, bg, title, note }: { emoji: string; bg: string; title: string; note: string }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
      <div className={cn('flex h-32 items-center justify-center text-6xl', bg)}>{emoji}</div>
      <div className="flex items-center justify-between gap-2 p-5">
        <h3 className="text-lg font-bold">{title}</h3>
        <span className="text-sm font-semibold text-[#166534]">{note}</span>
      </div>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-semibold" aria-expanded={open}>
        {q}<ChevronDown className={cn('h-5 w-5 shrink-0 text-[#166534] transition', open && 'rotate-180')} />
      </button>
      {open && <p className="px-6 pb-5 text-[#4b6355]">{a}</p>}
    </div>
  )
}

function Bottle() {
  return (
    <svg viewBox="0 0 320 420" className="w-full drop-shadow-2xl" aria-hidden>
      <defs><linearGradient id="lb" x1="0" x2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#dfe9e2" /></linearGradient></defs>
      <circle cx="190" cy="150" r="130" fill="#f2b632" opacity=".14" /><circle cx="190" cy="150" r="85" fill="#f2b632" opacity=".2" />
      <g transform="translate(130 20) scale(.8)">
        <ellipse cx="80" cy="455" rx="100" ry="15" fill="#000" opacity=".25" />
        <rect x="52" y="0" width="56" height="34" rx="8" fill="#f2b632" /><rect x="48" y="28" width="64" height="12" rx="5" fill="#d99a16" />
        <path d="M58 40 h44 v40 c0 18 52 40 52 90 v250 a30 30 0 0 1 -30 30 h-88 a30 30 0 0 1 -30 -30 v-250 c0 -50 52 -72 52 -90z" fill="url(#lb)" stroke="#cfe0d4" strokeWidth="3" />
        <rect x="18" y="220" width="124" height="140" rx="12" fill="#166534" />
        <text x="80" y="268" textAnchor="middle" fontFamily="Poppins, Inter, sans-serif" fontWeight="800" fontSize="30" fill="#fff">AURA</text>
        <text x="80" y="300" textAnchor="middle" fontFamily="Hind Siliguri" fontWeight="700" fontSize="24" fill="#f2b632">খাঁটি দুধ</text>
        <text x="80" y="336" textAnchor="middle" fontFamily="Poppins, Inter, sans-serif" fontWeight="600" fontSize="14" fill="#cfe8d6" letterSpacing="2">FRESH MILK</text>
        <path d="M30 120 c10 -20 30 -34 40 -40" stroke="#fff" strokeWidth="8" strokeLinecap="round" fill="none" opacity=".9" />
      </g>
      <g transform="translate(40 200) scale(.72)">
        <ellipse cx="62" cy="246" rx="70" ry="12" fill="#000" opacity=".25" />
        <path d="M8 0 h108 l-12 232 a14 14 0 0 1 -14 13 h-56 a14 14 0 0 1 -14 -13z" fill="#fff" stroke="#d5e3d9" strokeWidth="3" />
        <path d="M22 60 v150" stroke="#eef3ef" strokeWidth="7" strokeLinecap="round" />
      </g>
    </svg>
  )
}
