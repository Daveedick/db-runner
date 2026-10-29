import { AudioManager } from './AudioManager'
import { GymEnvironment } from './GymEnvironment'
import { RioEnvironment } from './RioEnvironment'
import { InputManager } from './Input'
import { Player } from './Player'
import { GainerCourse } from './GainerCourse'
import { GainerRun } from './GainerRun'
import { RunHistory } from './RunHistory'
import type { RunResult } from './RunHistory'
import type { RunUI } from './RunUI'
import type { PlayerArt, RunnerVariant } from './Player'
import type { GameSize, GameState, InputAction } from './types'
import { number, pickupCount, subscribeLocale, t } from '../i18n'

interface CanvasViewport {
  width: number
  height: number
  scale: number
  offsetX: number
  offsetY: number
  pixelRatio: number
}

export interface GameOnlineHooks {
  onRunFinished: (result: RunResult) => void
  onRunStarted: () => void
  onCloseMenu: () => void
}

const LOGICAL_WIDTH = 640
const LOGICAL_HEIGHT = 360
const MAX_DELTA_TIME = 1 / 20
const COLLISION_FLASH_TIME = 0.12

export class Game {
  get worldSpeed(): number { return this.run.speed }

  private readonly context: CanvasRenderingContext2D
  private readonly player: Player
  private readonly audio = new AudioManager()
  private readonly courses: Partial<Record<RunnerVariant, GainerCourse>>
  private readonly runs = { classic: new GainerRun(), diesel: new GainerRun() }
  private readonly histories = { classic: new RunHistory(), diesel: new RunHistory(undefined, 'korona') }
  private get course(): GainerCourse {
    return this.courses[this.runnerVariant] ??= new GainerCourse(this.groundY, () => this.render(), Math.random, 'korona')
  }
  private get run(): GainerRun { return this.runs[this.runnerVariant] }
  private get history(): RunHistory { return this.histories[this.runnerVariant] }
  private statisticsOpen = false
  private onlineMenuOpen = false
  private readonly records = { classic: false, diesel: false }
  private readonly previousBests = { classic: 0, diesel: 0 }
  private get newRecord(): boolean { return this.records[this.runnerVariant] }
  private set newRecord(value: boolean) { this.records[this.runnerVariant] = value }
  private readonly savedMotion: Partial<Record<RunnerVariant, ReturnType<Player['captureMotion']>>> = {}
  private readonly started = { classic: false, diesel: false }
  private readonly resizeObserver: ResizeObserver
  private readonly gym = new GymEnvironment(() => this.render())
  private rio: RioEnvironment | null = null

