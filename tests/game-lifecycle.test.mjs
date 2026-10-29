import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sourceModuleUrl } from './source-module.mjs'
const moduleUrl = name => sourceModuleUrl(`game/${name}.ts`)

const documentEvents = new Map()
const windowEvents = new Map()
class Element {
  dataset = {}
  style = {}
  value = '65'
  attributes = new Map()
  events = new Map()
  classList = { toggle() {} }
  focusCalls = 0
  disabled = false
  addEventListener(name, handler) { this.events.set(name, handler) }
  setAttribute(name, value) { this.attributes.set(name, value) }
  getBoundingClientRect() { return { width: 640, height: 360 } }
  closest() { return null }
  blur() {}
  focus() { this.focusCalls++ }
}
class Image {
  complete = false
  naturalWidth = 0
  addEventListener() {}
}
const audioContexts = []
const audioRequests = []
const trackDurations = new Map([
  ['/track-menu.mp3', 60], ['/track-intro.mp3', 10], ['/track-main.mp3', 20], ['/track-corona.mp3', 60],
])
let blockNextAutoplay = false
class AudioParam {
  value = 0
  setValueAtTime(value) { this.value = value }
  linearRampToValueAtTime(value) { this.value = value }
  exponentialRampToValueAtTime(value) { this.value = value }
  cancelScheduledValues() {}
}
class AudioNode {
  gain = new AudioParam()
  frequency = new AudioParam()
  connect() { return this }
  disconnect() {}
  start() {}
  stop() {}
}
class AudioContext {
  currentTime = 0
  state = 'suspended'
  destination = {}
  constructor() {
    this.resumeBlocked = blockNextAutoplay
    blockNextAutoplay = false
    audioContexts.push(this)
  }
  async resume() {
    if (this.resumeBlocked) throw new Error('Autoplay blocked')
    this.state = 'running'
  }
  createGain() { return new AudioNode() }
  createBufferSource() { return new AudioNode() }
  createOscillator() { return new AudioNode() }
  async decodeAudioData(bytes) {
    const src = new TextDecoder().decode(bytes)
    assert.ok(trackDurations.has(src), `Unexpected audio source ${src}`)
    return { duration: trackDurations.get(src), sampleRate: 44100, numberOfChannels: 2 }
  }
}
const context = {
  setTransform() {}, clearRect() {}, fillRect() {}, fillText() {}, strokeText() {}, save() {}, restore() {},
}
class Canvas extends Element { getContext() { return context } }
Object.assign(globalThis, {
  Element, HTMLElement: Element, HTMLInputElement: Element, Image, AudioContext,
  async fetch(src) {
    audioRequests.push(src)
    return { ok: true, async arrayBuffer() { return new TextEncoder().encode(src).buffer } }
  },
  ResizeObserver: class { observe() {} },
  requestAnimationFrame() { return 1 }, cancelAnimationFrame() {},
  document: { hidden: false, addEventListener(name, handler) { documentEvents.set(name, handler) } },
  window: { devicePixelRatio: 2, addEventListener(name, handler) { windowEvents.set(name, handler) } },
})
const { Game } = await import(moduleUrl('Game'))
const { setLocale } = await import(sourceModuleUrl('i18n/index.ts'))
function createGame(art = 'legacy', variants = true, online = undefined, startup = {}) {
  document.hidden = startup.hidden ?? false
  blockNextAutoplay = startup.autoplayBlocked ?? false
  return new Game(new Canvas(), ...Array.from({ length: 12 }, () => new Element()), art,
    variants ? { classic: new Element(), diesel: new Element() } : undefined, undefined, online)
}
const flushAudio = () => new Promise(resolve => setImmediate(resolve))
const advanceAudio = seconds => { audioContexts.at(-1).currentTime += seconds }
const playback = (game, track, part, position, playing = true) => {
  assert.deepEqual(game.audio.playback, { track, part, position, playing })
}

test('visible startup plays menu music immediately when autoplay is allowed', async () => {
  const game = createGame('legacy', false)
  await flushAudio()
  assert.equal(game.state, 'paused')
  assert.equal(game.hasStarted, false)
  playback(game, 'menu', 'menu', 0)
})

