import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sourceModuleUrl } from './source-module.mjs'

const { OnlineUI } = await import(sourceModuleUrl('online/OnlineUI.ts'))
const { setLocale } = await import(sourceModuleUrl('i18n/index.ts'))
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))

class Element {
  hidden = false
  value = ''
  textContent = ''
  disabled = false
  dataset = {}
  children = []
  events = new Map()
  attributes = new Map()
  classList = { add() {}, remove() {} }
  addEventListener(name, handler) { this.events.set(name, handler) }
  setAttribute(name, value) { this.attributes.set(name, value) }
  closest(selector) { return selector === '[hidden]' && this.hidden ? this : null }
  querySelectorAll() { return [] }
  replaceChildren() { this.children = [] }
  append(node) { this.children.push(node) }
  focus() { document.activeElement = this }
  select() { this.selected = true }
  setCustomValidity(value) { this.validity = value }
  reportValidity() {}
  fire(name, extra = {}) {
    return this.events.get(name)?.({ preventDefault() {}, stopPropagation() {}, ...extra })
  }
}

function setup(profile = null) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]))
  Object.assign(globalThis, {
    HTMLElement: Element,
    document: { activeElement: null, getElementById: id => nodes.get(id), createElement: () => new Element() },
    window: { location: { origin: 'https://example.test', href: 'https://example.test/', search: '' }, history: { state: null, replaceState() {} } },
  })
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  setLocale('en')
  const calls = []
  let listener = () => {}
  const client = {
    snapshot: { profile, leaderboard: null, pendingCount: 0, loading: false, error: null, status: null, storageAvailable: true },
    subscribe(callback) { listener = callback; return () => {} },
    async load() { calls.push('load') },
    async loadLeaderboard() { calls.push('leaderboard') },
    async saveNickname(nickname) {
      calls.push(['nickname', nickname])
      this.snapshot.profile = { ...this.snapshot.profile, id: this.snapshot.profile?.id ?? 'profile-a', nickname, participating: this.snapshot.profile?.participating ?? false }
      listener(this.snapshot)
    },
    async setParticipation(value) { calls.push(['participating', value]); this.snapshot.profile.participating = value; listener(this.snapshot) },
    async createShare(run) {
      calls.push(['share', run.runId])
      return { url: '/r/one', share: { ...run, id: 'one', nickname: this.snapshot.profile.nickname, publishedAt: '2026-10-19T12:00:00Z' } }
    },
    async generateRecoveryCode() { calls.push('generate'); return 'secret-recovery-code' },
    async recover(code) { calls.push(['recover', code]); this.snapshot.profile = { id: 'restored', nickname: 'Восстановлен', participating: true, best: null, hasRecoveryCode: true }; listener(this.snapshot) },
    async retryPending() { calls.push('retry') },
    emit() { listener(this.snapshot) },
  }
  const hooks = { openMenu() { calls.push('open') }, closeMenu() { calls.push('close') } }
  const ui = new OnlineUI(client, hooks)
  return { ui, client, calls, node: id => nodes.get(id) }
}

const run = { runId: 'new-run', ruleset: 'gainer-v0.6', metres: 1280, seconds: 100, bars: 3, maxSpeedKmh: 25 }
const profile = { id: 'profile-a', nickname: 'Пальзак', participating: false, best: null, hasRecoveryCode: true }

test('sharing asks for a nickname and never enables ranking; ready link and native sharing require separate clicks', async () => {
  const { ui, node, calls } = setup()
  let shared = null
  navigator.share = async value => { shared = value }
  ui.setCompletedRun(run)
  node('online-share-button').fire('click')
  await tick()
  assert.equal(node('online-profile-view').hidden, false)
  assert.equal(node('online-share-ready').hidden, true)
  node('online-nickname').value = 'Пальзак'
  node('online-nickname-form').fire('submit')
  await tick()
  assert.deepEqual(calls.filter(Array.isArray), [['nickname', 'Пальзак'], ['share', 'new-run']])
  assert.equal(node('online-share-ready').hidden, false)
  assert.equal(node('online-share-link').value, 'https://example.test/r/one')
  assert.equal(shared, null)
  node('online-share-native').fire('click')
  assert.equal(shared.url, 'https://example.test/r/one')
  assert.match(shared.text, /Пальзак/)
  assert.doesNotMatch(shared.text, /место|№/)
})

