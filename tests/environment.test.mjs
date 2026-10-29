import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/game/GymEnvironment.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { GymEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

class FakeImage {
  listeners = new Map()
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  load() {
    this.complete = true
    this.naturalWidth = 1672
    this.naturalHeight = 941
    this.listeners.get('load')()
  }
}

function context() {
  return {
    calls: [],
    save() {}, restore() {},
    fillRect(...args) { this.calls.push(['rect', ...args]) },
    drawImage(...args) { this.calls.push(['image', ...args]) },
    fillText(...args) { this.calls.push(['text', ...args]) },
    createLinearGradient() { return { addColorStop() {} } },
  }
}

globalThis.Image = FakeImage
let canvases = 0
globalThis.document = { createElement() { canvases++; return { getContext: context } } }

test('art loads once and floor cache is reused without per-frame canvases', () => {
  let ready = 0
  const env = new GymEnvironment(() => ready++)
  const before = canvases
  env.plate.load()
  assert.equal(ready, 1)
  assert.equal(canvases, before + 1)
  for (let i = 0; i < 300; i++) {
    env.update(1 / 60, 210)
    env.render(context(), { left: 0, top: 0, right: 640, bottom: 360 }, 304)
  }
  assert.equal(canvases, before + 1)
})

test('scenery phases are bounded, have different speeds and do not advance on rendering', () => {
  const env = new GymEnvironment(() => {})
  env.update(1, 210)
  assert.equal(env.wallOffset, 67.2)
  assert.equal(env.floorOffset, 210)
  const before = [env.wallOffset, env.floorOffset]
  env.render(context(), { left: -200, top: -600, right: 840, bottom: 960 }, 304)
  assert.deepEqual([env.wallOffset, env.floorOffset], before)
  for (let i = 0; i < 100000; i++) env.update(0.05, 210)
  assert.ok(env.wallOffset >= 0 && env.wallOffset < 720)
  assert.ok(env.floorOffset >= 0 && env.floorOffset < 720)
})

test('missing image keeps a readable fallback and never draws an invalid source', () => {
  const env = new GymEnvironment(() => {})
  const ctx = context()
  env.render(ctx, { left: 0, top: 0, right: 640, bottom: 360 }, 304)
  assert.equal(ctx.calls.some(([kind]) => kind === 'image'), false)
  assert.ok(ctx.calls.some(([kind, text]) => kind === 'text' && text === 'GAINER →'))
})

test('wide, portrait and landscape bounds are covered with bounded draw calls', () => {
  const env = new GymEnvironment(() => {})
  env.plate.load()
  for (const bounds of [
    { left: -400, top: 0, right: 1040, bottom: 360 },
    { left: 0, top: -500, right: 640, bottom: 860 },
    { left: -190, top: 0, right: 830, bottom: 360 },
  ]) {
    const ctx = context()
    env.render(ctx, bounds, 304)
    assert.deepEqual(ctx.calls[0], ['rect', bounds.left, bounds.top,
      bounds.right - bounds.left, bounds.bottom - bounds.top])
    assert.ok(ctx.calls.length < 60)
    for (const [, ...args] of ctx.calls) {
      for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg))
    }
  }
})