test('rejected autoplay retries on a first page gesture without starting a run or intercepting controls', async () => {
  for (const gesture of ['keyboard', 'pointer', 'click']) {
    const game = createGame('legacy', false, undefined, { autoplayBlocked: true })
    await flushAudio()
    assert.equal(game.state, 'paused')
    playback(game, 'menu', 'menu', 0, false)
    audioContexts.at(-1).resumeBlocked = false
    const control = new Element()
    control.closest = () => control
    if (gesture === 'keyboard') {
      windowEvents.get('keydown')({ code: 'Space', repeat: false, target: control,
        preventDefault() { throw new Error('Native keyboard activation intercepted') } })
    } else if (gesture === 'pointer') {
      windowEvents.get('pointerdown')({ target: control,
        preventDefault() { throw new Error('Native pointer activation intercepted') } })
    } else windowEvents.get('click')({ target: control })
    await flushAudio()
    assert.equal(game.state, 'paused')
    assert.equal(game.hasStarted, false)
    assert.equal(game.player.isGrounded, true)
    playback(game, 'menu', 'menu', 0)
  }
})

test('menu subpanels preserve the menu loop; pause resets menu and resume preserves Intro or Main', async () => {
  const game = createGame('legacy', false)
  await flushAudio()
  advanceAudio(9)
  game.openStatistics()
  playback(game, 'menu', 'menu', 9)
  game.handleInput('jump')
  assert.equal(game.state, 'paused')
  game.closeStatistics()
  playback(game, 'menu', 'menu', 9)
  game.openOnlineMenu()
  playback(game, 'menu', 'menu', 9)
  game.closeOnlineMenu()
  playback(game, 'menu', 'menu', 9)
  game.resumeButton.events.get('click')()
  await flushAudio()
  playback(game, 'gainer', 'intro', 0)
  for (const [elapsed, part, position] of [[4, 'intro', 4], [9, 'main', 3]]) {
    advanceAudio(elapsed)
    playback(game, 'gainer', part, position)
    game.pause()
    await flushAudio()
    playback(game, 'menu', 'menu', 0)
    advanceAudio(12)
    game.openStatistics()
    game.closeStatistics()
    game.openOnlineMenu()
    game.closeOnlineMenu()
    playback(game, 'menu', 'menu', 12)
    windowEvents.get('keydown')({ code: 'Space', repeat: false, target: new Element(), preventDefault() {} })
    await flushAudio()
    assert.equal(game.state, 'playing')
    assert.equal(game.player.isGrounded, false, 'pause resume by a jump key still jumps')
    playback(game, 'gainer', part, position)
  }
})

test('hidden startup stays silent and visibility return waits for a gesture', async () => {
  const requests = audioRequests.length
  const game = createGame('legacy', false, undefined, { hidden: true })
  await flushAudio()
  playback(game, 'menu', 'menu', 0, false)
  assert.equal(audioRequests.length, requests)
  document.hidden = false
  documentEvents.get('visibilitychange')()
  await flushAudio()
  playback(game, 'menu', 'menu', 0, false)
  windowEvents.get('click')({ target: new Element() })
  await flushAudio()
  playback(game, 'menu', 'menu', 0)
})

test('hiding an already-open menu silences its music and returning waits for another gesture', async () => {
  const game = createGame('legacy', false)
  await flushAudio()
  advanceAudio(8)
  playback(game, 'menu', 'menu', 8)
  document.hidden = true
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 8, false)
  const slider = new Element()
  slider.value = '30'
  game.changeVolume({ currentTarget: slider })
  await flushAudio()
  playback(game, 'menu', 'menu', 8, false)
  document.hidden = false
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 8, false)
  windowEvents.get('keydown')({ code: 'KeyA', repeat: false, target: new Element(), preventDefault() {} })
  await flushAudio()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 8)
})

test('online menus pause gameplay and gate jumps until explicit close, preserving audio position', async () => {
  let game
  const hooks = { onRunFinished() {}, onRunStarted() {}, onCloseMenu() { game.closeOnlineMenu() } }
  game = createGame('legacy', false, hooks)
  game.resume()
  await flushAudio()
  advanceAudio(4)
  game.openOnlineMenu()
  await flushAudio()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 0)
  game.handleInput('jump')
  game.resume()
  assert.equal(game.state, 'paused')
  game.handleInput('pause')
  assert.equal(game.onlineMenuOpen, false)
  assert.equal(game.state, 'paused')
  game.resume()
  await flushAudio()
  assert.equal(game.state, 'playing')
  playback(game, 'gainer', 'intro', 4)
})

