import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceModuleUrl } from './source-module.mjs'

const { OnlineClient } = await import(sourceModuleUrl('online/OnlineClient.ts'))
const { setLocale } = await import(sourceModuleUrl('i18n/index.ts'))
const key = 'db-runner.online.v1'
const profile = (id = 'player-a', participating = true) => ({
  id, nickname: 'Пальзак', participating, best: null, hasRecoveryCode: false,
})
const run = (runId = 'run-a', metres = 70) => ({
  runId, ruleset: 'gainer-v0.6', metres, seconds: 10, bars: 0, maxSpeedKmh: 25,
})
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
function storage(data = {}) {
  const values = new Map(Object.entries(data))
  return { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), values }
}
function saved(player, pending = []) { return JSON.stringify({ version: 1, profile: player, pending }) }

test('offline completed runs survive reload and send only under their owning profile', async () => {
  const player = profile()
  const local = storage({ [key]: saved(player) })
  const offline = new OnlineClient({ storage: local, fetch: async () => { throw new Error('offline') } })
  offline.rememberCompletedRun(run())
  await assert.rejects(offline.retryPending())
  assert.equal(offline.snapshot.pendingCount, 1)
  assert.match(offline.snapshot.error, /saved on this device/)
  const calls = []
  const restarted = new OnlineClient({ storage: local, fetch: async (url, init) => {
    calls.push({ url, init })
    if (url === '/api/profile') return response({ profile: player })
    return response({ best: { metres: 70, achievedAt: '2026-10-19T00:00:00Z' } })
  } })
  await restarted.load()
  assert.equal(restarted.snapshot.pendingCount, 0)
  assert.equal(restarted.snapshot.profile.best.metres, 70)
  assert.equal(calls[1].init.headers['X-Profile-Id'], player.id)
  assert.equal(JSON.parse(calls[1].init.body).runId, 'run-a')
})

test('a new visitor does not create a guest or upload legacy local history', async () => {
  const calls = []
  const local = storage({ 'db-runner.gainer.history.v1': JSON.stringify({ best: 9999, results: [run()] }) })
  const client = new OnlineClient({ storage: local, fetch: async (url, init) => {
    calls.push([url, init.method])
    return response({ profile: null })
  } })
  await client.load()
  client.rememberCompletedRun(run())
  await client.retryPending()
  assert.deepEqual(calls, [['/api/profile', 'GET']])
  assert.equal(client.snapshot.pendingCount, 0)
})

test('sharing without leaderboard participation sends a snapshot without enabling or uploading runs', async () => {
  const player = profile('guest', false)
  const calls = []
  const client = new OnlineClient({ storage: storage({ [key]: saved(player) }), fetch: async (url, init) => {
    calls.push({ url, init })
    return response({ share: { id: 'share-id', nickname: player.nickname, metres: 70 }, url: '/r/share-id' })
  } })
  client.rememberCompletedRun(run())
  const result = await client.createShare(run())
  assert.equal(result.url, '/r/share-id')
  assert.equal(client.snapshot.profile.participating, false)
  assert.deepEqual(calls.map(item => item.url), ['/api/shares'])
  assert.equal(calls[0].init.headers['X-Profile-Id'], player.id)
})

test('explicit opt-in submits the just-completed run; opting out discards its queued submissions', async () => {
  let player = profile('guest', false)
  let failRuns = false
  const client = new OnlineClient({ storage: storage({ [key]: saved(player) }), fetch: async (url, init) => {
    if (url === '/api/profile') {
      player = { ...player, ...JSON.parse(init.body) }
      return response({ profile: player })
    }
    if (failRuns) throw new Error('offline')
    return response({ best: { metres: 70, achievedAt: '2026-10-19T00:00:00Z' } })
  } })
  client.rememberCompletedRun(run())
  await client.setParticipation(true)
  assert.equal(client.snapshot.profile.best.metres, 70)
  failRuns = true
  client.rememberCompletedRun(run('run-b', 80))
  await assert.rejects(client.retryPending())
  assert.equal(client.snapshot.pendingCount, 1)
  await client.setParticipation(false)
  assert.equal(client.snapshot.pendingCount, 0)
  assert.equal(client.snapshot.profile.participating, false)
})

