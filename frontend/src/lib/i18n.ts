import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import bn from '@/locales/bn.json'

const saved = localStorage.getItem('farmos.lang') ?? 'en'

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: saved,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('farmos.lang', lng)
  document.documentElement.lang = lng
})
document.documentElement.lang = saved

export default i18n