  private state: GameState = 'paused'
  private hasStarted = false
  private runnerVariant: RunnerVariant = 'classic'
  private readonly size: GameSize = { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }
  private viewport: CanvasViewport = {
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pixelRatio: 1,
  }
  private animationFrame: number | null = null
  private previousTime = 0
  private collisionFlashTime = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stage: HTMLElement,
    private readonly status: HTMLElement,
    private readonly overlayEyebrow: HTMLElement,
    private readonly overlayTitle: HTMLElement,
    private readonly overlayHint: HTMLElement,
    private readonly resumeButton: HTMLButtonElement,
    private readonly pauseButton: HTMLButtonElement,
    private readonly pauseIcon: HTMLElement,
    private readonly soundButton: HTMLButtonElement,
    private readonly soundIcon: HTMLElement,
    private readonly volumeSlider: HTMLInputElement,
    private readonly volumeValue: HTMLElement,
    playerArt: PlayerArt = 'legacy',
    private readonly runnerButtons?: Record<RunnerVariant, HTMLButtonElement>,
    private readonly runUI?: RunUI,
    private readonly online?: GameOnlineHooks,
  ) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is not supported in this browser.')
    this.context = context
    this.player = new Player(() => this.render(), playerArt)
    this.courses = {
      classic: new GainerCourse(this.groundY, () => this.render()),
    }

    new InputManager(stage, this.handleInput, () => this.state === 'playing', () => true, this.handleAudioGesture)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(stage)

    resumeButton.addEventListener('click', this.resume)
    pauseButton.addEventListener('click', this.togglePause)
    soundButton.addEventListener('click', this.toggleSound)
    volumeSlider.addEventListener('input', this.changeVolume)
    runnerButtons?.classic.addEventListener('click', () => this.selectRunner('classic'))
    runnerButtons?.diesel.addEventListener('click', () => this.selectRunner('diesel'))
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    runUI?.statisticsButton.addEventListener('click', this.openStatistics)
    runUI?.backButton.addEventListener('click', this.closeStatistics)
    subscribeLocale(() => this.syncUI())

    this.player.reset(this.groundY)
    this.syncUI()
    this.resize()
    // Some browsers already allow sound; rejected autoplay is retried on a gesture.
    this.playMusic()
  }

  private get groundY(): number {
    return this.size.height - 56
  }

  private get environment(): GymEnvironment | RioEnvironment {
    if (this.runnerVariant === 'classic') return this.gym
    // Avoid fetching Rio artwork until the user chooses Korona.
    return this.rio ??= new RioEnvironment(() => this.render())
  }

  private readonly handleInput = (action: InputAction): void => {
    if (this.onlineMenuOpen) {
      if (action === 'pause') this.online?.onCloseMenu()
      return
    }
    if (this.statisticsOpen) {
      if (action === 'pause') this.closeStatistics()
      return
    }
    if (action === 'pause') {
      if (this.state === 'playing') this.pause()
      return
    }

    // A late jump at the fatal obstacle must leave the completed run visible.
    if (this.state === 'gameover') return

    if (this.state !== 'playing') {
      this.resume()
    }

    if (this.state === 'playing') this.player.jump()
  }

  private readonly togglePause = (): void => {
    if (this.state === 'gameover') return
    if (this.state === 'playing') this.pause()
    else this.resume()
  }

  private readonly resume = (): void => {
    if (this.state === 'playing' || this.statisticsOpen || this.onlineMenuOpen || document.hidden) return
    const startingRun = !this.hasStarted || this.state === 'gameover'
    if (this.state === 'gameover') {
      this.run.reset()
      this.course.reset()
      this.player.reset(this.groundY)
      this.collisionFlashTime = 0
      this.newRecord = false
    }

    this.hasStarted = true
    if (startingRun) this.online?.onRunStarted()
    this.state = 'playing'
    // Hidden menu buttons must not retain focus and swallow subsequent jump keys.
    this.resumeButton.blur()
    this.pauseButton.blur()
    this.previousTime = performance.now()
    this.syncUI()
    this.audio.selectTrack(this.runnerVariant === 'classic' ? 'gainer' : 'corona')
    if (startingRun) this.audio.resetTrack(this.runnerVariant === 'classic' ? 'gainer' : 'corona')
    this.playMusic()
    this.animationFrame = requestAnimationFrame(this.loop)
  }

  private readonly pause = (): void => {
    if (this.state !== 'playing') return

    this.state = 'paused'
    this.player.clearJumpBuffer()
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.showMenuMusic()
    this.syncUI()
    this.render()
  }

  private readonly toggleSound = (): void => {
    this.audio.toggleMute()
    this.syncSoundUI()
    this.handleAudioGesture()
  }

  private selectRunner(variant: RunnerVariant): void {
    // The shipped menu currently exposes only Gainer. Retain the dormant mode for a later return.
    if (!this.runnerButtons || this.state === 'playing' || this.statisticsOpen || this.onlineMenuOpen || variant === this.runnerVariant) return
    this.savedMotion[this.runnerVariant] = this.player.captureMotion()
    this.started[this.runnerVariant] = this.hasStarted
    this.runnerVariant = variant
    this.player.setVariant(variant)
    const motion = this.savedMotion[variant]
    if (motion) this.player.restoreMotion(motion)
    else this.player.reset(this.groundY)
    this.hasStarted = this.started[variant]
    this.state = this.run.finished ? 'gameover' : 'paused'
    this.collisionFlashTime = 0
    this.syncUI()
    this.render()
  }

  private syncRunnerUI(): void {
    this.runnerButtons?.classic.setAttribute('aria-pressed', String(this.runnerVariant === 'classic'))
    this.runnerButtons?.diesel.setAttribute('aria-pressed', String(this.runnerVariant === 'diesel'))
  }

  private readonly changeVolume = (event: Event): void => {
    const slider = event.currentTarget
    if (!(slider instanceof HTMLInputElement)) return

    this.audio.setVolume(Number(slider.value))
    this.syncSoundUI()
    this.handleAudioGesture()
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.pause()
      // Already-paused menus also need to become silent when hidden.
      this.audio.pause()
    }
  }

  private readonly handleAudioGesture = (): void => {
    if (document.hidden) return
    this.playMusic()
  }

  private playMusic(): void {
    if (!document.hidden) void this.audio.play()
  }

  private showMenuMusic(): void {
    this.audio.selectTrack('menu')
    this.audio.resetTrack('menu')
    this.playMusic()
  }

  private readonly loop = (time: number): void => {
    if (this.state !== 'playing') return

    const deltaTime = Math.min((time - this.previousTime) / 1_000, MAX_DELTA_TIME)
    this.previousTime = time

    this.update(deltaTime)
    this.render()
    if (this.state === 'playing') this.animationFrame = requestAnimationFrame(this.loop)
  }

  private update(deltaTime: number): void {
    const speed = this.worldSpeed
    this.player.update(deltaTime, this.groundY)
    this.collisionFlashTime = Math.max(0, this.collisionFlashTime - deltaTime)

    this.run.update(deltaTime, speed)
    const result = this.course.update(deltaTime, speed, this.player.collisionBox)
    this.run.bars += result.bars
    if (result.bars > 0) this.audio.playPickup()
    if (result.hit && this.run.hit()) {
      this.collisionFlashTime = COLLISION_FLASH_TIME
      if (this.run.finished) this.finishRun()
    }
    this.updateRunUI()

    this.environment.update(deltaTime, speed)
  }

  private render(): void {
    const { width, height, pixelRatio } = this.viewport
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    this.context.clearRect(0, 0, width, height)

    this.applyWorldTransform()
    const { offsetX, offsetY, scale } = this.viewport
    this.environment.render(this.context, {
      left: -offsetX / scale,
      top: -offsetY / scale,
      right: (width - offsetX) / scale,
      bottom: (height - offsetY) / scale,
    }, this.groundY)
    this.course.render(this.context)
    this.context.save()
    if (this.run.invulnerability > 0 && !this.run.finished) {
      this.context.globalAlpha = 0.5
    }
    this.player.render(this.context, this.size, this.state === 'playing')
    this.context.restore()
    this.course.renderFeedback(this.context, this.player.collisionBox)

    if (this.collisionFlashTime > 0) {
      this.context.fillStyle = 'rgba(255, 107, 107, 0.08)'
      this.context.fillRect(0, 0, this.size.width, this.size.height)
    }
  }

  private applyWorldTransform(): void {
    const { scale, offsetX, offsetY, pixelRatio } = this.viewport
    this.context.setTransform(
      pixelRatio * scale,
      0,
      0,
      pixelRatio * scale,
      pixelRatio * offsetX,
      pixelRatio * offsetY,
    )
  }

  private readonly resize = (): void => {
    const bounds = this.stage.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3)
    const scale = Math.min(bounds.width / LOGICAL_WIDTH, bounds.height / LOGICAL_HEIGHT)
    this.viewport = {
      width: bounds.width,
      height: bounds.height,
      scale,
      offsetX: (bounds.width - LOGICAL_WIDTH * scale) / 2,
      offsetY: (bounds.height - LOGICAL_HEIGHT * scale) / 2,
      pixelRatio,
    }

    this.canvas.width = Math.round(bounds.width * pixelRatio)
    this.canvas.height = Math.round(bounds.height * pixelRatio)
    this.canvas.style.width = `${bounds.width}px`
    this.canvas.style.height = `${bounds.height}px`

    if (this.player.isGrounded) this.player.reset(this.groundY)
    this.render()
  }

  private syncUI(): void {
    const isPlaying = this.state === 'playing'
    this.stage.dataset.gameState = this.state
    this.stage.dataset.variant = this.runnerVariant
    this.stage.dataset.newRecord = String(this.state === 'gameover' && this.newRecord)
    this.stage.classList.toggle('is-playing', isPlaying)
    this.status.textContent = t(isPlaying ? 'running' : 'pausedStatus')
    this.pauseIcon.textContent = isPlaying ? 'Ⅱ' : '▶'
    this.pauseButton.setAttribute('aria-label', t(isPlaying ? 'pauseGame' : 'resumeGame'))
    this.pauseButton.disabled = this.state === 'gameover'

    if (this.state === 'gameover') {
      this.overlayEyebrow.textContent = t('complete')
      this.status.textContent = t(this.newRecord ? 'recordStatus' : 'complete')
      this.pauseButton.setAttribute('aria-label', t('newRun'))
      const metres = Math.floor(this.run.distance)
      const previousBest = this.previousBests[this.runnerVariant]
      this.overlayTitle.textContent = this.newRecord ? t('newRecord', { distance: number(metres), unit: t('metre') }) : t('complete')
      const congratulations = previousBest > 0
        ? t('recordGain', { distance: number(metres - previousBest), unit: t('metre') })
        : t('firstRecord')
      this.overlayHint.textContent = `${this.newRecord ? `${congratulations}\n` : ''}${number(metres)} ${t('metre')} · ${pickupCount(this.run.bars, this.runnerVariant !== 'classic')} · ${number(Math.floor(this.run.seconds))}${t('second')}\n${t('maxSpeed')} ${number(this.run.maxSpeedKmh, 1)} ${t('kmh')}\n${t('newRunHint')}`
      this.resumeButton.textContent = t('runAgain')
    } else if (!this.hasStarted) {
      this.overlayEyebrow.textContent = t('ready')
      this.overlayTitle.textContent = t('startTitle')
      this.overlayHint.textContent = t('jumpHint')
      this.resumeButton.textContent = t('play')
    } else {
      this.overlayEyebrow.textContent = t('halted')
      this.overlayTitle.textContent = t('paused')
      this.overlayHint.textContent = t('resumeHint')
      this.resumeButton.textContent = t('resume')
    }

    this.syncSoundUI()
    this.syncRunnerUI()
    this.updateRunUI()
  }

  private updateRunUI(): void {
    this.runUI?.update(this.run, this.history.data.best, this.runnerVariant === 'classic' ? 'gainer' : 'korona')
  }

  private finishRun(): void {
    this.state = 'gameover'
    this.player.clearJumpBuffer()
    this.animationFrame = null
    this.audio.resetTrack(this.runnerVariant === 'classic' ? 'gainer' : 'corona')
    this.showMenuMusic()
    this.previousBests[this.runnerVariant] = this.history.data.best
    this.newRecord = this.history.add({ date: new Date().toISOString(),
      metres: Math.floor(this.run.distance), seconds: Math.floor(this.run.seconds), bars: this.run.bars,
      maxSpeedKmh: this.run.maxSpeedKmh })
    this.syncUI()
    if (this.runnerVariant === 'classic') this.online?.onRunFinished({
      date: new Date().toISOString(), metres: this.run.distance,
      seconds: this.run.seconds, bars: this.run.bars, maxSpeedKmh: this.run.maxSpeedKmh,
    })
  }

  openOnlineMenu(): void {
    if (this.state === 'playing') this.pause()
    if (this.statisticsOpen) this.closeStatistics()
    this.onlineMenuOpen = true
  }

  closeOnlineMenu(): void { this.onlineMenuOpen = false }

  private readonly openStatistics = (): void => {
    if (this.state === 'playing' || this.onlineMenuOpen) return
    this.statisticsOpen = true
    this.runUI?.showStatistics(this.history, this.runnerVariant === 'classic' ? 'gainer' : 'korona')
  }

  private readonly closeStatistics = (): void => {
    this.statisticsOpen = false
    this.runUI?.closeStatistics()
  }

  private syncSoundUI(): void {
    const muted = this.audio.isMuted || this.audio.volume === 0
    this.soundIcon.textContent = t(muted ? 'unmute' : 'mute')
    this.soundButton.setAttribute('aria-label', t(muted ? 'unmuteSound' : 'muteSound'))
    this.soundButton.setAttribute('aria-pressed', String(muted))
    this.volumeValue.textContent = String(this.audio.volume)

    this.volumeSlider.value = String(this.audio.volume)
  }
}
