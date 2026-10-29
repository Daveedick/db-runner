export type Locale = 'en' | 'ru'

export function localeTag(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : 'en-GB'
}

export function formatMessage(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
