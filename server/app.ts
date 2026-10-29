import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import type { SharedRun } from '../src/online/contracts.js'
import { localeTag, type Locale } from '../src/i18n/locale.js'
import { publicMessages } from './publicMessages.js'
import { OnlineDatabase } from './database.js'
import { ApiError, escapeHtml, nickname, object, runSubmission } from './validation.js'

export type RateScope = 'api' | 'create' | 'recover' | 'recoveryCode' | 'write' | 'share'
export interface RatePolicy { limit: number; windowMs: number }
export interface AppConfig {
  dbPath: string
  staticDir?: string
  publicOrigin?: string
  secureCookies?: boolean
  /** Number of trusted reverse proxy hops. Zero ignores all forwarded headers. */
  trustProxyHops?: number
  now?: () => number
  /** Overridable for deterministic isolated tests. Production uses the defaults. */
  rateLimits?: false | Partial<Record<RateScope, RatePolicy>>
  onError?: (error: unknown) => void
}

const COOKIE = 'dbr_session'
const BODY_LIMIT = 8 * 1024
const DEFAULT_RATES: Record<RateScope, RatePolicy> = {
  api: { limit: 600, windowMs: 60_000 },
  create: { limit: 12, windowMs: 3_600_000 },
  recover: { limit: 12, windowMs: 900_000 },
  recoveryCode: { limit: 12, windowMs: 3_600_000 },
  write: { limit: 120, windowMs: 60_000 },
  share: { limit: 30, windowMs: 60_000 },
}

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; expires: number }>()
  private nextCleanup = 0

  constructor(private readonly now: () => number, private readonly rates: AppConfig['rateLimits']) {}

  take(ip: string, scope: RateScope): void {
    if (this.rates === false) return
    const now = this.now()
    if (now >= this.nextCleanup) {
      for (const [key, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(key)
      this.nextCleanup = now + 60_000
    }
    const policy = this.rates?.[scope] ?? DEFAULT_RATES[scope]
    const key = `${scope}:${ip}`
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.expires <= now) {
      if (!bucket && this.buckets.size >= 10_000) throw new ApiError(429, 'Слишком много запросов. Повторите позже.', 'rate_limited')
      bucket = { count: 0, expires: now + policy.windowMs }
      this.buckets.set(key, bucket)
    }
    if (++bucket.count > policy.limit) throw new ApiError(429, 'Слишком много запросов. Повторите позже.', 'rate_limited')
  }
}

function headers(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function text(response: ServerResponse, value: string, status: number, type = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  response.end(value)
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) {
    request.resume()
    throw new ApiError(415, 'Используйте application/json.', 'unsupported_content_type')
  }
  const declared = request.headers['content-length']
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) {
    request.resume()
    throw new ApiError(413, 'Запрос слишком большой.', 'body_too_large')
  }
  const raw = await new Promise<string>((accept, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    function cleanup(): void {
      request.off('data', data)
      request.off('end', end)
      request.off('error', error)
      request.off('aborted', aborted)
    }
    function error(cause: Error): void { cleanup(); reject(cause) }
    function aborted(): void { cleanup(); reject(new ApiError(400, 'Передача запроса прервана.')) }
    function data(chunk: Buffer): void {
      size += chunk.length
      if (size > BODY_LIMIT) {
        cleanup()
        request.resume()
        reject(new ApiError(413, 'Запрос слишком большой.', 'body_too_large'))
      } else chunks.push(chunk)
    }
    function end(): void { cleanup(); accept(Buffer.concat(chunks).toString('utf8')) }
    request.on('data', data)
    request.on('end', end)
    request.on('error', error)
    request.on('aborted', aborted)
  })
  try { return JSON.parse(raw) as unknown } catch { throw new ApiError(400, 'Некорректный JSON.') }
}

function sessionCookie(request: IncomingMessage): string | undefined {
  return request.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
}

