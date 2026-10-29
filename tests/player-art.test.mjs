import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/game/Player.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { Player, resolvePlayerArt } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

class FakeImage {
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  listeners = new Map()
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  load(width, height) {
    this.complete = true
    this.naturalWidth = width
    this.naturalHeight = height
    this.listeners.get('load')()
  }
}
globalThis.Image = FakeImage

test('legacy is the default; refactored and restored select the detailed atlas', () => {
  for (const search of ['', '?runner=legacy', '?runner=unknown', '?shirt=white']) {
    assert.equal(resolvePlayerArt(search), 'legacy')
  }
  for (const search of ['?runner=refactored', '?runner=restored']) {
    assert.equal(resolvePlayerArt(search), 'restored')
  }
  assert.equal(new Player(() => {}).sprite.src, '/player-sprite.png?v=5')
})

test('restored file keeps the full-resolution RGBA atlas and leaves the legacy source intact', () => {
  const restored = readFileSync(new URL('../public/player-sprite-restored.png', import.meta.url))
  const legacy = readFileSync(new URL('../public/player-sprite.png', import.meta.url))
  assert.equal(restored.toString('ascii', 12, 16), 'IHDR')
  assert.equal(restored.readUInt32BE(16), 1536)
  assert.equal(restored.readUInt32BE(20), 1024)
  assert.equal(restored[24], 8)
  assert.equal(restored[25], 6) // PNG truecolor with alpha.
  assert.equal(legacy.readUInt32BE(16), 192)
  assert.equal(legacy.readUInt32BE(20), 128)
})

function context() {
  return {
    calls: [],
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    save() {}, restore() {}, fillRect() {},
    drawImage(...args) { this.calls.push(args) },
  }
}

test('restored atlas retains source detail with unchanged destination and collision size', () => {
  let redraws = 0
  const player = new Player(() => redraws++, 'restored')
  assert.equal(player.sprite.src, '/player-sprite-restored.png')
  player.sprite.load(1536, 1024)
  player.reset(304)
  const ctx = context()
  player.render(ctx, { width: 640, height: 360 }, false)
  assert.equal(redraws, 1)
  assert.deepEqual(ctx.calls[0].slice(1), [0, 0, 512, 512, 63, 235, 80, 80])
  assert.equal(ctx.imageSmoothingEnabled, true)
  assert.equal(ctx.imageSmoothingQuality, 'high')
  assert.deepEqual(player.collisionBox, { x: 87, y: 261, width: 24, height: 41 })
})

test('legacy comparison retains original crop, rendering scale and nearest-neighbor pixels', () => {
  const player = new Player(() => {}, 'legacy')
  assert.equal(player.sprite.src, '/player-sprite.png?v=5')
  player.sprite.load(192, 128)
  player.reset(304)
  const ctx = context()
  player.render(ctx, { width: 640, height: 360 }, true)
  assert.deepEqual(ctx.calls[0].slice(1), [64, 0, 64, 64, 63, 235, 80, 80])
  assert.equal(ctx.imageSmoothingEnabled, false)
})

test('all running frames and jump use proportional atlas cells without changing animation timing', () => {
  const player = new Player(() => {}, 'restored')
  player.sprite.load(1536, 1024)
  player.reset(304)
  const ctx = context()
  for (let frame = 0; frame < 4; frame++) {
    player.render(ctx, { width: 640, height: 360 }, true)
    player.update(1 / 8, 304)
  }
  assert.deepEqual(ctx.calls.map((call) => call.slice(1, 3)), [
    [512, 0], [1024, 0], [0, 512], [512, 512],
  ])
  player.jump()
  assert.equal(player.velocityY, -624)
  player.render(ctx, { width: 640, height: 360 }, true)
  assert.deepEqual(ctx.calls.at(-1).slice(1, 5), [1024, 512, 512, 512])
})

test('a missing restored atlas falls back to the original image without a retry loop', () => {
  const player = new Player(() => {}, 'restored')
  player.sprite.listeners.get('error')()
  assert.equal(player.sprite.src, '/player-sprite.png?v=5')
  assert.equal(player.usesLegacyArt, true)
  player.sprite.listeners.get('error')()
  assert.equal(player.sprite.src, '/player-sprite.png?v=5')
  player.sprite.load(192, 128)
  player.reset(304)
  const ctx = context()
  player.render(ctx, { width: 640, height: 360 }, false)
  assert.equal(ctx.calls[0][3], 64)
})

test('both costumes work with both atlas resolutions without resetting position or animation', () => {
  for (const art of ['legacy', 'restored']) {
    const cell = art === 'legacy' ? 64 : 512
    const player = new Player(() => {}, art)
    player.reset(304)
    player.update(1 / 8, 304)
    player.jump()
    player.update(0.02, 304)
    const before = [player.y, player.velocityY, player.animationTime, player.isGrounded]
    const classic = player.sprite
    player.setVariant('diesel')
    const diesel = player.sprite
    assert.equal(diesel.src, art === 'legacy' ? '/player-sprite-diesel.png' : '/player-sprite-diesel-restored.png')
    diesel.load(cell * 3, cell * 2)
    const ctx = context()
    player.render(ctx, { width: 640, height: 360 }, true)
    assert.equal(ctx.imageSmoothingEnabled, art === 'restored')
    assert.deepEqual(ctx.calls[0].slice(1, 5), [cell * 2, cell, cell, cell])
    player.setVariant('classic')
    assert.equal(player.sprite, classic)
    player.setVariant('diesel')
    assert.equal(player.sprite, diesel) // Reuse already-loaded images on repeated switches.
    assert.deepEqual([player.y, player.velocityY, player.animationTime, player.isGrounded], before)
  }
})

test('failed detailed Diesel artwork falls back within the same costume and cannot affect classic art', () => {
  let ready = 0
  const player = new Player(() => ready++, 'restored')
  const classic = player.sprite
  player.setVariant('diesel')
  player.sprite.listeners.get('error')()
  assert.equal(player.sprite.src, '/player-sprite-diesel.png')
  assert.equal(player.usesLegacyArt, true)
  player.sprite.listeners.get('error')()
  assert.equal(ready, 1)
  const ctx = context()
  player.render(ctx, { width: 640, height: 360 }, false)
  assert.equal(ctx.calls.length, 0)
  player.setVariant('classic')
  assert.equal(player.sprite, classic)
  assert.equal(player.usesLegacyArt, false)
})

test('both Diesel assets are RGBA PNGs with the expected six-cell grid', () => {
  for (const [file, width, height] of [
    ['player-sprite-diesel.png', 192, 128],
    ['player-sprite-diesel-restored.png', 1536, 1024],
  ]) {
    const png = readFileSync(new URL(`../public/${file}`, import.meta.url))
    assert.equal(png.readUInt32BE(16), width)
    assert.equal(png.readUInt32BE(20), height)
    assert.equal(png[24], 8)
    assert.equal(png[25], 6)
  }
})
