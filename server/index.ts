import { resolve } from 'node:path'
import { createApp } from './app.js'

const production = process.env.NODE_ENV === 'production'
const publicOrigin = process.env.PUBLIC_ORIGIN
if (production && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production (for example https://dbr.adavid.ru)')
if (production && new URL(publicOrigin!).protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use HTTPS in production')
const port = Number(process.env.PORT ?? 3000)
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be between 1 and 65535')
const app = createApp({
  dbPath: resolve(process.env.DB_PATH ?? 'data/online.sqlite'),
  staticDir: resolve(process.env.STATIC_DIR ?? 'dist'),
  ...(publicOrigin ? { publicOrigin } : {}),
  secureCookies: production || process.env.SECURE_COOKIES === '1',
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
  onError: error => console.error('Online request failed:', error instanceof Error ? error.message : 'unknown error'),
})

app.server.listen(port, process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`D&B Runner listening on port ${port}`)
})

let stopping = false
function stop(): void {
  if (stopping) return
  stopping = true
  const timeout = setTimeout(() => { app.server.closeAllConnections() }, 8_000)
  timeout.unref()
  void app.close().then(() => { clearTimeout(timeout); process.exitCode = 0 }, error => {
    clearTimeout(timeout)
    console.error('Server shutdown failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