function setSession(response: ServerResponse, value: string, secure: boolean): void {
  response.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? '; Secure' : ''}`)
}

const PUBLIC_PAGE_STYLE = `
  :root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:14px;background:#090611;color:#f6eafc}
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}
  main{width:min(100%,480px);border:1px solid #3c294b;background:#130d1c;padding:clamp(24px,6vw,48px);border-radius:0;overflow-wrap:anywhere}
  p{line-height:1.6;color:#bea4cc}.brand{letter-spacing:.14em;font-size:1rem;color:#ffc175}
  h1{font-size:clamp(24px,5vw,32px);margin:24px 0 8px}.distance{font-size:clamp(48px,12vw,72px);font-weight:800;color:#ffc175;line-height:1.15;margin:8px 0 20px}
  a{display:flex;min-height:44px;align-items:center;justify-content:center;text-decoration:none;font-size:1rem;font-weight:800;border:1px solid #3c294b;border-radius:0;padding:10px 12px}
  a:hover{background:#d78aed;color:#090611}a:active{transform:translateY(1px)}a:focus-visible{outline:3px solid #ffc175;outline-offset:3px}
  .play{background:#ffc175;color:#090611;margin-top:28px;border-color:#ffc175}.languages{display:flex;gap:8px;margin-top:24px}.languages a{flex:1;color:#bea4cc}.languages a[aria-current="page"]{color:#ffc175;border-color:#ffc175}.languages a:hover{color:#090611}
  time{font-size:1rem}
`

function languageLinks(path: string, locale: Locale): string {
  const copy = publicMessages(locale)
  return `<nav class="languages" aria-label="${copy.language}">${(['en', 'ru'] as const).map(value =>
    `<a href="${escapeHtml(path)}?lang=${value}" lang="${value}"${locale === value ? ' aria-current="page"' : ''}>${value === 'en' ? 'English' : 'Русский'}</a>`).join('')}</nav>`
}

function publicCard(share: SharedRun, locale: Locale, origin?: string): string {
  const copy = publicMessages(locale)
  const tag = localeTag(locale)
  const distance = Math.floor(share.metres).toLocaleString(tag)
  const values = { nickname: share.nickname, distance }
  const title = escapeHtml(copy.format('title', values))
  const description = escapeHtml(copy.format('description', values))
  const path = `/r/${share.id}`
  const url = `${path}?lang=${locale}`
  const canonical = origin ? `<link rel="canonical" href="${escapeHtml(origin + url)}"><meta property="og:url" content="${escapeHtml(origin + url)}">` : ''
  const date = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
    .format(new Date(share.publishedAt))
  const seconds = Math.floor(share.seconds).toLocaleString(tag)
  const speed = share.maxSpeedKmh.toLocaleString(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">${canonical}<meta name="robots" content="noindex"><style>${PUBLIC_PAGE_STYLE}</style></head><body><main><p class="brand">D&amp;B RUNNER</p><h1>${escapeHtml(share.nickname)}</h1><p>${copy.completedRun}</p><div class="distance">${copy.format('distance', { distance })}</div><p>${copy.barCount(share.bars)} · ${copy.format('seconds', { seconds })}<br>${copy.format('peakSpeed', { speed })}</p><p><time datetime="${escapeHtml(share.publishedAt)}">${escapeHtml(copy.format('published', { date }))}</time></p><a class="play" href="/?lang=${locale}">${copy.play}</a>${languageLinks(path, locale)}</main></body></html>`
}

function publicCardNotFound(path: string, locale: Locale): string {
  const copy = publicMessages(locale)
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(copy.notFoundTitle)}</title><style>${PUBLIC_PAGE_STYLE}</style></head><body><main><p class="brand">D&amp;B RUNNER</p><h1>${copy.notFoundHeading}</h1><p>${copy.notFoundDescription}</p><a class="play" href="/?lang=${locale}">${escapeHtml(copy.playAgain)}</a>${languageLinks(path, locale)}</main></body></html>`
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' }

async function staticFile(request: IncomingMessage, response: ServerResponse, path: string, directory?: string): Promise<void> {
  if (!directory) { text(response, 'Not found', 404); return }
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { text(response, 'Not found', 404); return }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) {
    text(response, 'Not found', 404); return
  }
  const root = resolve(directory)
  const candidate = resolve(root, decoded === '/' ? 'index.html' : `.${decoded}`)
  if (!candidate.startsWith(root + sep)) { text(response, 'Not found', 404); return }
  try {
    const [actualRoot, actual] = await Promise.all([realpath(root), realpath(candidate)])
    if (!actual.startsWith(actualRoot + sep)) { text(response, 'Not found', 404); return }
    const information = await stat(actual)
    if (!information.isFile()) { text(response, 'Not found', 404); return }
    const extension = extname(actual).toLowerCase()
    let start = 0
    let end = information.size - 1
    const range = request.headers.range
    if (range) {
      const parts = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!parts || (!parts[1] && !parts[2])) {
        response.writeHead(416, { 'Content-Range': `bytes */${information.size}` }); response.end(); return
      }
      start = parts[1] ? Number(parts[1]) : Math.max(0, information.size - Number(parts[2]))
      end = parts[1] && parts[2] ? Math.min(Number(parts[2]), end) : end
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= information.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${information.size}` }); response.end(); return
      }
    }
    response.writeHead(range ? 206 : 200, { 'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${information.size}` } : {}),
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600' })
    if (request.method === 'HEAD') { response.end(); return }
    const stream = createReadStream(actual, range ? { start, end } : {})
    stream.on('error', () => response.destroy())
    response.on('close', () => stream.destroy())
    stream.pipe(response)
  } catch { text(response, 'Not found', 404) }
}

export function createApp(config: AppConfig) {
  const now = config.now ?? Date.now
  const publicUrl = config.publicOrigin ? new URL(config.publicOrigin) : undefined
  if (publicUrl && (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password ||
      publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash)) {
    throw new Error('publicOrigin must be an HTTP(S) origin without a path, credentials, query or fragment')
  }
  const origin = publicUrl?.origin
  const proxyHops = config.trustProxyHops ?? 0
  if (!Number.isSafeInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
    throw new Error('trustProxyHops must be an integer from 0 to 10')
  }
  const database = new OnlineDatabase(config.dbPath, now)
  const limiter = new RateLimiter(now, config.rateLimits)

  function ip(request: IncomingMessage): string {
    if (proxyHops) {
      const forwarded = request.headers['x-forwarded-for']
      const chain = (typeof forwarded === 'string' ? forwarded : '').split(',').map(value => value.trim()).filter(Boolean)
      if (chain.length >= proxyHops) return chain[chain.length - proxyHops]!.slice(0, 80)
    }
    return request.socket.remoteAddress ?? 'unknown'
  }

  function mutation(request: IncomingMessage): void {
    const expected = origin ?? `http://${request.headers.host}`
    if (request.headers.origin !== expected || request.headers['sec-fetch-site'] === 'cross-site') {
      request.resume()
      throw new ApiError(403, 'Запрос разрешён только с сайта игры.', 'origin_required')
    }
  }

  function requireProfile(request: IncomingMessage, playerId: string | null): string {
    if (!playerId) throw new ApiError(401, 'Профиль не найден. Откройте настройки профиля.', 'unauthorized')
    if (request.headers['x-profile-id'] !== playerId) {
      throw new ApiError(409, 'Профиль изменился в другой вкладке. Обновите профиль.', 'PROFILE_CHANGED')
    }
    return playerId
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (path === '/health' && (method === 'GET' || method === 'HEAD')) { text(response, 'ok', 200); return }
    if (path.startsWith('/api/')) {
      const address = ip(request)
      limiter.take(address, 'api')
      if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') throw new ApiError(405, 'Метод не поддерживается.')
      if (method === 'POST' || method === 'PATCH') mutation(request)
      const playerId = database.playerForSession(sessionCookie(request))

      if (path === '/api/profile' && method === 'GET') {
        json(response, { profile: playerId ? database.profile(playerId) : null }); return
      }
      if (path === '/api/profile' && method === 'POST') {
        const values = object(await body(request), ['nickname'])
        const name = values.nickname === undefined ? undefined : nickname(values.nickname)
        if (playerId) {
          // Repeated lazy creation is harmless; an explicit matching profile header permits updates.
          const profile = name && request.headers['x-profile-id'] === playerId
            ? database.updateProfile(playerId, { nickname: name }) : database.profile(playerId)
          json(response, { profile }); return
        }
        limiter.take(address, 'create')
        const result = database.createProfile(name)
        setSession(response, result.sessionToken, config.secureCookies ?? false)
        json(response, { profile: result.profile }, 201); return
      }
      if (path === '/api/profile' && method === 'PATCH') {
        const id = requireProfile(request, playerId)
        limiter.take(address, 'write')
        const values = object(await body(request), ['nickname', 'participating'])
        if (values.participating !== undefined && typeof values.participating !== 'boolean') throw new ApiError(400, 'Некорректное участие в рейтинге.')
        const profile = database.updateProfile(id, { ...(values.nickname === undefined ? {} : { nickname: nickname(values.nickname) }),
          ...(values.participating === undefined ? {} : { participating: values.participating }) })
        json(response, { profile }); return
      }
      if (path === '/api/leaderboard' && method === 'GET') { json(response, database.leaderboard(playerId)); return }
      if (path === '/api/runs' && method === 'POST') {
        const id = requireProfile(request, playerId)
        limiter.take(address, 'write')
        const run = runSubmission(await body(request))
        json(response, { best: database.submit(id, run) }); return
      }
      if (path === '/api/shares' && method === 'POST') {
        const id = requireProfile(request, playerId)
        limiter.take(address, 'share')
        const values = object(await body(request), ['run'])
        const share = database.publish(id, runSubmission(values.run))
        json(response, { share, url: `/r/${share.id}` }); return
      }
      const shareMatch = /^\/api\/shares\/([a-zA-Z0-9_-]{22})$/.exec(path)
      if (shareMatch && method === 'GET') {
        const share = database.share(shareMatch[1]!)
        if (!share) throw new ApiError(404, 'Забег не найден.', 'not_found')
        json(response, { share }); return
      }
      if (path === '/api/profile/recovery-code' && method === 'POST') {
        const id = requireProfile(request, playerId)
        limiter.take(address, 'recoveryCode')
        object(await body(request), [])
        json(response, { code: database.rotateRecovery(id) }); return
      }
      if (path === '/api/profile/recover' && method === 'POST') {
        limiter.take(address, 'recover')
        const values = object(await body(request), ['code'])
        if (typeof values.code !== 'string' || values.code.length > 100) throw new ApiError(400, 'Введите код восстановления.', 'invalid_recovery_code')
        const result = database.recover(values.code)
        setSession(response, result.sessionToken, config.secureCookies ?? false)
        json(response, { profile: result.profile }); return
      }
      throw new ApiError(404, 'Не найдено.', 'not_found')
    }
    if (method !== 'GET' && method !== 'HEAD') { text(response, 'Method not allowed', 405); return }
    const shareMatch = /^\/r\/([a-zA-Z0-9_-]{22})$/.exec(path)
    if (shareMatch || path === '/r' || path.startsWith('/r/')) {
      const locale = url.searchParams.get('lang') === 'ru' ? 'ru' : 'en'
      const share = shareMatch ? database.share(shareMatch[1]!) : null
      response.setHeader('Content-Language', locale)
      if (!share) { text(response, publicCardNotFound(path, locale), 404, 'text/html; charset=utf-8'); return }
      text(response, publicCard(share, locale, origin), 200, 'text/html; charset=utf-8'); return
    }
    await staticFile(request, response, path, config.staticDir)
  }

  const server = createServer((request, response) => {
    headers(response)
    void route(request, response).catch(error => {
      request.resume()
      if (response.headersSent) { response.destroy(); return }
      if (error instanceof ApiError) {
        if (error.status === 429) response.setHeader('Retry-After', '60')
        json(response, { error: error.message, code: error.code }, error.status)
      } else {
        config.onError?.(error)
        json(response, { error: 'Сервис временно недоступен.', code: 'internal_error' }, 500)
      }
    })
  })
  server.requestTimeout = 20_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 1_000
  let closed = false
  return {
    server,
    database,
    close: (): Promise<void> => new Promise((accept, reject) => {
      if (closed) { accept(); return }
      closed = true
      server.close(error => {
        database.close()
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else accept()
      })
    }),
  }
}
