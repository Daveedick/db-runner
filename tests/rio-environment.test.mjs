import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/game/RioEnvironment.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { RioEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

class FakeImage {
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  listeners = new Map()
  addEventListener(name, fn) { this.listeners.set(name, fn) }
  load() {
    this.complete = true
    this.naturalWidth = this.src.includes('landmark') ? 1024 : 1659
    this.naturalHeight = this.src.includes('landmark') ? 1024 : 948
    this.listeners.get('load')()
  }
}
function context() {
  return {
    calls: [],
    save() {}, restore() {}, translate() {}, scale() {},
    fillRect(...args) { this.calls.push(['rect', ...args]) },
    fillText(...args) { this.calls.push(['text', ...args]) },
    drawImage(...args) { this.calls.push(['image', ...args]) },
    createLinearGradient() { return { addColorStop() {} } },
  }
}
let canvases = 0
globalThis.Image = FakeImage
globalThis.document = { createElement() { canvases++; return { getContext: context } } }
const bounds = { left: 0, top: 0, right: 640, bottom: 360 }

test('Rio layers are independently loaded and the road cache is created only once', () => {
  let ready = 0
  const env = new RioEnvironment(() => ready++)
  const before = canvases
  env.skyline.load()
  env.landmark.load()
  assert.equal(canvases, before)
  env.meet.load()
  assert.equal(ready, 3)
  assert.equal(canvases, before + 1)
  const road = env.road
  for (let i = 0; i < 500; i++) { env.update(1 / 60, 210); env.render(context(), bounds, 304) }
  assert.equal(env.road, road)
  assert.equal(canvases, before + 1)
})

test('landmark, city, meet and road have distinct bounded speeds; rendering does not advance them', () => {
  const env = new RioEnvironment(() => {})
  env.update(1, 210)
  const phases = () => [env.landmarkOffset, env.cityOffset, env.meetOffset, env.roadOffset]
  assert.deepEqual(phases(), [210 * 0.018, 210 * 0.07, 210 * 0.32, 210])
  const before = phases()
  env.render(context(), bounds, 304)
  assert.deepEqual(phases(), before)
  for (let i = 0; i < 100000; i++) env.update(0.05, 210)
  assert.ok(env.landmarkOffset >= 0 && env.landmarkOffset < 2400)
  assert.ok(env.cityOffset >= 0 && env.cityOffset < 2000)
  assert.ok(env.meetOffset >= 0 && env.meetOffset < 765)
  assert.ok(env.roadOffset >= 0 && env.roadOffset < 900)
})

test('landmark appears once in the opening view, not once per street tile', () => {
  const env = new RioEnvironment(() => {})
  env.skyline.load(); env.landmark.load(); env.meet.load()
  for (const view of [bounds, { left: -450, top: 0, right: 1090, bottom: 360 }]) {
    const ctx = context()
    env.render(ctx, view, 304)
    const statues = ctx.calls.filter(([kind, source]) => kind === 'image' && source === env.landmark)
    assert.equal(statues.length, 1)
    assert.deepEqual(statues[0].slice(2), [320, 12, 240, 240])
  }
})

test('car meet is uniformly 15% smaller, stays on its curb and tiles without changing the road', () => {
  const env = new RioEnvironment(() => {})
  env.meet.load()
  const ctx = context()
  env.render(ctx, { ...bounds, right: 1600 }, 304)
  const meet = ctx.calls.filter(([kind, source]) => kind === 'image' && source === env.meet)
  assert.equal(meet.length, 3)
  for (let i = 0; i < meet.length; i++) {
    const [x, y, width, height] = meet[i].slice(2)
    assert.equal(x, i * 765)
    assert.equal(width, 900 * 0.85)
    assert.equal(height, 514 * 0.85)
    assert.equal(y + height * 0.71, 304 - 38)
  }
  assert.equal(env.road.width, 900)
  assert.equal(env.road.height, 128)
  const road = ctx.calls.filter(([kind, source]) => kind === 'image' && source === env.road)
  assert.deepEqual(road.map((call) => call.slice(2)), [[0, 283], [900, 283]])
})

test('missing layers never draw invalid images; fallback retains Corona Extra and works independently', () => {
  let notifications = 0
  const env = new RioEnvironment(() => notifications++)
  for (const image of [env.skyline, env.landmark, env.meet]) image.listeners.get('error')()
  assert.equal(notifications, 3)
  const ctx = context()
  env.render(ctx, bounds, 304)
  assert.equal(ctx.calls.some(([kind]) => kind === 'image'), false)
  assert.ok(ctx.calls.some(([kind, text]) => kind === 'text' && text === 'KORONA →'))
  env.meet.load()
  const partial = context()
  env.render(partial, bounds, 304)
  assert.ok(partial.calls.some(([kind, source]) => kind === 'image' && source === env.meet))
})

test('portrait and short/wide bounds stay covered with finite bounded drawing work', () => {
  const env = new RioEnvironment(() => {})
  env.skyline.load(); env.landmark.load(); env.meet.load()
  for (const view of [bounds,
    { left: 0, top: -500, right: 640, bottom: 860 },
    { left: -500, top: 0, right: 1140, bottom: 360 },
  ]) {
    const ctx = context()
    env.render(ctx, view, 304)
    assert.deepEqual(ctx.calls[0], ['rect', view.left, view.top, view.right - view.left, view.bottom - view.top])
    assert.ok(ctx.calls.length < 24)
    for (const call of ctx.calls) for (const value of call) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value))
    }
  }
})

test('Gainer scenery and all four player atlases remain byte-identical to accepted 0.3.2', () => {
  for (const [file, expected] of [
    ['environment/neon-gym.webp', 'f70b0fa540e357876a1bea5b34c432da4d5a61033610f75efc9ff2827c70b295'],
    ['player-sprite.png', '7a95a12dbf2561ac702b67654d80c6f9c8dccadc7ecb8e67213b8f2677721f2c'],
    ['player-sprite-restored.png', '94c53bd4fcb6a3fb784ce4026408f18bacb5f64d3ff85c498422ae704ad47845'],
    ['player-sprite-diesel.png', 'affd92b00cf169a6175500ca56edd664b3f7fc9cb5b42f1f75c09b9d7514d61f'],
    ['player-sprite-diesel-restored.png', '5bd9a849f4ed64b23774509fc3e271e6640a18bb099c1332a0d93bc423da6988'],
  ]) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/${file}`, import.meta.url))).digest('hex'), expected)
  }
})
