import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/game/AudioManager.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { AudioManager } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`)

class FakeBuffer {
  constructor(duration, sampleRate = 44100, channels = 2) {
    this.sampleRate = sampleRate
    this.length = Math.round(duration * sampleRate)
    this.duration = this.length / sampleRate
    this.numberOfChannels = channels
    this.channels = Array.from({ length: channels }, () => new Float32Array(this.length))
  }
  getChannelData(channel) { return this.channels[channel] }
  copyToChannel(data, channel) { this.channels[channel].set(data) }
}
class FakeParam {
  value = 1
  events = []
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]) }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]) }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]) }
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  loop = false
  stopped = false
  disconnected = false
  connect(node) { this.destination = node; return node }
  disconnect() { this.disconnected = true }
  start(when, offset = 0) { this.started = { when, offset } }
  stop() { this.stopped = true }
}
async function withAudio(run) {
  const oldContext = globalThis.AudioContext
  const oldFetch = globalThis.fetch
  const env = {
    contexts: [], requests: [], failed: new Set(), fetchWait: new Map(), decodeWait: new Map(),
    decoded: new Map(), rejectedResume: false, pendingResume: false,
    durations: { '/track-menu.mp3': 8, '/track-intro.mp3': 10, '/track-main.mp3': 20, '/track-corona.mp3': 11 },
  }
  globalThis.AudioContext = class {
    state = 'suspended'
    currentTime = 0
    destination = {}
    gains = []
    sources = []
    oscillators = []
    resumes = 0
    waiting = []
    createdBuffers = []
    constructor() { env.contexts.push(this) }
    async resume() {
      this.resumes++
      if (env.rejectedResume) throw new Error('Autoplay denied')
      if (env.pendingResume) await new Promise(resolve => this.waiting.push(resolve))
      this.state = 'running'
    }
    allowResume() {
      env.pendingResume = false
      for (const resolve of this.waiting.splice(0)) resolve()
    }
    createGain() { const node = new FakeNode(); this.gains.push(node); return node }
    createBufferSource() { const node = new FakeNode(); this.sources.push(node); return node }
    createOscillator() { const node = new FakeNode(); this.oscillators.push(node); return node }
    createBuffer(channels, length, sampleRate) {
      const buffer = new FakeBuffer(length / sampleRate, sampleRate, channels)
      this.createdBuffers.push(buffer)
      return buffer
    }
    async decodeAudioData(bytes) {
      const url = new TextDecoder().decode(bytes)
      await env.decodeWait.get(url)?.promise
      return env.decoded.get(url) ?? new FakeBuffer(env.durations[url])
    }
  }
  globalThis.fetch = async url => {
    env.requests.push(url)
    await env.fetchWait.get(url)?.promise
    return { ok: !env.failed.has(url), arrayBuffer: async () => new TextEncoder().encode(url).buffer }
  }
  try { await run(env) }
  finally {
    if (oldContext === undefined) delete globalThis.AudioContext
    else globalThis.AudioContext = oldContext
    globalThis.fetch = oldFetch
  }
}

test('menu loads lazily, loops on the audio clock and fades only once per entry', async () => withAudio(async env => {
  const audio = new AudioManager()
  assert.deepEqual(audio.playback, { track: 'menu', part: 'menu', position: 0, playing: false })
  assert.equal(env.contexts.length, 0)
  await audio.play()
  const context = env.contexts[0]
  assert.deepEqual(env.requests, ['/track-menu.mp3'])
  assert.equal(context.sources.length, 1)
  assert.equal(context.sources[0].loop, true)
  assert.deepEqual(context.sources[0].started, { when: 0, offset: 0 })
  assert.deepEqual(context.gains[1].gain.events, [['set', 0, 0], ['linear', 1, 0.5]])
  context.currentTime = 25
  near(audio.playback.position, 1)
  audio.selectTrack('menu')
  await audio.play()
  assert.equal(context.sources.length, 1, 'section changes and play retries cannot restart or fade the loop')
  assert.equal(context.resumes, 1)
  audio.pause()
  context.currentTime = 30
  await audio.play()
  assert.deepEqual(context.gains[2].gain.events, [['set', 1, 30]])
  near(audio.playback.position, 1)
  audio.resetTrack('menu')
  await audio.play()
  assert.deepEqual(context.gains[3].gain.events, [['set', 0, 30], ['linear', 1, 30.5]])
}))

test('pausing during menu fade resumes only the remaining fade time', async () => withAudio(async env => {
  const audio = new AudioManager()
  await audio.play()
  const context = env.contexts[0]
  context.currentTime = 0.2
  audio.pause()
  context.currentTime = 7
  await audio.play()
  assert.deepEqual(context.gains[2].gain.events, [['set', 0.4, 7], ['linear', 1, 7.3]])
  near(audio.playback.position, 0.2)
}))

test('Intro is scheduled once, immediately followed by a permanently looping Main', async () => withAudio(async env => {
  const audio = new AudioManager()
  audio.selectTrack('gainer')
  await audio.play()
  const context = env.contexts[0]
  assert.deepEqual(env.requests, ['/track-intro.mp3', '/track-main.mp3'])
  assert.equal(context.sources.length, 2)
  const [intro, main] = context.sources
  assert.equal(intro.loop, false)
  assert.deepEqual(intro.started, { when: 0, offset: 0 })
  assert.equal(main.loop, true)
  assert.deepEqual(main.started, { when: 10, offset: 0 })
  context.currentTime = 14
  assert.deepEqual(audio.playback, { track: 'gainer', part: 'main', position: 4, playing: true })
  context.currentTime = 71
  near(audio.playback.position, 1)
  assert.equal(context.sources.length, 2, 'looping Main needs neither a timer nor an ended callback')
  assert.equal(intro.onended, undefined)
}))

test('pause/resume retains both phases; death/new-run reset always returns to Intro', async () => withAudio(async env => {
  const audio = new AudioManager()
  audio.selectTrack('gainer')
  await audio.play()
  const context = env.contexts[0]
  context.currentTime = 4
  audio.selectTrack('menu')
  assert.ok(context.sources.every(node => node.stopped && node.disconnected), 'including the future scheduled Main')
  await audio.play()
  context.currentTime = 5
  audio.selectTrack('gainer')
  near(audio.playback.position, 4)
  await audio.play()
  assert.deepEqual(context.sources.at(-2).started, { when: 5, offset: 4 })
  assert.deepEqual(context.sources.at(-1).started, { when: 11, offset: 0 })
  context.currentTime = 38
  audio.pause()
  assert.deepEqual(audio.playback, { track: 'gainer', part: 'main', position: 7, playing: false })
  context.currentTime = 46
  const beforeResume = context.sources.length
  await audio.play()
  assert.equal(context.sources.length, beforeResume + 1)
  assert.equal(context.sources.at(-1).loop, true)
  assert.deepEqual(context.sources.at(-1).started, { when: 46, offset: 7 })
  audio.selectTrack('menu')
  await audio.play()
  audio.resetTrack('gainer')
  assert.equal(audio.playback.playing, true, 'resetting a paused run must leave menu playing')
  audio.selectTrack('gainer')
  assert.deepEqual(audio.playback, { track: 'gainer', part: 'intro', position: 0, playing: false })
  await audio.play()
  assert.equal(context.sources.at(-2).buffer.duration, 10)
  assert.deepEqual(context.sources.at(-2).started, { when: 46, offset: 0 })
}))

test('mute and volume affect all music/effects without changing playheads or replaying fade', async () => withAudio(async env => {
  const audio = new AudioManager()
  audio.setVolume(30)
  audio.toggleMute()
  await audio.play()
  assert.equal(env.contexts.length, 0, 'muted startup never bypasses autoplay rules')
  audio.setVolume(0)
  audio.toggleMute()
  assert.equal(audio.volume, 30)
  await audio.play()
  const context = env.contexts[0]
  const master = context.gains[0]
  context.currentTime = 2
  audio.toggleMute()
  assert.equal(master.gain.value, 0)
  context.currentTime = 3
  audio.setVolume(45)
  assert.equal(master.gain.value, 0.45)
  await audio.play()
  assert.equal(context.sources.length, 1)
  near(audio.playback.position, 3)
  audio.selectTrack('gainer')
  await audio.play()
  audio.playPickup()
  assert.equal(context.oscillators.length, 1)
  assert.equal(context.oscillators[0].destination.destination, master)
  audio.pause()
  assert.equal(context.oscillators[0].stopped, true)
  assert.equal(context.oscillators[0].disconnected, true)
  audio.setVolume(120)
  assert.equal(audio.volume, 100)
  audio.setVolume(-5)
  assert.equal(audio.volume, 0)
  assert.equal(master.gain.value, 0)
}))

test('a rejected autoplay attempt can retry from a gesture with cached audio', async () => withAudio(async env => {
  env.rejectedResume = true
  const audio = new AudioManager()
  await assert.doesNotReject(audio.play())
  await flush()
  const context = env.contexts[0]
  assert.equal(audio.playback.playing, false)
  assert.equal(context.sources.length, 0)
  env.rejectedResume = false
  await audio.play()
  assert.equal(context.resumes, 2)
  assert.equal(context.sources.length, 1)
  assert.deepEqual(env.requests, ['/track-menu.mp3'])
}))

test('a pending autoplay resume is retried synchronously and starts only the latest request', async () => withAudio(async env => {
  env.pendingResume = true
  const audio = new AudioManager()
  const initial = audio.play()
  await flush()
  const context = env.contexts[0]
  const gesture = audio.play()
  assert.equal(context.resumes, 2, 'each gesture must call resume even while an older resume is pending')
  context.allowResume()
  await Promise.all([initial, gesture])
  assert.equal(context.sources.length, 1)
  assert.equal(audio.playback.playing, true)
}))

for (const stage of ['fetch', 'decode', 'resume']) {
  for (const stop of ['pause', 'reset', 'select']) {
    test(`late ${stage} completion cannot revive music after ${stop}`, async () => withAudio(async env => {
      const delay = deferred()
      if (stage === 'fetch') env.fetchWait.set('/track-menu.mp3', delay)
      else if (stage === 'decode') env.decodeWait.set('/track-menu.mp3', delay)
      else env.pendingResume = true
      const audio = new AudioManager()
      const pending = audio.play()
      await flush()
      if (stop === 'pause') audio.pause()
      else if (stop === 'reset') audio.resetTrack('menu')
      else audio.selectTrack('gainer')
      if (stage === 'resume') env.contexts[0].allowResume()
      else delay.resolve()
      await pending
      assert.equal(env.contexts[0].sources.length, 0)
      assert.equal(audio.playback.playing, false)
      near(audio.playback.position, 0)
    }))
  }
}

test('missing audio can retry, other soundtracks remain usable and Corona remains lazy', async () => withAudio(async env => {
  const audio = new AudioManager()
  env.failed.add('/track-main.mp3')
  audio.selectTrack('gainer')
  await assert.doesNotReject(audio.play())
  assert.equal(audio.playback.playing, false)
  audio.playPickup()
  assert.equal(env.contexts[0].oscillators.length, 1, 'missing music must not disable independent pickup feedback')
  audio.pause()
  audio.playPickup()
  assert.equal(env.contexts[0].oscillators.length, 1, 'pausing also disables pickup feedback')
  audio.selectTrack('menu')
  await audio.play()
  assert.equal(audio.playback.playing, true)
  assert.equal(env.requests.includes('/track-corona.mp3'), false)
  env.failed.clear()
  audio.selectTrack('gainer')
  await audio.play()
  assert.equal(env.requests.filter(url => url === '/track-intro.mp3').length, 1)
  assert.equal(env.requests.filter(url => url === '/track-main.mp3').length, 2)
  audio.selectTrack('corona')
  await audio.play()
  const context = env.contexts[0]
  assert.equal(context.sources.at(-1).loop, true)
  context.currentTime = 3
  audio.pause()
  await audio.play()
  near(audio.playback.position, 3)
}))

test('unsupported Web Audio leaves gameplay-facing methods harmless and silent', async () => withAudio(async env => {
  delete globalThis.AudioContext
  const audio = new AudioManager()
  await assert.doesNotReject(audio.play())
  audio.selectTrack('gainer')
  audio.resetTrack('gainer')
  assert.doesNotThrow(() => audio.playPickup())
  audio.pause()
  assert.equal(audio.playback.playing, false)
  assert.deepEqual(env.requests, [])
}))

test('known MP3 priming/remainder are trimmed only from full padded decodes', async () => {
  for (const sampleRate of [44100, 48000]) {
    await withAudio(async env => {
      const padded = new FakeBuffer(938880 / 44100, sampleRate)
      const firstFrame = Math.round(528 / 44100 * sampleRate)
      padded.channels[0][firstFrame] = 0.75
      padded.channels[1][firstFrame] = -0.5
      env.decoded.set('/track-menu.mp3', padded)
      const audio = new AudioManager()
      await audio.play()
      const context = env.contexts[0]
      const trimmed = context.sources[0].buffer
      assert.equal(context.createdBuffers.length, 1)
      assert.equal(trimmed.length, Math.round(936277 / 44100 * sampleRate))
      assert.equal(trimmed.channels[0][0], 0.75)
      assert.equal(trimmed.channels[1][0], -0.5)
    })
  }
  await withAudio(async env => {
    const nativeTrimmed = new FakeBuffer(936277 / 44100)
    env.decoded.set('/track-menu.mp3', nativeTrimmed)
    const audio = new AudioManager()
    await audio.play()
    assert.equal(env.contexts[0].createdBuffers.length, 0)
    assert.equal(env.contexts[0].sources[0].buffer, nativeTrimmed, 'never double-trim a decoder that honors metadata')
  })
})

test('archived soundtrack stays unchanged and all runtime soundtrack parts ship compact MP3s', () => {
  const archivedGainer = readFileSync(new URL('../public/track.mp3', import.meta.url))
  assert.equal(createHash('sha256').update(archivedGainer).digest('hex'),
    '3a7fc5c9f77480afb37a600aa2193cec3260397f6bf9f908b88534e77039927f')
  // The padding metadata above belongs to these exact, unmodified authored files.
  const authoredHashes = {
    'track-menu.mp3': '3c8c2b0dbd9c1166476639ccd0bb1ab26b46a0ca4e3d5755b79982f0098587d2',
    'track-intro.mp3': '139068ab4e32dff66336fdb0ee50646e08e07e9c4b8a62d4691de31cc5dccd02',
    'track-main.mp3': '2d02ca5f64b4ad166879431245b23e12c4d2e71951392b52514afee053132e7b',
  }
  for (const filename of ['track-menu.mp3', 'track-intro.mp3', 'track-main.mp3', 'track-corona.mp3']) {
    const track = readFileSync(new URL(`../public/${filename}`, import.meta.url))
    assert.ok(track.subarray(0, 3).toString() === 'ID3' || (track[0] === 0xff && (track[1] & 0xe0) === 0xe0), `${filename} MP3 header`)
    assert.ok(track.length > 1000 && track.length < 4_000_000, `${filename} must be a compact browser asset`)
    if (authoredHashes[filename]) assert.equal(createHash('sha256').update(track).digest('hex'), authoredHashes[filename])
  }
})
