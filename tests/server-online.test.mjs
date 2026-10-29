import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApp } from '../.server-build/server/app.js'

const ruleset = 'gainer-v0.6'
const run = (metres = 100, extra = {}) => ({ runId: randomUUID(), ruleset, metres,
  seconds: metres * 3.6 / 25, bars: 0, maxSpeedKmh: 25, ...extra })

async function fixture(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dbr-online-'))
  const dbPath = join(directory, 'online.sqlite')
  const staticDir = join(directory, 'dist')
  await mkdir(staticDir)
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>runner</title>')
  await writeFile(join(directory, 'secret.txt'), 'private file')
  const app = createApp({ dbPath, staticDir, rateLimits: false, ...config })
  await new Promise((accept, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', accept)
  })
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const api = async (path, { method = 'GET', data, cookie, id, headers = {}, raw } = {}) => {
    const response = await fetch(origin + path, { method, headers: {
      ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), ...(id ? { 'X-Profile-Id': id } : {}), ...headers,
    }, ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    return { response, status: response.status, body, text,
      cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const player = async (name = 'Пальзак') => {
    const result = await api('/api/profile', { method: 'POST', data: { nickname: name } })
    assert.equal(result.status, 201)
    return { cookie: result.cookie, id: result.body.profile.id, profile: result.body.profile }
  }
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }) })
  return { app, directory, dbPath, staticDir, origin, api, player }
}

test('profiles are lazy, same nicknames stay separate, and only the current session can mutate', async t => {
  const { app, api, player } = await fixture(t)
  assert.deepEqual((await api('/api/profile')).body, { profile: null })
  assert.equal(Number(app.database.sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get().n), 0)
  const first = await player()
  const second = await player()
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.cookie, second.cookie)
  assert.equal((await api('/api/profile', { cookie: first.cookie })).body.profile.nickname, 'Пальзак')
  const auth = { method: 'PATCH', cookie: first.cookie, id: first.id }
  assert.equal((await api('/api/profile', { ...auth, data: { participating: true } })).status, 200)
  assert.equal((await api('/api/profile', { ...auth, data: { nickname: 'Новый ник' } })).status, 200)
  assert.equal((await api('/api/profile', { cookie: second.cookie })).body.profile.nickname, 'Пальзак')
  assert.equal((await api('/api/profile', { method: 'PATCH', data: { nickname: 'Чужой' }, id: first.id })).status, 401)
  assert.equal((await api('/api/profile', { method: 'PATCH', cookie: `dbr_session=${first.id}`, id: first.id,
    data: { nickname: 'Чужой' } })).status, 401)
  const stale = await api('/api/profile', { ...auth, id: second.id, data: { nickname: 'Чужой' } })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'PROFILE_CHANGED')
  assert.equal((await api('/api/profile', { method: 'PATCH', cookie: first.cookie, data: { nickname: 'Чужой' } })).status, 409)
  assert.equal((await api('/api/profile', { ...auth, data: { playerId: second.id, nickname: 'Чужой' } })).status, 400)
  assert.equal((await api('/api/profile', { method: 'POST', cookie: first.cookie, data: { nickname: 'Старая вкладка' } })).body.profile.nickname, 'Новый ник')
  assert.equal((await api('/api/profile', { ...auth, data: { nickname: '<script>' } })).status, 400)
  const anonymous = await api('/api/profile', { method: 'POST' })
  assert.equal(anonymous.body.profile.nickname, null)
  assert.equal((await api('/api/profile', { method: 'PATCH', cookie: anonymous.cookie,
    id: anonymous.body.profile.id, data: { participating: true } })).status, 400)
})