test('online completion gets raw current-run metrics without changing rounded local history', () => {
  const completed = []
  let started = 0
  const game = createGame('legacy', false, {
    onRunFinished(result) { completed.push(result) },
    onRunStarted() { started += 1 }, onCloseMenu() {},
  })
  game.resume()
  game.pause()
  game.resume()
  assert.equal(started, 1)
  Object.assign(game.run, { distance: 100.75, seconds: 12.34, bars: 3, maxSpeedKmh: 25 })
  game.finishRun()
  assert.equal(completed.length, 1)
  assert.equal(completed[0].metres, 100.75)
  assert.equal(completed[0].seconds, 12.34)
  assert.equal(game.history.data.results[0].metres, 100)
  assert.equal(game.history.data.results[0].seconds, 12)
  game.resume()
  assert.equal(started, 2)
})

test('the shipped single-runner menu cannot select Korona or load its artwork and music', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /runner-selector|runner-classic|runner-diesel|KORONA/i)
  assert.doesNotMatch(main, /runner-classic|runner-diesel/)
  for (const art of ['legacy', 'restored']) {
    const requestCount = audioRequests.length
    const game = createGame(art, false)
    await flushAudio()
    game.selectRunner('diesel')
    assert.equal(game.player.variant, 'classic')
    assert.equal(game.player.sprites.diesel, undefined)
    assert.equal(game.courses.diesel, undefined)
    assert.equal(game.rio, null)
    playback(game, 'menu', 'menu', 0)
    assert.deepEqual(audioRequests.slice(requestCount), ['/track-menu.mp3'])
    assert.equal(game.stage.dataset.variant, 'classic')
    game.resume()
    game.pause()
    game.selectRunner('diesel')
    assert.equal(game.player.variant, 'classic')
    assert.equal(game.state, 'paused')
    await flushAudio()
    assert.ok(!audioRequests.slice(requestCount).includes('/track-corona.mp3'))
  }
})

test('load → play → hidden pauses audio and scenery; returning requires manual resume', async () => {
  const game = createGame()
  await flushAudio()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 0)
  game.resume()
  await flushAudio()
  assert.equal(game.state, 'playing')
  advanceAudio(13)
  playback(game, 'gainer', 'main', 3)
  game.loop(game.previousTime + 16)
  const phase = game.environment.floorOffset
  assert.ok(phase > 0)
  document.hidden = true
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 0, false)
  game.loop(game.previousTime + 5000)
  assert.equal(game.environment.floorOffset, phase)
  document.hidden = false
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'paused')
  playback(game, 'menu', 'menu', 0, false)
  game.resume()
  await flushAudio()
  assert.equal(game.state, 'playing')
  playback(game, 'gainer', 'main', 3)
})

test('stalled frames remain clamped and keep the established physics and scene', () => {
  const game = createGame()
  game.resume()
  game.loop(game.previousTime + 10000)
  assert.ok(Math.abs(game.environment.floorOffset - 25 / 3.6 * 35 * 0.05) < 1e-7)
  assert.deepEqual(game.size, { width: 640, height: 360 })
  assert.equal(game.player.x, 84)
  assert.equal(game.groundY, 304)
  assert.equal(game.viewport.pixelRatio, 2)
  assert.equal(game.canvas.width, 1280)
})

test('mute and volume affect menu music without resuming gameplay or loading its track', async () => {
  const requestCount = audioRequests.length
  const game = createGame()
  await flushAudio()
  game.toggleSound()
  assert.equal(game.audio.isMuted, true)
  const input = new Element()
  input.value = '0'
  game.changeVolume({ currentTarget: input })
  assert.equal(game.audio.volume, 0)
  assert.equal(game.audio.isMuted, true)
  input.value = '35'
  game.changeVolume({ currentTarget: input })
  assert.equal(game.audio.volume, 35)
  assert.equal(game.audio.isMuted, false)
  assert.equal(game.state, 'paused')
  await flushAudio()
  playback(game, 'menu', 'menu', 0)
  assert.deepEqual(audioRequests.slice(requestCount), ['/track-menu.mp3'])
})

test('jump keys and pointer controls retain their existing routing', () => {
  const game = createGame()
  const key = (code) => windowEvents.get('keydown')({ code, preventDefault() {} })
  key('KeyA')
  assert.equal(game.state, 'paused')
  game.stage.events.get('pointerdown')({ target: new Element(), preventDefault() {} })
  assert.equal(game.state, 'paused')
  key('Space')
  assert.equal(game.state, 'playing')
  assert.equal(game.player.isGrounded, false)
  key('Escape')
  assert.equal(game.state, 'paused')
})

