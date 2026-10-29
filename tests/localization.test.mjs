import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { sourceModuleUrl } from './source-module.mjs'

const languageKey = 'db-runner.language'
let instance = 0

// A fragment gives the stateful entry point a fresh module identity while its pure
// dictionary/formatting dependencies still use the existing source-module loader.
const loadLocale = () => import(`${sourceModuleUrl('i18n/index.ts')}#locale-test-${++instance}`)

async function withBrowser(options, check) {
  const values = new Map(options.saved === undefined ? [] : [[languageKey, options.saved]])
  let url = new URL(options.url ?? 'https://runner.test/')
  const replacements = []
  const location = {
    get href() { return url.href },
    get search() { return url.search },
  }
  const globals = {
    navigator: { language: options.browserLanguage ?? 'ru-RU', languages: [options.browserLanguage ?? 'ru-RU'] },
    location,
    localStorage: {
      getItem(key) {
        if (options.deniedStorage) throw new Error('Storage access denied')
        return values.get(key) ?? null
      },
      setItem(key, value) {
        if (options.deniedStorage || options.deniedWrites) throw new Error('Storage access denied')
        values.set(key, value)
      },
    },
    window: {
      location,
      history: {
        state: { navigation: 'preserve-me' },
        replaceState(state, title, next) {
          replacements.push({ state, title })
          url = new URL(next, url)
        },
      },
    },
  }
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  try {
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    await check(await loadLocale(), { values, location, replacements, reload: loadLocale })
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

test('English is the default even when the browser prefers Russian; a saved Russian choice is restored', async () => {
  await withBrowser({ browserLanguage: 'ru-RU' }, locale => {
    assert.equal(locale.getLocale(), 'en')
    assert.equal(locale.t('leaderboard'), 'Leaderboard')
  })
  await withBrowser({ saved: 'ru', browserLanguage: 'en-US' }, locale => {
    assert.equal(locale.getLocale(), 'ru')
    assert.equal(locale.t('leaderboard'), 'Общий рейтинг')
  })
  await withBrowser({ saved: 'unsupported', url: 'https://runner.test/?lang=fr' }, locale => {
    assert.equal(locale.getLocale(), 'en')
  })
})

test('an explicit shared-link language takes priority and becomes the saved preference', async () => {
  for (const requested of ['en', 'ru']) {
    await withBrowser({ saved: requested === 'en' ? 'ru' : 'en', url: `https://runner.test/?lang=${requested}` }, (locale, browser) => {
      assert.equal(locale.getLocale(), requested)
      assert.equal(browser.values.get(languageKey), requested)
    })
  }
})

test('switching language removes only the link language seed, so reload keeps the explicit choice', async () => {
  await withBrowser({ saved: 'en', url: 'https://runner.test/game?lang=ru&from=share#controls' }, async (locale, browser) => {
    assert.equal(locale.getLocale(), 'ru')
    locale.setLocale('en')
    assert.equal(browser.location.href, 'https://runner.test/game?from=share#controls')
    assert.equal(browser.values.get(languageKey), 'en')
    assert.deepEqual(browser.replacements, [{ state: { navigation: 'preserve-me' }, title: '' }])
    assert.equal((await browser.reload()).getLocale(), 'en')
  })
})

test('denied storage still permits a Russian shared link and an in-page language switch', async () => {
  await withBrowser({ deniedStorage: true, url: 'https://runner.test/?lang=ru&from=share' }, (locale, browser) => {
    assert.equal(locale.getLocale(), 'ru')
    locale.setLocale('en')
    assert.equal(locale.getLocale(), 'en')
    assert.equal(locale.t('profile'), 'Profile')
    assert.equal(browser.location.search, '?from=share')
  })
  await withBrowser({ deniedStorage: true }, locale => {
    assert.equal(locale.getLocale(), 'en')
    locale.setLocale('ru')
    assert.equal(locale.t('profile'), 'Профиль')
  })
})

test('denied writes do not discard a valid saved language or prevent changing it for this page', async () => {
  await withBrowser({ saved: 'ru', deniedWrites: true }, locale => {
    assert.equal(locale.getLocale(), 'ru')
    locale.setLocale('en')
    assert.equal(locale.getLocale(), 'en')
  })
})

test('locale subscribers are notified once per change and can unsubscribe', async () => {
  await withBrowser({}, locale => {
    const changes = []
    const unsubscribe = locale.subscribeLocale(() => changes.push(locale.getLocale()))
    locale.setLocale('en')
    locale.setLocale('ru')
    locale.setLocale('ru')
    unsubscribe()
    locale.setLocale('en')
    assert.deepEqual(changes, ['ru'])
  })
})

test('document translation updates visible copy, accessibility labels and selected language without replacing input values', async () => {
  await withBrowser({}, locale => {
    const element = (attributes = {}, textContent = '') => ({
      attributes, textContent, value: 'Player nickname',
      dataset: { i18n: attributes['data-i18n'] },
      getAttribute(name) { return this.attributes[name] },
      setAttribute(name, value) { this.attributes[name] = value },
    })
    const text = element({ 'data-i18n': 'leaderboard' }, 'Leaderboard')
    const field = element({ 'data-i18n-aria-label': 'yourNickname' })
    const image = element({ 'data-i18n-alt': 'pickupBars' })
    const buttons = { 'language-en': element(), 'language-ru': element() }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const document = {
      documentElement: { lang: 'en' },
      querySelectorAll: selector => ({ '[data-i18n]': [text], '[data-i18n-aria-label]': [field], '[data-i18n-alt]': [image] })[selector],
      getElementById: id => buttons[id],
    }
    Object.defineProperty(globalThis, 'document', { value: document, configurable: true })
    try {
      locale.setLocale('ru')
      locale.applyDocumentLanguage()
      assert.equal(document.documentElement.lang, 'ru')
      assert.equal(text.textContent, 'Общий рейтинг')
      assert.equal(field.attributes['aria-label'], 'Твой ник')
      assert.equal(image.attributes.alt, 'Батончики Pump Bite')
      assert.equal(field.value, 'Player nickname')
      assert.equal(buttons['language-en'].attributes['aria-pressed'], 'false')
      assert.equal(buttons['language-ru'].attributes['aria-pressed'], 'true')
      locale.setLocale('en')
      locale.applyDocumentLanguage()
      assert.equal(text.textContent, 'Leaderboard')
      assert.equal(document.documentElement.lang, 'en')
    } finally {
      if (original) Object.defineProperty(globalThis, 'document', original)
      else delete globalThis.document
    }
  })
})

function literalDictionaries(relative) {
  const source = ts.createSourceFile(relative, readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const dictionaries = {}
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !['en', 'ru'].includes(declaration.name.text)) continue
      let literal = declaration.initializer
      if (literal && ts.isAsExpression(literal)) literal = literal.expression
      assert.ok(literal && ts.isObjectLiteralExpression(literal), `${relative}: ${declaration.name.text} must be a literal dictionary`)
      const entries = literal.properties.map(property => {
        assert.ok(ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer), `${relative}: expected a string translation`)
        return [property.name.text, property.initializer.text]
      })
      assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, `${relative}: duplicate translation keys`)
      dictionaries[declaration.name.text] = Object.fromEntries(entries)
    }
  }
  return dictionaries
}