test('a known nickname publishes after initial loading and does not get stuck behind the loading state', async () => {
  const { ui, node, calls } = setup(profile)
  ui.setCompletedRun(run)
  node('online-share-button').fire('click')
  await tick()
  assert.equal(node('online-share-ready').hidden, false)
  assert.deepEqual(calls.filter(Array.isArray), [['share', 'new-run']])
})

test('ranking only activates after explicit nickname-and-participation submission', async () => {
  const { ui, node, calls } = setup()
  ui.setCompletedRun(run)
  node('online-join-button').fire('click')
  await tick()
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'participating'), false)
  assert.match(node('online-nickname-intent').textContent, /will be public/)
  node('online-nickname').value = 'Пальзак'
  node('online-nickname-form').fire('submit')
  await tick()
  assert.deepEqual(calls.filter(Array.isArray), [['nickname', 'Пальзак'], ['participating', true]])
})

test('recovery rotation and switching require confirmation, clear current share, and never expose secrets in the URL', async () => {
  const { ui, node, calls } = setup(profile)
  ui.setCompletedRun(run)
  ui.open('profile')
  await tick()
  node('online-recovery-generate').fire('click')
  assert.equal(calls.includes('generate'), false)
  assert.equal(node('online-recovery-replace').hidden, false)
  node('online-recovery-replace-confirm').fire('click')
  await tick()
  assert.equal(node('online-recovery-code').value, 'secret-recovery-code')
  node('online-recover-input').value = 'other-profile-code'
  node('online-recover-form').fire('submit')
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'recover'), false)
  node('online-recover-confirm').fire('click')
  await tick()
  assert.equal(node('online-run-actions').hidden, true)
  assert.equal(node('online-recovery-code').value, '')
  assert.equal(node('online-share-link').value, '')
})

test('clipboard failures select the visible value; native cancellation stays quiet; close restores focus and clears recovery code', async () => {
  const { ui, node } = setup(profile)
  navigator.share = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }
  node('online-share-button').focus()
  ui.setCompletedRun(run)
  node('online-share-button').fire('click')
  await tick()
  const readyMessage = node('online-status').textContent
  node('online-share-native').fire('click')
  await tick()
  assert.equal(node('online-status').textContent, readyMessage)
  node('online-share-copy').fire('click')
  await tick()
  assert.equal(node('online-share-link').selected, true)
  assert.match(node('online-status').textContent, /manually/)
  ui.close()
  assert.equal(document.activeElement, node('online-share-button'))
  assert.equal(node('online-recovery-code').value, '')
})

test('leaderboard nicknames render as text and own row is shown outside the top fifty', () => {
  const { ui, client, node } = setup(profile)
  const me = { playerId: 'profile-a', rank: 99, nickname: '<img src=x>', metres: 777, achievedAt: '2026-10-19T12:00:00Z' }
  client.snapshot.leaderboard = { entries: [{ ...me, playerId: 'another', rank: 1 }], me, total: 100 }
  client.emit()
  assert.equal(node('online-ranking-rows').children[0].children[1].textContent, '<img src=x>')
  assert.match(node('online-own-rank').textContent, /99/)
  assert.equal(node('online-own-rank').hidden, false)
  ui.close()
})

test('a profile replacement discovered through subscription clears old secrets, shares, and completed runs', async () => {
  for (const nextProfile of [{ ...profile, id: 'profile-b', nickname: 'Другой' }, null]) {
    const { ui, client, node, calls } = setup(profile)
    ui.setCompletedRun(run)
    node('online-share-button').fire('click')
    await tick()
    assert.equal(node('online-share-link').value, 'https://example.test/r/one')
    node('online-recovery-replace-confirm').fire('click')
    await tick()
    assert.equal(node('online-recovery-code').value, 'secret-recovery-code')
    node('online-recover-input').value = 'unsubmitted-secret'
    node('online-recover-form').fire('submit')
    node('online-recovery-generate').fire('click')
    client.snapshot.profile = nextProfile
    client.emit()
    assert.equal(node('online-recovery-code').value, '')
    assert.equal(node('online-recovery-result').hidden, true)
    assert.equal(node('online-share-link').value, '')
    assert.equal(node('online-share-section').hidden, true)
    assert.equal(node('online-run-actions').hidden, true)
    assert.equal(node('online-recover-input').value, '')
    assert.equal(node('online-recover-confirmation').hidden, true)
    assert.equal(node('online-recovery-replace').hidden, true)
    const count = calls.filter(call => Array.isArray(call) && call[0] === 'share').length
    node('online-share-button').fire('click')
    await tick()
    assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'share').length, count)
  }
})