test('variant selection changes hero and world, stays paused and preserves each scene for either art mode', async () => {
  for (const art of ['legacy', 'restored']) {
    const game = createGame(art)
    await flushAudio()
    assert.equal(game.rio, null)
    assert.equal(game.environment, game.gym)
    assert.equal(game.runnerButtons.classic.attributes.get('aria-pressed'), 'true')
    assert.equal(game.runnerButtons.diesel.attributes.get('aria-pressed'), 'false')
    game.runnerButtons.diesel.events.get('click')()
    assert.equal(game.player.variant, 'diesel')
    assert.equal(game.environment, game.rio)
    assert.equal(game.player.usesLegacyArt, art === 'legacy')
    assert.equal(game.runnerButtons.diesel.attributes.get('aria-pressed'), 'true')
    assert.equal(game.state, 'paused')
    assert.equal(game.hasStarted, false)
    playback(game, 'menu', 'menu', 0)
    game.resume()
    game.player.jump()
    game.loop(game.previousTime + 20)
    game.pause()
    const before = [game.player.y, game.player.velocityY, game.player.animationTime,
      game.rio.cityOffset, game.rio.roadOffset, game.audio.playback.position]
    game.runnerButtons.classic.events.get('click')()
    assert.equal(game.state, 'paused')
    assert.equal(game.player.variant, 'classic')
    assert.equal(game.environment, game.gym)
    assert.equal(game.gym.floorOffset, 0)
    assert.deepEqual([game.player.y, game.player.velocityY, game.player.animationTime], [258, 0, 0])
    assert.deepEqual([game.rio.cityOffset, game.rio.roadOffset, game.audio.playback.position], before.slice(3))
    game.runnerButtons.diesel.events.get('click')()
    assert.deepEqual([game.player.y, game.player.velocityY, game.player.animationTime], before.slice(0, 3))
    game.resume()
    assert.equal(game.player.variant, 'diesel')
    game.runnerButtons.classic.events.get('click')() // Hidden controls cannot change a live run.
    assert.equal(game.player.variant, 'diesel')
    assert.equal(createGame(art).player.variant, 'classic') // Reload defaults; no persistent preference.
  }
})

test('fatal collision preserves the result and rejects late jump/repeat/pointer input until New game', async () => {
  const game = createGame()
  game.resumeButton.events.get('click')()
  await flushAudio()
  advanceAudio(13)
  playback(game, 'gainer', 'main', 3)
  for (let i = 0; i < 4000 && game.state === 'playing'; i++) game.loop(game.previousTime + 1000 / 60)
  await flushAudio()
  assert.equal(game.state, 'gameover')
  assert.equal(game.run.lives, 0)
  assert.equal(game.history.data.totalRuns, 1)
  playback(game, 'menu', 'menu', 0)
  assert.equal(game.animationFrame, null)
  assert.equal(game.resumeButton.textContent, 'New game')
  assert.match(game.overlayHint.textContent, /PRESS NEW GAME TO START AGAIN/)
  assert.equal(game.resumeButton.focusCalls, 0, 'fatal collision must not focus a button that a late Space could activate')
  assert.equal(game.pauseButton.disabled, true)
  const result = { ...game.history.data.results[0] }
  const distance = game.run.distance
  const motion = game.player.captureMotion()
  for (const code of ['Space', 'KeyW', 'ArrowUp']) {
    for (const repeat of [false, true]) {
      windowEvents.get('keydown')({ code, repeat, target: new Element(), preventDefault() {} })
      assert.equal(game.state, 'gameover')
      assert.equal(game.run.distance, distance)
      assert.deepEqual(game.player.captureMotion(), motion)
    }
  }
  game.stage.events.get('pointerdown')({ target: new Element(), preventDefault() {} })
  game.pauseButton.events.get('click')()
  assert.equal(game.state, 'gameover')
  game.loop(game.previousTime + 1000)
  document.hidden = true
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'gameover')
  playback(game, 'menu', 'menu', 0, false)
  assert.equal(game.run.distance, distance)
  assert.equal(game.history.data.totalRuns, 1)
  assert.deepEqual(game.history.data.results[0], result)
  document.hidden = false
  documentEvents.get('visibilitychange')()
  playback(game, 'menu', 'menu', 0, false)
  game.resumeButton.events.get('click')()
  await flushAudio()
  assert.equal(game.state, 'playing')
  assert.equal(game.run.lives, 3)
  assert.equal(game.run.distance, 0)
  assert.equal(game.run.bars, 0)
  assert.equal(game.run.kilometresPerHour, 25)
  assert.equal(game.course.equipment.length, 0)
  assert.equal(game.course.bars.length, 0)
  playback(game, 'gainer', 'intro', 0)
  assert.equal(game.history.data.totalRuns, 1)
  assert.deepEqual(game.history.data.results[0], result)
  assert.equal(game.pauseButton.disabled, false)
})