test('same-origin JSON mutations are required and secrets are only in protected cookies', async t => {
  const { api, player, app } = await fixture(t, { secureCookies: true })
  assert.equal((await api('/api/profile', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await api('/api/profile', { method: 'POST', headers: { Origin: '' } })).status, 403)
  assert.equal((await api('/api/profile', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415)
  const result = await api('/api/profile', { method: 'POST', data: { nickname: 'Guest' } })
  const cookie = result.response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /Max-Age=31536000/)
  assert.doesNotMatch(result.text, /token|recovery_hash|session/i)
  const rawToken = result.cookie.split('=')[1]
  assert.equal(rawToken.length, 43)
  const stored = app.database.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash
  assert.notEqual(rawToken, stored)
  await player('Other')
})

test('best results are monotonic, idempotent, whole-metre ties retain earliest achievement, and opt-out retains best', async t => {
  let now = Date.parse('2026-10-19T10:00:00Z')
  const { api, player } = await fixture(t, { now: () => now })
  const first = await player('Первый')
  const second = await player('Второй')
  const submit = (p, result) => api('/api/runs', { method: 'POST', ...p, data: result })
  const participate = (p, value) => api('/api/profile', { method: 'PATCH', ...p, data: { participating: value } })
  assert.equal((await submit(first, run())).status, 409)
  await participate(first, true)
  await participate(second, true)
  const original = run(100.2)
  const accepted = await submit(first, original)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.best.metres, 100)
  now += 1000
  assert.deepEqual((await submit(first, original)).body, accepted.body)
  assert.deepEqual((await submit(first, run(50))).body, accepted.body)
  assert.deepEqual((await submit(first, run(100.9))).body, accepted.body)
  assert.equal((await submit(first, { ...original, metres: 100.3 })).status, 409)
  await submit(second, run(100.9))
  let board = (await api('/api/leaderboard', first)).body
  assert.deepEqual(board.entries.map(row => row.playerId), [first.id, second.id])
  assert.equal(board.me.rank, 1)
  assert.equal(board.total, 2)
  now += 1000
  const improved = await submit(first, run(150))
  assert.equal(improved.body.best.metres, 150)
  assert.notEqual(improved.body.best.achievedAt, accepted.body.best.achievedAt)
  await participate(first, false)
  board = (await api('/api/leaderboard', first)).body
  assert.equal(board.total, 1)
  assert.equal(board.me, null)
  assert.equal((await api('/api/profile', first)).body.profile.best.metres, 150)
  await participate(first, true)
  assert.equal((await api('/api/leaderboard', first)).body.me.metres, 150)
})

test('leaderboard limits public rows to 50 and returns the authenticated player outside the top', async t => {
  const { api, player } = await fixture(t)
  let lowest
  for (let index = 0; index < 53; index++) {
    const p = await player(`Игрок ${index}`)
    if (index === 0) lowest = p
    await api('/api/profile', { method: 'PATCH', ...p, data: { participating: true } })
    assert.equal((await api('/api/runs', { method: 'POST', ...p, data: run(100 + index) })).status, 200)
  }
  const board = (await api('/api/leaderboard', lowest)).body
  assert.equal(board.total, 53)
  assert.equal(board.entries.length, 50)
  assert.equal(board.entries[0].metres, 152)
  assert.equal(board.me.rank, 53)
  assert.equal(board.me.playerId, lowest.id)
  assert.equal((await api('/api/leaderboard')).body.me, null)
})

test('sharing is independent of opt-in, immutable and idempotent, with a safe public result page', async t => {
  const { api, player, app, staticDir, origin } = await fixture(t)
  const p = await player('Original')
  const result = run(123)
  const published = await api('/api/shares', { method: 'POST', ...p, data: { run: result } })
  assert.equal(published.status, 200)
  assert.match(published.body.url, /^\/r\/[a-zA-Z0-9_-]{22}$/)
  assert.equal((await api('/api/profile', p)).body.profile.participating, false)
  assert.equal((await api('/api/leaderboard')).body.total, 0)
  await api('/api/profile', { method: 'PATCH', ...p, data: { nickname: 'Renamed', participating: true } })
  await api('/api/runs', { method: 'POST', ...p, data: run(200) })
  const again = await api('/api/shares', { method: 'POST', ...p, data: { run: result } })
  assert.deepEqual(again.body, published.body)
  assert.equal((await api('/api/shares', { method: 'POST', ...p, data: { run: { ...result, metres: 124 } } })).status, 409)
  assert.equal((await api('/api/runs', { method: 'POST', ...p, data: { ...result, metres: 124 } })).status, 409)
  const id = published.body.share.id
  const publicResult = await api(`/api/shares/${id}`)
  assert.equal(publicResult.body.share.nickname, 'Original')
  assert.equal(publicResult.body.share.metres, 123)
  assert.doesNotMatch(publicResult.text, /playerId|token|runId|recovery/i)
  const page = await api(published.body.url)
  assert.equal(page.status, 200)
  assert.match(page.text, /Original/)
  assert.match(page.text, /123 m/)
  assert.match(page.text, /href="\/\?lang=en"/)
  assert.equal(page.response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(page.response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await api('/r/aaaaaaaaaaaaaaaaaaaaaa')).status, 404)
  assert.equal((await api('/api/shares/aaaaaaaaaaaaaaaaaaaaaa')).status, 404)
  // Defense in depth for historical/imported nicknames that bypass today's validation.
  app.database.sqlite.prepare('UPDATE shared_runs SET nickname = ? WHERE id = ?').run('<img src=x onerror=alert(1)>"', id)
  const escaped = await api(published.body.url)
  assert.doesNotMatch(escaped.text, /<img src=x/)
  assert.match(escaped.text, /&lt;img src=x onerror=alert\(1\)&gt;&quot;/)
  assert.equal((await api('/')).status, 200)
  await symlink(join(staticDir, '..', 'secret.txt'), join(staticDir, 'escape.txt'))
  assert.equal((await api('/escape.txt')).status, 404)
  assert.equal((await api('/.env')).status, 404)
  assert.equal((await api('/%2e%2e%2fsecret.txt')).status, 404)
  const rawPathStatus = await new Promise((accept, reject) => {
    const request = httpRequest(origin + '/', { path: '/../secret.txt' }, response => { response.resume(); accept(response.statusCode) })
    request.once('error', reject)
    request.end()
  })
  assert.equal(rawPathStatus, 404)
  await writeFile(join(staticDir, 'track.mp3'), '0123456789')
  const range = await fetch(origin + '/track.mp3', { headers: { Range: 'bytes=2-5' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(range.headers.get('accept-ranges'), 'bytes')
  assert.equal(await range.text(), '2345')
  const suffix = await fetch(origin + '/track.mp3', { headers: { Range: 'bytes=-3' } })
  assert.equal(await suffix.text(), '789')
  assert.equal((await fetch(origin + '/track.mp3', { headers: { Range: 'bytes=99-' } })).status, 416)
  const head = await fetch(origin + '/track.mp3', { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), '10')
  assert.equal(await head.text(), '')
})

test('public run links default to English and preserve the selected language without changing the snapshot', async t => {
  const now = Date.parse('2026-10-19T10:00:00Z')
  const { api, player } = await fixture(t, { now: () => now })
  const p = await player('Original')
  const published = await api('/api/shares', { method: 'POST', ...p, data: { run: run(123) } })
  const path = published.body.url
  const english = await api(path, { headers: { 'Accept-Language': 'ru-RU' } })
  assert.equal(english.status, 200)
  assert.equal(english.response.headers.get('content-language'), 'en')
  assert.match(english.text, /<html lang="en">/)
  assert.match(english.text, /<title>Original ran 123 m — D&amp;B Runner<\/title>/)
  assert.match(english.text, /content="Original ran 123 m in D&amp;B Runner\. Can you go further\?"/)
  assert.match(english.text, /Completed run/)
  assert.match(english.text, /0 bars · 17 s/)
  assert.match(english.text, /Top speed 25\.0 km\/h/)
  assert.match(english.text, /Published 19 October 2026/)
  assert.match(english.text, /href="\/\?lang=en">Give it a go<\/a>/)
  assert.match(english.text, new RegExp(`href="${path}\\?lang=ru" lang="ru">Русский`))
  assert.match(english.text, /lang="en" aria-current="page">English/)
  assert.doesNotMatch(english.text.replace(/<nav[\s\S]*?<\/nav>/, ''), /[А-Яа-яЁё]/)

  const russian = await api(`${path}?lang=ru`)
  assert.equal(russian.response.headers.get('content-language'), 'ru')
  assert.match(russian.text, /<html lang="ru">/)
  assert.match(russian.text, /<title>Original пробежал 123 м — D&amp;B Runner<\/title>/)
  assert.match(russian.text, /Завершённый забег/)
  assert.match(russian.text, /0 батончиков · 17 с/)
  assert.match(russian.text, /Максимальная скорость 25,0 км\/ч/)
  assert.match(russian.text, /Опубликовано 19 октября 2026 г\./)
  assert.match(russian.text, /href="\/\?lang=ru">Попробовать<\/a>/)
  assert.match(russian.text, new RegExp(`href="${path}\\?lang=en" lang="en">English`))
  assert.match(russian.text, /lang="ru" aria-current="page">Русский/)
  assert.doesNotMatch(russian.text, /Completed run|Top speed|Published|Give it a go/)
  assert.equal((await api(`${path}?lang=unsupported`)).text, english.text)
  assert.equal((await api(`${path}?lang=en`)).text, english.text)
  assert.deepEqual((await api(`/api/shares/${published.body.share.id}`)).body.share, published.body.share)
})

test('missing and malformed public run links show a localized recoverable 404', async t => {
  const { api } = await fixture(t)
  for (const path of ['/r/aaaaaaaaaaaaaaaaaaaaaa', '/r/malformed']) {
    const english = await api(path)
    assert.equal(english.status, 404)
    assert.match(english.response.headers.get('content-type'), /text\/html/)
    assert.equal(english.response.headers.get('content-language'), 'en')
    assert.match(english.text, /<html lang="en">/)
    assert.match(english.text, /<h1>Run not found<\/h1>/)
    assert.match(english.text, /This link may have been removed\./)
    assert.match(english.text, /href="\/\?lang=en">Play D&amp;B Runner/)
    assert.doesNotMatch(english.text.replace(/<nav[\s\S]*?<\/nav>/, ''), /[А-Яа-яЁё]/)
    const russian = await api(`${path}?lang=ru`)
    assert.equal(russian.status, 404)
    assert.equal(russian.response.headers.get('content-language'), 'ru')
    assert.match(russian.text, /<html lang="ru">/)
    assert.match(russian.text, /<h1>Забег не найден<\/h1>/)
    assert.match(russian.text, /Возможно, ссылка была удалена\./)
    assert.match(russian.text, /href="\/\?lang=ru">Играть в D&amp;B Runner/)
    assert.doesNotMatch(russian.text, /Run not found|This link|Play D&B Runner/)
  }
})

test('recovery rotates a hashed high-entropy code, creates a fresh session, and never merges profiles', async t => {
  const { api, player, app } = await fixture(t)
  const owner = await player('Owner')
  const other = await player('Other')
  await api('/api/profile', { method: 'PATCH', ...owner, data: { participating: true } })
  await api('/api/runs', { method: 'POST', ...owner, data: run(250) })
  const firstCode = (await api('/api/profile/recovery-code', { method: 'POST', ...owner })).body.code
  assert.match(firstCode, /^(?:[A-F0-9]{5}-){7}[A-F0-9]{5}$/)
  const code = (await api('/api/profile/recovery-code', { method: 'POST', ...owner })).body.code
  assert.notEqual(firstCode, code)
  const hash = app.database.sqlite.prepare('SELECT recovery_hash FROM profiles WHERE id = ?').get(owner.id).recovery_hash
  assert.notEqual(hash, code.replaceAll('-', ''))
  assert.equal((await api('/api/profile/recover', { method: 'POST', data: { code: firstCode } })).status, 400)
  assert.equal((await api('/api/profile/recover', { method: 'POST', data: { code: 'wrong' } })).status, 400)
  const recovered = await api('/api/profile/recover', { method: 'POST', cookie: other.cookie, data: { code: code.toLowerCase().replaceAll('-', ' ') } })
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.profile.id, owner.id)
  assert.equal(recovered.body.profile.best.metres, 250)
  assert.equal(recovered.body.profile.hasRecoveryCode, true)
  assert.equal(recovered.body.profile.participating, true)
  assert.notEqual(recovered.cookie, owner.cookie)
  assert.equal((await api('/api/profile', other)).body.profile.id, other.id)
  assert.equal((await api('/api/profile', owner)).body.profile.id, owner.id)
  const stale = await api('/api/runs', { method: 'POST', cookie: recovered.cookie, id: other.id, data: run(300) })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'PROFILE_CHANGED')
  const publicProfile = await api('/api/profile', { cookie: recovered.cookie })
  assert.doesNotMatch(publicProfile.text, /recovery_hash|token|[A-F0-9]{5}-/)
})

test('bounded JSON and rule checks reject malformed, non-finite, incompatible and implausible submissions', async t => {
  const { api, player } = await fixture(t)
  const p = await player()
  await api('/api/profile', { method: 'PATCH', ...p, data: { participating: true } })
  const options = { method: 'POST', ...p }
  for (const invalid of [run(-1), run(100, { seconds: -1 }), run(100, { maxSpeedKmh: null }),
    run(100, { bars: 0.5 }), run(100, { maxSpeedKmh: 30 }), run(100, { ruleset: 'old' }),
    run(100, { seconds: 86401 }), run(100, { bars: 5000 }), run(100000, { seconds: 1 }),
    run(0, { seconds: 100 }), run(100, { runId: 'short' }), run(100, { metres: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.equal((await api('/api/runs', { ...options, data: invalid })).status, 400, JSON.stringify(invalid))
  }
  assert.equal((await api('/api/runs', { ...options, raw: JSON.stringify(run()).replace('"metres":100', '"metres":1e999') })).status, 400)
  assert.equal((await api('/api/profile', { method: 'POST', raw: '{' })).status, 400)
  assert.equal((await api('/api/profile', { method: 'POST', data: [] })).status, 400)
  assert.equal((await api('/api/profile', { method: 'POST', data: { nickname: 'A'.repeat(9000) } })).status, 413)
  // Uncapped game progression remains valid well above ordinary runner speeds.
  assert.equal((await api('/api/runs', { ...options, data: run(100000, {
    seconds: 100, bars: 200, maxSpeedKmh: 25 * 1.15 ** 40,
  }) })).status, 200)
})

test('rate limits recover after expiry and forwarded IPs are untrusted by default', async t => {
  let now = Date.now()
  const { api } = await fixture(t, { now: () => now, rateLimits: { create: { limit: 1, windowMs: 1000 },
    recover: { limit: 2, windowMs: 1000 } } })
  assert.equal((await api('/api/profile', { method: 'POST', headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 201)
  const limited = await api('/api/profile', { method: 'POST', headers: { 'X-Forwarded-For': '2.2.2.2' } })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.code, 'rate_limited')
  assert.ok(limited.response.headers.get('retry-after'))
  now += 1001
  assert.equal((await api('/api/profile', { method: 'POST' })).status, 201)
  for (let count = 0; count < 2; count++) assert.equal((await api('/api/profile/recover', { method: 'POST', data: { code: 'bad' } })).status, 400)
  assert.equal((await api('/api/profile/recover', { method: 'POST', data: { code: 'bad' } })).status, 429)
})

test('explicit deployment origin, proxy trust and session expiry have predictable boundaries', async t => {
  let now = Date.now()
  const { api } = await fixture(t, { now: () => now, publicOrigin: 'https://runner.example', trustProxyHops: 1,
    rateLimits: { create: { limit: 1, windowMs: 1000 } } })
  assert.equal((await api('/api/profile', { method: 'POST' })).status, 403)
  const first = await api('/api/profile', { method: 'POST', data: { nickname: 'First' },
    headers: { Origin: 'https://runner.example', 'X-Forwarded-For': '1.1.1.1' } })
  assert.equal(first.status, 201)
  assert.equal((await api('/api/profile', { method: 'POST', data: { nickname: 'Second' },
    headers: { Origin: 'https://runner.example', 'X-Forwarded-For': '2.2.2.2' } })).status, 201)
  const recovery = await api('/api/profile/recovery-code', { method: 'POST', cookie: first.cookie,
    id: first.body.profile.id, headers: { Origin: 'https://runner.example' } })
  assert.equal(recovery.status, 200)
  now += 365 * 86_400_000 + 1
  assert.equal((await api('/api/profile', { cookie: first.cookie })).body.profile, null)
  const restored = await api('/api/profile/recover', { method: 'POST', data: { code: recovery.body.code },
    headers: { Origin: 'https://runner.example' } })
  assert.equal(restored.body.profile.id, first.body.profile.id)
  assert.throws(() => createApp({ dbPath: ':memory:', publicOrigin: 'https://example.com/path' }), /origin/)
  assert.throws(() => createApp({ dbPath: ':memory:', trustProxyHops: -1 }), /trustProxyHops/)
})

test('database survives server restart and admin backup/moderation work against WAL safely', async t => {
  const { api, player, app, dbPath, directory } = await fixture(t)
  const p = await player('Persistent')
  await api('/api/profile', { method: 'PATCH', ...p, data: { participating: true } })
  const result = run(400)
  await api('/api/runs', { method: 'POST', ...p, data: result })
  const shared = await api('/api/shares', { method: 'POST', ...p, data: { run: result } })
  const backupPath = join(directory, 'backup.sqlite')
  const cli = (...args) => spawnSync(process.execPath, [resolve('.server-build/server/admin.js'), ...args], {
    env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
  })
  const copied = cli('backup', backupPath)
  assert.equal(copied.status, 0, copied.stderr)
  assert.ok((await readFile(backupPath)).length > 0)
  assert.equal(cli('backup', backupPath).status, 1)
  const backup = new DatabaseSync(backupPath)
  assert.equal(backup.prepare('SELECT metres FROM bests').get().metres, 400)
  backup.close()
  await app.close()
  const reopened = createApp({ dbPath, rateLimits: false })
  t.after(() => reopened.close())
  assert.equal(reopened.database.profile(p.id).best.metres, 400)
  assert.equal(reopened.database.playerForSession(p.cookie.split('=')[1]), p.id)
  assert.equal(reopened.database.share(shared.body.share.id).nickname, 'Persistent')
  assert.equal(cli('delete-best', p.id).status, 0)
  assert.equal(reopened.database.profile(p.id).best, null)
  assert.equal(cli('delete-share', shared.body.share.id).status, 0)
  assert.equal(reopened.database.share(shared.body.share.id), null)
})