test('delayed share and recovery responses cannot repopulate a replacement profile, even after switching back', async () => {
  for (const operation of ['share', 'recovery']) {
    const { ui, client, node } = setup(profile)
    ui.setCompletedRun(run)
    ui.open('profile')
    await tick()
    let finish
    const delayed = new Promise(resolve => { finish = resolve })
    if (operation === 'share') {
      client.createShare = () => delayed
      node('online-share-button').fire('click')
    } else {
      client.generateRecoveryCode = () => delayed
      node('online-recovery-replace-confirm').fire('click')
    }
    client.snapshot.profile = { ...profile, id: 'profile-b' }
    client.emit()
    client.snapshot.profile = profile
    client.emit()
    // An identical run ID after switching back still belongs to a newer identity epoch.
    ui.setCompletedRun(run)
    finish(operation === 'share'
      ? { url: '/r/old', share: { ...run, id: 'old', nickname: profile.nickname } }
      : 'old-profile-secret')
    await tick()
    assert.equal(node('online-share-link').value, '')
    assert.equal(node('online-recovery-code').value, '')
    assert.equal(node('online-share-ready').hidden, true)
    assert.equal(node('online-recovery-result').hidden, true)
  }
})

test('first guest creation during recovery-code generation can display its newly generated code', async () => {
  const { ui, client, node } = setup()
  ui.open('profile')
  await tick()
  client.generateRecoveryCode = async () => {
    client.snapshot.profile = { ...profile, hasRecoveryCode: true }
    client.emit()
    return 'first-profile-secret'
  }
  node('online-recovery-generate').fire('click')
  await tick()
  assert.equal(node('online-recovery-code').value, 'first-profile-secret')
  assert.equal(node('online-recovery-result').hidden, false)
})


test('switching an open profile translates its current intent without losing edited inputs or focus', async () => {
  const { ui, client, node, calls } = setup(profile)
  ui.setCompletedRun(run)
  node('online-join-button').fire('click')
  await tick()
  node('online-nickname').value = 'Draft Ник'
  node('online-nickname').focus()
  node('online-recover-input').value = 'unsubmitted-code'
  const requestCount = calls.length
  setLocale('ru')
  assert.equal(node('online-title').textContent, 'Профиль')
  assert.equal(node('online-nickname-save').textContent, 'Сохранить ник и участвовать')
  assert.match(node('online-nickname-intent').textContent, /будут видны всем/)
  assert.equal(node('online-nickname').value, 'Draft Ник')
  assert.equal(node('online-recover-input').value, 'unsubmitted-code')
  assert.equal(document.activeElement, node('online-nickname'))
  assert.equal(client.snapshot.profile.id, profile.id)
  assert.equal(calls.length, requestCount)
  setLocale('en')
  assert.equal(node('online-nickname-save').textContent, 'Save nickname and join')
  assert.equal(node('online-nickname').value, 'Draft Ник')
  assert.equal(calls.length, requestCount)
})