test('pause, statistics and Corona cannot advance or evade a Gainer run', () => {
  const game = createGame()
  game.resume()
  game.player.jump()
  game.loop(game.previousTime + 30)
  game.pause()
  const motion = game.player.captureMotion()
  const distance = game.run.distance
  game.openStatistics()
  game.handleInput('jump')
  game.resume()
  assert.equal(game.state, 'paused')
  assert.equal(game.run.distance, distance)
  game.handleInput('pause')
  assert.equal(game.statisticsOpen, false)
  game.selectRunner('diesel')
  game.resume()
  for (let i = 0; i < 120; i++) game.loop(game.previousTime + 1000 / 60)
  assert.equal(game.state, 'playing')
  assert.equal(game.history.data.totalRuns, 0)
  assert.equal(game.runs.classic.distance, distance)
  assert.ok(game.run.distance > distance)
  game.pause()
  game.selectRunner('classic')
  assert.deepEqual(game.player.captureMotion(), motion)
  assert.equal(game.run.distance, distance)
})

test('a 5-item speed ramp freezes on pause/Corona and all Gainer movement uses the same frame speed', () => {
  const game = createGame()
  game.run.bars = 5
  game.resume()
  const startDistance = game.run.distance
  const startFloor = game.gym.floorOffset
  game.loop(game.previousTime + 50)
  assert.ok(Math.abs(game.gym.floorOffset - startFloor - 25 / 3.6 * 35 * 0.05) < 1e-7)
  assert.ok(Math.abs(game.run.distance - startDistance - 25 / 3.6 * 0.05) < 1e-7)
  assert.ok(game.worldSpeed > 25 / 3.6 * 35 && game.worldSpeed < 28.75 / 3.6 * 35)
  game.pause()
  const ramp = game.run.speed
  game.loop(game.previousTime + 5000)
  assert.equal(game.run.speed, ramp)
  game.selectRunner('diesel')
  assert.equal(game.worldSpeed, 25 / 3.6 * 35)
  game.resume()
  game.loop(game.previousTime + 50)
  assert.equal(game.runs.classic.speed, ramp)
  game.pause()
  game.selectRunner('classic')
  assert.equal(game.worldSpeed, ramp)
  game.resume()
  game.loop(game.previousTime + 50)
  assert.ok(game.worldSpeed > ramp)
  const order = []
  game.player.render = () => order.push('player')
  game.course.renderFeedback = () => order.push('pickup')
  game.render()
  assert.deepEqual(order, ['player', 'pickup'])
})

test('Rio also pauses on hidden and keeps all layer phases when returning', () => {
  const game = createGame()
  game.runnerButtons.diesel.events.get('click')()
  game.resume()
  game.loop(game.previousTime + 16)
  const phases = () => [game.rio.cityOffset, game.rio.landmarkOffset, game.rio.meetOffset, game.rio.roadOffset]
  const before = phases()
  assert.ok(before.every(value => value > 0))
  document.hidden = true
  documentEvents.get('visibilitychange')()
  game.loop(game.previousTime + 5000)
  assert.deepEqual(phases(), before)
  assert.equal(game.audio.playback.playing, false)
  document.hidden = false
  documentEvents.get('visibilitychange')()
  assert.equal(game.state, 'paused')
  assert.deepEqual(phases(), before)
})