test('recovery never reattributes old queued runs or the current completed run', async () => {
  const old = profile('old')
  const recovered = profile('recovered')
  const local = storage({ [key]: saved(old, [{ profileId: old.id, run: run('old-run') }]) })
  const calls = []
  const client = new OnlineClient({ storage: local, fetch: async (url, init) => {
    calls.push(url)
    if (url === '/api/profile/recover') return response({ profile: recovered })
    if (url === '/api/profile') return response({ profile: recovered })
    throw new Error(`Unexpected upload: ${url} ${init.body}`)
  } })
  // This run was not opted-in and must not be offered to the recovered identity.
  client.rememberCompletedRun(null)
  await client.recover('SECRET-CODE')
  await client.setParticipation(true)
  assert.deepEqual(calls, ['/api/profile/recover', '/api/profile'])
  assert.equal(client.snapshot.pendingCount, 0)
  assert.equal(JSON.parse(local.getItem(key)).pending[0].profileId, 'old')
  assert.doesNotMatch(local.getItem(key), /SECRET-CODE/)
})

test('stale-tab profile rejection retains the queue and never retries under a different identity', async () => {
  const client = new OnlineClient({ storage: storage({ [key]: saved(profile()) }), fetch: async () =>
    response({ error: 'Profile changed', code: 'PROFILE_CHANGED' }, 409) })
  client.rememberCompletedRun(run())
  await assert.rejects(client.retryPending())
  assert.equal(client.snapshot.pendingCount, 1)
  assert.equal(client.snapshot.profile.id, 'player-a')
  assert.match(client.snapshot.error, /another tab/)
})

test('storage failure keeps online actions usable in memory and never persists recovery secrets', async () => {
  const player = profile('new', false)
  const client = new OnlineClient({
    storage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } },
    fetch: async url => response(url === '/api/profile/recovery-code' ? { code: 'SECRET-ONE-TIME' } : { profile: player }),
  })
  await client.saveNickname(player.nickname)
  assert.equal(client.snapshot.storageAvailable, false)
  assert.equal(await client.generateRecoveryCode(), 'SECRET-ONE-TIME')
  assert.equal(client.snapshot.profile.hasRecoveryCode, true)
  assert.doesNotMatch(JSON.stringify(client.snapshot), /SECRET-ONE-TIME/)
})

test('one flush handles new completions arriving while the previous request is in flight', async () => {
  const sent = []
  let finishFirst
  const first = new Promise(resolve => { finishFirst = resolve })
  const client = new OnlineClient({ storage: storage({ [key]: saved(profile()) }), fetch: async (_url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body.runId)
    if (body.runId === 'first') await first
    return response({ best: { metres: body.metres, achievedAt: '2026-10-19T00:00:00Z' } })
  } })
  client.rememberCompletedRun(run('first', 70))
  client.rememberCompletedRun(run('second', 80))
  finishFirst()
  await client.retryPending()
  assert.deepEqual(sent, ['first', 'second'])
  assert.equal(client.snapshot.pendingCount, 0)
})

test('many shorter offline runs cannot evict the strongest pending record', async () => {
  const local = storage({ [key]: saved(profile()) })
  const client = new OnlineClient({ storage: local, fetch: async () => { throw new Error('offline') } })
  client.rememberCompletedRun(run('record', 2000))
  await assert.rejects(client.retryPending())
  for (let i = 0; i < 30; i += 1) client.rememberCompletedRun(run(`short-${i}`, 100))
  await assert.rejects(client.retryPending())
  const pending = JSON.parse(local.getItem(key)).pending
  assert.equal(pending.length, 1)
  assert.equal(pending[0].run.metres, 2000)
})

test('a delayed profile GET cannot undo successful recovery', async () => {
  const before = profile('before', false)
  const after = profile('after', false)
  let resolveGet
  const delayed = new Promise(resolve => { resolveGet = resolve })
  const client = new OnlineClient({ storage: storage({ [key]: saved(before) }), fetch: async url =>
    url === '/api/profile' ? delayed : response({ profile: after }) })
  const loading = client.load()
  await client.recover('RECOVERY-CODE')
  resolveGet(response({ profile: before }))
  await loading
  assert.equal(client.snapshot.profile.id, after.id)
})

test('observing another-tab profile change clears the remembered finished run before opt-in', async () => {
  const before = profile('before', false)
  const after = profile('after', false)
  const calls = []
  const client = new OnlineClient({ storage: storage({ [key]: saved(before) }), fetch: async (url, init) => {
    calls.push([url, init.method])
    if (url !== '/api/profile') throw new Error(`Old run must not upload: ${url}`)
    return response({ profile: init.method === 'PATCH' ? { ...after, participating: true } : after })
  } })
  client.rememberCompletedRun(run('belongs-to-before'))
  await client.load()
  await client.setParticipation(true)
  assert.deepEqual(calls, [['/api/profile', 'GET'], ['/api/profile', 'PATCH']])
})