test('core and online dictionaries have the same nonempty keys and interpolation placeholders in both languages', () => {
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort()
  for (const relative of ['i18n/messages.ts', 'online/messages.ts']) {
    const { en, ru } = literalDictionaries(relative)
    assert.ok(Object.keys(en).length > 20, `${relative}: dictionary should include the actual interface`)
    assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort(), relative)
    for (const [key, english] of Object.entries(en)) {
      assert.ok(english.trim() && ru[key].trim(), `${relative}: empty ${key}`)
      assert.doesNotMatch(english, /[А-Яа-яЁё]/u, `${relative}: English message ${key} contains Russian copy`)
      assert.deepEqual(placeholders(ru[key]), placeholders(english), `${relative}: placeholders differ for ${key}`)
    }
  }
})

test('HTML translation annotations refer to valid static keys without duplicate attributes or IDs, with an English baseline', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const { en } = literalDictionaries('i18n/messages.ts')
  const identifiers = new Set()
  let annotations = 0
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attributes = [...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)]
    const seen = new Set()
    for (const [, name, value] of attributes) {
      if (name.startsWith('data-i18n')) {
        assert.ok(['data-i18n', 'data-i18n-aria-label', 'data-i18n-alt'].includes(name), `Unsupported translation annotation ${name}`)
        assert.ok(!seen.has(name), `Duplicate ${name} annotation in ${tag}`)
        assert.ok(Object.hasOwn(en, value), `Unknown translation key ${value}`)
        assert.doesNotMatch(en[value], /\{\w+\}/, `Static annotation ${value} needs dynamic values`)
        annotations++
      }
      if (name === 'id') {
        assert.ok(!identifiers.has(value), `Duplicate HTML ID ${value}`)
        identifiers.add(value)
      }
      seen.add(name)
    }
  }
  assert.ok(annotations > 60, 'The whole interface should be annotated')
  assert.match(html, /<html lang="en">/)
  const russianEndonym = /<button\b[^>]*\bid="language-ru"[^>]*>Русский<\/button>/
  assert.match(html, russianEndonym)
  assert.doesNotMatch(html.replace(russianEndonym, ''), /[А-Яа-яЁё]/u, 'English HTML baseline contains untranslated Russian UI')
})

test('Russian counts use the correct forms and decimal formatting; English uses its own forms', async () => {
  await withBrowser({ saved: 'ru' }, locale => {
    assert.equal(locale.number(1234.5, 1), '1\u00a0234,5')
    assert.deepEqual([0, 1, 2, 5, 11, 21, 22, 25].map(locale.runCount), [
      '0 забегов', '1 забег', '2 забега', '5 забегов', '11 забегов', '21 забег', '22 забега', '25 забегов',
    ])
    assert.deepEqual([1, 2, 5, 11, 21].map(count => locale.pickupCount(count)), [
      '1 батончик', '2 батончика', '5 батончиков', '11 батончиков', '21 батончик',
    ])
    assert.deepEqual([1, 2, 5, 11, 21].map(count => locale.pickupCount(count, true)), [
      '1 бутылка', '2 бутылки', '5 бутылок', '11 бутылок', '21 бутылка',
    ])
    assert.equal(locale.t('newRecord', { distance: 120, unit: 'м' }), 'НОВЫЙ РЕКОРД\n120 м')
    locale.setLocale('en')
    assert.equal(locale.number(1234.5, 1), '1,234.5')
    assert.equal(locale.runCount(1), '1 run')
    assert.equal(locale.runCount(2), '2 runs')
    assert.equal(locale.pickupCount(1), '1 bar')
    assert.equal(locale.pickupCount(2), '2 bars')
    assert.equal(locale.pickupCount(1, true), '1 bottle')
  })
})