test('dormant variants retain separate gameplay music positions while menu music stays selected', async () => {
  const requestCount = audioRequests.length
  const game = createGame()
  await flushAudio()
  playback(game, 'menu', 'menu', 0)
  assert.deepEqual(audioRequests.slice(requestCount), ['/track-menu.mp3'])
  game.resume()
  await flushAudio()
  playback(game, 'gainer', 'intro', 0)
  advanceAudio(4)
  game.pause()
  await flushAudio()
  advanceAudio(9)
  game.runnerButtons.diesel.events.get('click')()
  playback(game, 'menu', 'menu', 9)
  assert.ok(!audioRequests.slice(requestCount).includes('/track-corona.mp3'), 'selection alone must not fetch dormant music')
  game.resume()
  await flushAudio()
  playback(game, 'corona', 'corona', 0)
  advanceAudio(17)
  game.pause()
  await flushAudio()
  game.toggleSound()
  game.runnerButtons.classic.events.get('click')()
  assert.equal(game.audio.playback.track, 'menu')
  assert.equal(game.audio.isMuted, true)
  game.resume()
  await flushAudio()
  assert.equal(game.audio.playback.track, 'gainer')
  assert.equal(game.audio.playback.part, 'intro')
  assert.equal(game.audio.playback.position, 4)
  game.toggleSound()
  await flushAudio()
  playback(game, 'gainer', 'intro', 4)
  game.pause()
  await flushAudio()
  game.runnerButtons.diesel.events.get('click')()
  playback(game, 'menu', 'menu', 0)
  game.resume()
  await flushAudio()
  playback(game, 'corona', 'corona', 17)
})

test('jump keys and pointer events on menu controls never start or jump the game', () => {
  const game = createGame()
  const control = new Element()
  control.closest = () => control
  for (const code of ['Space', 'ArrowUp', 'KeyW', 'Enter', 'KeyA']) {
    windowEvents.get('keydown')({ code, target: control, preventDefault() { throw new Error('Native control key intercepted') } })
    assert.equal(game.state, 'paused')
  }
  game.stage.events.get('pointerdown')({ target: control, preventDefault() { throw new Error('Control pointer intercepted') } })
  assert.equal(game.state, 'paused')
  game.resume()
  windowEvents.get('keydown')({ code: 'Space', target: control, preventDefault() {} })
  assert.equal(game.player.isGrounded, true)
  windowEvents.get('keydown')({ code: 'Space', target: new Element(), preventDefault() {} })
  assert.equal(game.player.isGrounded, false)
})

test('Gainer ignores held-key auto-repeat; a fresh press buffers and pause clears it', () => {
  const game = createGame()
  game.resume()
  game.player.jump()
  windowEvents.get('keydown')({ code: 'Space', repeat: true, target: new Element(), preventDefault() {} })
  assert.equal(game.player.jumpBufferTime, 0)
  windowEvents.get('keydown')({ code: 'Space', repeat: false, target: new Element(), preventDefault() {} })
  assert.equal(game.player.jumpBufferTime, 0.14)
  game.pause()
  assert.equal(game.player.jumpBufferTime, 0)
  game.resume()
  game.stage.events.get('pointerdown')({ target: new Element(), preventDefault() {} })
  assert.equal(game.player.jumpBufferTime, 0.14, 'pointer jump uses the same buffer')
  document.hidden = true
  documentEvents.get('visibilitychange')()
  assert.equal(game.player.jumpBufferTime, 0)
  assert.equal(game.state, 'paused')
})


test('Korona collects bottles, boosts, ends after three hits and saves only its own history', () => {
  const game = createGame()
  game.selectRunner('diesel')
  game.resume()
  for (let i = 0; i < 5; i++) {
    game.course.bars.push({ x: 90, y: 260, baseY: 260, width: 22, height: 44, phase: 0, art: 0, collected: false, speedFactor: 1 })
    game.loop(game.previousTime + 16)
  }
  assert.equal(game.run.bars, 5)
  for (let i = 0; i < 65; i++) game.loop(game.previousTime + 16)
  assert.ok(Math.abs(game.run.kilometresPerHour - 28.75) < 1e-7)
  for (let i = 0; i < 4000 && game.state === 'playing'; i++) game.loop(game.previousTime + 1000 / 60)
  assert.equal(game.state, 'gameover')
  assert.equal(game.history.data.totalRuns, 1)
  assert.equal(game.history.data.results[0].maxSpeedKmh, game.run.maxSpeedKmh)
  assert.equal(game.histories.classic.data.totalRuns, 0)
  assert.ok(game.run.bars >= 5)
  assert.ok(game.overlayHint.textContent.includes(`${game.run.bars} bottles`))
  assert.equal(game.newRecord, true)
  game.openStatistics()
  game.handleInput('jump')
  assert.equal(game.state, 'gameover')
  game.closeStatistics()
  game.selectRunner('classic')
  assert.equal(game.run.distance, 0)
  assert.equal(game.newRecord, false)
  game.selectRunner('diesel')
  assert.equal(game.state, 'gameover')
  assert.equal(game.newRecord, true)
  game.resume()
  assert.equal(game.run.kilometresPerHour, 25)
  assert.equal(game.run.lives, 3)
  assert.equal(game.run.bars, 0)
  assert.equal(game.course.equipment.length, 0)
})

