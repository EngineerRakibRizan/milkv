import i18n from './i18n'

/** Farm-level settings that drive formatting; set once the farm loads. */
export const locale = { currency: 'BDT', numberLocale: 'en-BD' }

export function setFormatSettings(currency: string, lang: string) {
  locale.currency = currency
  locale.numberLocale = lang === 'bn' ? 'bn-BD' : 'en-BD'
}

// Switching language also switches digits/grouping (e.g. ১,২৩৪ in Bangla) without a reload.
i18n.on('languageChanged', (lng) => setFormatSettings(locale.currency, lng))

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions) {
  const k = `${locale.numberLocale}|${key}`
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale.numberLocale, opts))
  return cache.get(k)!
}

/** Money values arrive from the API as decimal strings (e.g. "1250.50"). */
export function money(v: string | number | null | undefined, opts: { compact?: boolean } = {}) {
  const n = Number(v ?? 0)
  if (opts.compact && Math.abs(n) >= 100_000) {
    return nf(`cc-${locale.currency}`, { style: 'currency', currency: locale.currency, currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 }).format(n)
  }
  return nf(`c-${locale.currency}`, { style: 'currency', currency: locale.currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n)
}

export function num(v: string | number | null | undefined, digits = 2) {
  return nf(`n${digits}`, { maximumFractionDigits: digits }).format(Number(v ?? 0))
}

export function qty(v: string | number | null | undefined, unit: string) {
  return `${num(v)} ${i18n.t(`units.${unit}`, unit)}`
}

export function date(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString(locale.numberLocale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateTime(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleString(locale.numberLocale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
