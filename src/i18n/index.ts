import { formatMessage, localeTag, type Locale } from './locale'
import { messages, type MessageKey } from './messages'

const LANGUAGE_KEY = 'db-runner.language'
const listeners = new Set<() => void>()
let locale: Locale = 'en'
const requested = new URLSearchParams(globalThis.location?.search).get('lang')
try {
  const saved = globalThis.localStorage?.getItem(LANGUAGE_KEY)
  locale = saved === 'ru' ? 'ru' : 'en'
} catch { /* Browser storage can be denied independently of the shared-link language. */ }
if (requested === 'en' || requested === 'ru') locale = requested
try {
  if (requested === 'en' || requested === 'ru') globalThis.localStorage?.setItem(LANGUAGE_KEY, locale)
} catch { /* Language selection must work without persistent browser storage. */ }

export function getLocale(): Locale { return locale }
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'ru') return
  if (next === locale) return
  locale = next
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, locale) } catch { /* Keep this page usable. */ }
  // Explicit shared-link language seeds the preference once; subsequent reloads follow the user's choice.
  if (typeof window !== 'undefined' && window.location) {
    const url = new URL(window.location.href)
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang')
      window.history.replaceState(window.history.state, '', url)
    }
  }
  for (const listener of listeners) listener()
}
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return formatMessage(messages[locale][key], values)
}
export function number(value: number, decimals = 0): string {
  return value.toLocaleString(localeTag(locale), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
export function pickupCount(count: number, bottles = false): string {
  const form = new Intl.PluralRules(localeTag(locale)).select(count)
  if (locale === 'en') return `${number(count)} ${t(bottles ? count === 1 ? 'bottle' : 'bottles' : count === 1 ? 'bar' : 'bars')}`
  const nouns = bottles ? { one: 'бутылка', few: 'бутылки', many: 'бутылок', other: 'бутылки' }
    : { one: 'батончик', few: 'батончика', many: 'батончиков', other: 'батончика' }
  return `${number(count)} ${nouns[form as keyof typeof nouns] ?? nouns.other}`
}
export function runCount(count: number): string {
  const form = new Intl.PluralRules(localeTag(locale)).select(count)
  const noun = locale === 'en' ? count === 1 ? 'run' : 'runs'
    : form === 'one' ? 'забег' : form === 'few' ? 'забега' : 'забегов'
  return `${number(count)} ${noun}`
}

/** Only annotated text/attributes are replaced: inputs and dynamic state stay intact. */
export function applyDocumentLanguage(): void {
  document.documentElement.lang = locale
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n as MessageKey)
  }
  for (const attribute of ['aria-label', 'alt'] as const) {
    for (const node of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const key = node.getAttribute(`data-i18n-${attribute}`) as MessageKey
      node.setAttribute(attribute, t(key))
    }
  }
  for (const language of ['en', 'ru'] as const) {
    document.getElementById(`language-${language}`)?.setAttribute('aria-pressed', String(language === locale))
  }
}