test('distance records congratulate with the real improvement, retain mode state and clear on restart', () => {
  for (const variant of ['classic', 'diesel']) {
    const game = createGame()
    game.selectRunner(variant)
    game.history.data.best = 408
    game.run.distance = 512.9
    game.run.lives = 0
    game.run.maxSpeedKmh = 26.23
    game.finishRun()
    assert.equal(game.stage.dataset.newRecord, 'true')
    assert.equal(game.status.textContent, 'NEW DISTANCE RECORD')
    assert.equal(game.overlayTitle.textContent, 'NEW RECORD\n512 m')
    assert.match(game.overlayHint.textContent, /NICE RUN! \+104 m OVER YOUR BEST/)
    assert.match(game.overlayHint.textContent, /Max speed 26.2 km\/h/)
    assert.equal(game.history.data.results[0].maxSpeedKmh, 26.23)
    game.selectRunner(variant === 'classic' ? 'diesel' : 'classic')
    assert.equal(game.stage.dataset.newRecord, 'false')
    game.selectRunner(variant)
    assert.equal(game.stage.dataset.newRecord, 'true')
    assert.match(game.overlayHint.textContent, /\+104 m/)
    game.resume()
    assert.equal(game.stage.dataset.newRecord, 'false')
    assert.equal(game.run.maxSpeedKmh, 25)
  }
})

test('first distance record is celebrated; a tie or shorter run is ordinary completion', () => {
  for (const [previousBest, metres, celebrated] of [[0, 42, true], [42, 42, false], [42, 30, false]]) {
    const game = createGame()
    game.history.data.best = previousBest
    game.run.distance = metres
    game.finishRun()
    assert.equal(game.stage.dataset.newRecord, String(celebrated))
    if (celebrated) assert.match(game.overlayHint.textContent, /YOUR FIRST DISTANCE RECORD/)
    else {
      assert.equal(game.overlayTitle.textContent, 'RUN COMPLETE')
      assert.doesNotMatch(game.overlayHint.textContent, /NICE RUN|OVER YOUR BEST/)
    }
  }
})

test('changing language translates current game state without restarting a run or audio', async () => {
  const game = createGame('legacy', false)
  game.resume()
  await flushAudio()
  game.run.distance = 512.9
  game.run.seconds = 70.5
  game.run.bars = 21
  game.pause()
  await flushAudio()
  advanceAudio(5)
  const menuPlayback = game.audio.playback
  try {
    setLocale('ru')
    assert.equal(game.overlayTitle.textContent, 'ПАУЗА')
    assert.equal(game.resumeButton.textContent, 'Продолжить')
    assert.equal(game.pauseButton.attributes.get('aria-label'), 'Продолжить игру')
    assert.equal(game.state, 'paused')
    assert.equal(game.run.distance, 512.9)
    assert.deepEqual(game.audio.playback, menuPlayback)
    assert.equal(game.audio.playback.playing, true)
    game.finishRun()
    assert.match(game.overlayTitle.textContent, /НОВЫЙ РЕКОРД\n512 м/)
    assert.match(game.overlayHint.textContent, /21 батончик/)
    assert.match(game.overlayHint.textContent, /км\/ч/)
    assert.equal(game.resumeButton.textContent, 'Новая игра')
    assert.match(game.overlayHint.textContent, /НАЖМИ «НОВАЯ ИГРА»/)
    const totalRuns = game.history.data.totalRuns
    setLocale('en')
    assert.match(game.overlayTitle.textContent, /NEW RECORD\n512 m/)
    assert.match(game.overlayHint.textContent, /21 bars/)
    assert.equal(game.resumeButton.textContent, 'New game')
    assert.match(game.overlayHint.textContent, /PRESS NEW GAME TO START AGAIN/)
    assert.equal(game.state, 'gameover')
    assert.equal(game.history.data.totalRuns, totalRuns)
  } finally { setLocale('en') }
})
