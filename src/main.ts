import './styles.css'
import { Game } from './game/Game'
import { resolvePlayerArt } from './game/Player'
import { RunUI } from './game/RunUI'
import { OnlineClient } from './online/OnlineClient'
import { OnlineUI } from './online/OnlineUI'
import { ONLINE_RULESET } from './online/contracts'
import { applyDocumentLanguage, setLocale, subscribeLocale } from './i18n'

const DOUBLE_TAP_DELAY = 350

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

function preventViewportZoom(): void {
  let previousTouchEnd = 0

  document.addEventListener(
    'touchend',
    (event) => {
      if (event.changedTouches.length !== 1) return

      const now = performance.now()
      if (now - previousTouchEnd <= DOUBLE_TAP_DELAY) event.preventDefault()
      previousTouchEnd = now
    },
    { passive: false },
  )

  const preventGesture = (event: Event): void => event.preventDefault()
  document.addEventListener('gesturestart', preventGesture, { passive: false })
  document.addEventListener('gesturechange', preventGesture, { passive: false })
  document.addEventListener('gestureend', preventGesture, { passive: false })
}

preventViewportZoom()
applyDocumentLanguage()
subscribeLocale(applyDocumentLanguage)
for (const locale of ['en', 'ru'] as const) {
  getElement<HTMLButtonElement>(`#language-${locale}`).addEventListener('click', () => setLocale(locale))
}

const online = new OnlineClient()
let game: Game
const onlineUI = new OnlineUI(online, {
  openMenu: () => game.openOnlineMenu(),
  closeMenu: () => game.closeOnlineMenu(),
})

game = new Game(
  getElement<HTMLCanvasElement>('#game-canvas'),
  getElement<HTMLElement>('#game-stage'),
  getElement<HTMLElement>('#game-status'),
  getElement<HTMLElement>('#overlay-eyebrow'),
  getElement<HTMLElement>('#overlay-title'),
  getElement<HTMLElement>('#overlay-hint'),
  getElement<HTMLButtonElement>('#resume-button'),
  getElement<HTMLButtonElement>('#pause-button'),
  getElement<HTMLElement>('#pause-icon'),
  getElement<HTMLButtonElement>('#sound-button'),
  getElement<HTMLElement>('#sound-icon'),
  getElement<HTMLInputElement>('#pause-volume-slider'),
  getElement<HTMLElement>('#volume-value'),
  resolvePlayerArt(window.location.search),
  undefined,
  new RunUI(),
  {
    onRunFinished: (result) => {
      const run = {
        runId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
        ruleset: ONLINE_RULESET,
        metres: result.metres, seconds: result.seconds,
        bars: result.bars, maxSpeedKmh: result.maxSpeedKmh ?? 25,
      }
      onlineUI.setCompletedRun(run)
      online.rememberCompletedRun(run)
    },
    onRunStarted: () => {
      onlineUI.setCompletedRun(null)
      online.rememberCompletedRun(null)
    },
    onCloseMenu: () => onlineUI.close(),
  },
)

void online.load().catch(() => { /* Online availability never blocks gameplay. */ })
window.addEventListener('online', () => { void online.load().catch(() => {}) })
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void online.load().catch(() => {})
})