test('recovery succeeds independently of an older profile upload failing in flight', async () => {
  const before = profile('before')
  const after = profile('after')
  let finishUpload
  const delayed = new Promise(resolve => { finishUpload = resolve })
  const client = new OnlineClient({ storage: storage({ [key]: saved(before) }), fetch: async url =>
    url === '/api/runs' ? delayed : response({ profile: after }) })
  client.rememberCompletedRun(run())
  const oldUpload = client.retryPending()
  await client.recover('RECOVERY-CODE')
  assert.equal(client.snapshot.profile.id, after.id)
  finishUpload(response({ error: 'Profile changed', code: 'PROFILE_CHANGED' }, 409))
  await assert.rejects(oldUpload)
  await client.retryPending()
  assert.equal(client.snapshot.error, null)
  assert.equal(client.snapshot.profile.id, after.id)
})

test('overlapping profile reads apply only the newest request even when the old response arrives first', async () => {
  const before = profile('before', false)
  const after = profile('after', false)
  const resolvers = []
  const client = new OnlineClient({ storage: storage({ [key]: saved(before) }), fetch: () =>
    new Promise(resolve => { resolvers.push(resolve) }) })
  const firstLoad = client.load()
  const secondLoad = client.load()
  resolvers[0](response({ profile: before }))
  await firstLoad
  resolvers[1](response({ profile: after }))
  await secondLoad
  assert.equal(client.snapshot.profile.id, after.id)
})

test('an older best-score response cannot invalidate a newer read of another profile', async () => {
  const before = profile('before')
  const after = profile('after', false)
  let finishUpload, finishGet
  const upload = new Promise(resolve => { finishUpload = resolve })
  const read = new Promise(resolve => { finishGet = resolve })
  const client = new OnlineClient({ storage: storage({ [key]: saved(before) }), fetch: url =>
    url === '/api/runs' ? upload : read })
  client.rememberCompletedRun(run())
  const flushing = client.retryPending()
  const loading = client.load()
  finishUpload(response({ best: { metres: 70, achievedAt: '2026-10-19T00:00:00Z' } }))
  await flushing
  finishGet(response({ profile: after }))
  await loading
  assert.equal(client.snapshot.profile.id, after.id)
})


test('a pending offline explanation translates in place without retrying or changing its owner', async () => {
  setLocale('en')
  let requests = 0
  const client = new OnlineClient({ storage: storage({ [key]: saved(profile()) }), fetch: async () => {
    requests++
    throw new Error('offline')
  } })
  client.rememberCompletedRun(run())
  await assert.rejects(client.retryPending())
  assert.match(client.snapshot.error, /saved on this device/)
  const count = requests
  setLocale('ru')
  assert.match(client.snapshot.error, /сохранён на устройстве/)
  assert.equal(client.snapshot.profile.id, 'player-a')
  assert.equal(client.snapshot.pendingCount, 1)
  assert.equal(requests, count)
  setLocale('en')
  assert.match(client.snapshot.error, /saved on this device/)
  assert.equal(requests, count)
})

test('API error codes localize safely and unknown server messages never leak into the interface', async () => {
  const cases = [
    ['invalid_recovery_code', 400, /Recovery code not found/, /Код восстановления не найден/],
    ['PROFILE_CHANGED', 409, /another tab/, /другой вкладке/],
    ['rate_limited', 429, /Too many requests/, /Слишком много запросов/],
    ['unrecognized_code', 400, /Could not complete this request/, /Не удалось выполнить запрос/],
    ['internal_error', 500, /temporarily unavailable/, /временно недоступен/],
  ]
  for (const [code, status, english, russian] of cases) {
    setLocale('en')
    let requests = 0
    const client = new OnlineClient({ storage: storage(), fetch: async () => {
      requests++
      return response({ error: 'Непереведённая серверная ошибка', code }, status)
    } })
    await assert.rejects(client.load())
    assert.match(client.snapshot.error, english)
    assert.doesNotMatch(client.snapshot.error, /[А-Яа-я]/)
    setLocale('ru')
    assert.match(client.snapshot.error, russian)
    assert.doesNotMatch(client.snapshot.error, /Непереведённая/)
    assert.equal(requests, 1)
  }
  setLocale('en')
})

test('existing success messages translate without mutating profile or creating another guest', async () => {
  setLocale('en')
  let requests = 0
  const client = new OnlineClient({ storage: storage(), fetch: async () => {
    requests++
    return response({ profile: profile('new', false) })
  } })
  await client.saveNickname('Пальзак')
  const current = client.snapshot.profile
  assert.equal(client.snapshot.status, 'Nickname saved.')
  setLocale('ru')
  assert.equal(client.snapshot.status, 'Ник сохранён.')
  assert.equal(client.snapshot.profile, current)
  assert.equal(client.snapshot.profile.nickname, 'Пальзак')
  assert.equal(requests, 1)
  setLocale('en')
})
