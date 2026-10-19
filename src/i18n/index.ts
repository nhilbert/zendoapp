import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Locale } from '@/domain/types'
import en from './en.json'
import de from './de.json'

export const resources = { en: { translation: en }, de: { translation: de } } as const

export function detectLocale(): Locale {
  return (navigator.language ?? 'en').toLowerCase().startsWith('de') ? 'de' : 'en'
}

export function setupI18n(locale: Locale) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  document.documentElement.lang = locale
}

export function changeLocale(locale: Locale) {
  void i18n.changeLanguage(locale)
  document.documentElement.lang = locale
}

export default i18n
