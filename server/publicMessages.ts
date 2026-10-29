import { formatMessage, localeTag, type Locale } from '../src/i18n/locale.js'

const messages = {
  en: {
    title: '{nickname} ran {distance} m — D&B Runner',
    description: '{nickname} ran {distance} m in D&B Runner. Can you go further?',
    completedRun: 'Completed run',
    distance: '{distance} m',
    seconds: '{seconds} s',
    peakSpeed: 'Top speed {speed} km/h',
    published: 'Published {date}',
    play: 'Give it a go',
    language: 'Language',
    notFoundTitle: 'Run not found — D&B Runner',
    notFoundHeading: 'Run not found',
    notFoundDescription: 'This link may have been removed.',
    playAgain: 'Play D&B Runner',
    bars: { one: 'bar', few: 'bars', many: 'bars', other: 'bars' },
  },
  ru: {
    title: '{nickname} пробежал {distance} м — D&B Runner',
    description: '{nickname} пробежал {distance} м в D&B Runner. Сможешь больше?',
    completedRun: 'Завершённый забег',
    distance: '{distance} м',
    seconds: '{seconds} с',
    peakSpeed: 'Максимальная скорость {speed} км/ч',
    published: 'Опубликовано {date}',
    play: 'Попробовать',
    language: 'Язык',
    notFoundTitle: 'Забег не найден — D&B Runner',
    notFoundHeading: 'Забег не найден',
    notFoundDescription: 'Возможно, ссылка была удалена.',
    playAgain: 'Играть в D&B Runner',
    bars: { one: 'батончик', few: 'батончика', many: 'батончиков', other: 'батончика' },
  },
} as const

export function publicMessages(locale: Locale) {
  const dictionary = messages[locale]
  return {
    ...dictionary,
    format: (key: Exclude<keyof typeof dictionary, 'bars'>, values: Record<string, string | number> = {}) =>
      formatMessage(dictionary[key], values),
    barCount: (value: number): string => {
      const category = new Intl.PluralRules(localeTag(locale)).select(value)
      const form = category in dictionary.bars ? category as keyof typeof dictionary.bars : 'other'
      return `${value.toLocaleString(localeTag(locale))} ${dictionary.bars[form]}`
    },
  }
}