test('switching language updates existing status, public link and native share while keeping the snapshot and recovery code', async () => {
  const { ui, client, node, calls } = setup(profile)
  let shared
  navigator.share = async value => { shared = value }
  ui.setCompletedRun(run)
  node('online-share-button').fire('click')
  await tick()
  assert.equal(node('online-status').textContent, 'Your link is ready to share.')
  node('online-recovery-replace-confirm').fire('click')
  await tick()
  const requestCount = calls.length
  node('online-recovery-code').focus()
  setLocale('ru')
  assert.equal(node('online-status').textContent, 'Код создан. Сохраните его перед закрытием меню.')
  assert.equal(node('online-share-link').value, 'https://example.test/r/one?lang=ru')
  assert.equal(node('online-recovery-code').value, 'secret-recovery-code')
  assert.equal(document.activeElement, node('online-recovery-code'))
  assert.equal(node('online-share-ready').hidden, false)
  assert.equal(client.snapshot.profile.id, profile.id)
  assert.equal(calls.length, requestCount)
  node('online-share-native').fire('click')
  assert.equal(shared.url, 'https://example.test/r/one?lang=ru')
  assert.match(shared.text, /Пальзак пробежал/)
  setLocale('en')
  node('online-share-native').fire('click')
  assert.equal(shared.url, 'https://example.test/r/one')
  assert.match(shared.text, /Пальзак ran 1,280 m/)
  assert.doesNotMatch(shared.text, /пробежал|место/)
  assert.equal(node('online-recovery-code').value, 'secret-recovery-code')
})

test('loading, existing errors and nickname validation follow the new language without another request', async () => {
  const { ui, client, node, calls } = setup(profile)
  let finish
  client.load = () => new Promise(resolve => { finish = resolve })
  ui.open('profile')
  assert.equal(node('online-status').textContent, 'Loading…')
  setLocale('ru')
  assert.equal(node('online-status').textContent, 'Загрузка…')
  finish()
  await tick()
  client.generateRecoveryCode = async () => {
    calls.push('failed-generate')
    throw Object.assign(new Error('Секретная серверная ошибка'), { status: 400, code: 'invalid_recovery_code' })
  }
  node('online-recovery-replace-confirm').fire('click')
  await tick()
  assert.match(node('online-status').textContent, /Код восстановления не найден/)
  const count = calls.length
  setLocale('en')
  assert.match(node('online-status').textContent, /Recovery code not found/)
  assert.doesNotMatch(node('online-status').textContent, /[А-Яа-я]/)
  assert.equal(calls.length, count)
  node('online-nickname').value = '!'
  node('online-nickname-form').fire('submit')
  assert.match(node('online-nickname').validity, /Enter 2–24/)
  setLocale('ru')
  assert.match(node('online-nickname').validity, /Введите 2–24/)
  assert.equal(node('online-nickname').value, '!')
})

test('native required and length validation messages use the selected language and clear on input', async () => {
  const { ui, node, calls } = setup(profile)
  ui.open('profile')
  await tick()
  const count = calls.length
  node('online-nickname').value = ''
  node('online-nickname').fire('invalid')
  node('online-recover-input').value = ''
  node('online-recover-input').fire('invalid')
  assert.match(node('online-nickname').validity, /^Enter 2–24/)
  assert.equal(node('online-recover-input').validity, 'Enter your recovery code.')
  setLocale('ru')
  assert.match(node('online-nickname').validity, /^Введите 2–24/)
  assert.equal(node('online-recover-input').validity, 'Введите код восстановления.')
  assert.equal(calls.length, count)
  node('online-nickname').value = 'Valid'
  node('online-nickname').fire('input')
  node('online-recover-input').value = 'typed-code'
  node('online-recover-input').fire('input')
  assert.equal(node('online-nickname').validity, '')
  assert.equal(node('online-recover-input').validity, '')
  setLocale('en')
  assert.equal(node('online-nickname').validity, '')
  assert.equal(node('online-recover-input').validity, '')
  node('online-nickname').value = 'a'
  node('online-nickname').fire('invalid')
  assert.match(node('online-nickname').validity, /^Enter 2–24/)
})

test('closing the profile or replacing its identity clears old native validation errors', async () => {
  const { ui, client, node } = setup(profile)
  ui.open('profile')
  await tick()
  node('online-nickname').fire('invalid')
  node('online-recover-input').fire('invalid')
  ui.close()
  assert.equal(node('online-nickname').validity, '')
  assert.equal(node('online-recover-input').validity, '')
  ui.open('profile')
  await tick()
  node('online-nickname').fire('invalid')
  node('online-recover-input').fire('invalid')
  client.snapshot.profile = { ...profile, id: 'profile-b' }
  client.emit()
  assert.equal(node('online-nickname').validity, '')
  assert.equal(node('online-recover-input').validity, '')
  setLocale('ru')
  assert.equal(node('online-nickname').validity, '')
  assert.equal(node('online-recover-input').validity, '')
})
