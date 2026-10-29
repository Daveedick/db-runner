import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sourceModuleUrl } from './source-module.mjs'
const moduleUrl = name => sourceModuleUrl(`game/${name}.ts`)

const { sortRunResults } = await import(moduleUrl('RunUI'))

test('every statistics column sorts actual numbers or timestamps in both directions without changing history', () => {
  const results = Object.freeze([
    Object.freeze({ date: '2026-01-01T00:10:00Z', metres: 2, bars: 20, seconds: 100, maxSpeedKmh: 9.9 }),
    Object.freeze({ date: '2026-01-01T01:00:00+02:00', metres: 10, bars: 3, seconds: 9, maxSpeedKmh: 100.2 }),
    Object.freeze({ date: '2025-12-01T10:00:00Z', metres: 100, bars: 1, seconds: 40, maxSpeedKmh: 25.05 }),
  ])
  const orders = { date: [2, 1, 0], metres: [0, 1, 2], bars: [2, 1, 0], seconds: [1, 2, 0], maxSpeedKmh: [0, 2, 1] }
  for (const [column, indexes] of Object.entries(orders)) {
    assert.deepEqual(sortRunResults(results, column, 'ascending'), indexes.map(index => results[index]))
    assert.deepEqual(sortRunResults(results, column, 'descending'), [...indexes].reverse().map(index => results[index]))
  }
  assert.equal(results[0].metres, 2)
  assert.equal(results[1].metres, 10)
  assert.equal(results[2].metres, 100)
})

test('missing legacy speeds stay last in both directions; sorting uses unrounded peak speeds', () => {
  const make = (date, maxSpeedKmh) => ({ date, metres: 10, bars: 1, seconds: 2, maxSpeedKmh })
  const slow = make('2026-01-01T00:00:00Z', 25.041)
  const fast = make('2026-01-02T00:00:00Z', 25.049)
  const old = make('2025-01-01T00:00:00Z')
  const recent = make('2026-01-03T00:00:00Z')
  const results = [old, fast, recent, slow]
  assert.equal(slow.maxSpeedKmh.toFixed(1), fast.maxSpeedKmh.toFixed(1))
  assert.deepEqual(sortRunResults(results, 'maxSpeedKmh', 'ascending'), [slow, fast, recent, old])
  assert.deepEqual(sortRunResults(results, 'maxSpeedKmh', 'descending'), [fast, slow, recent, old])
})

test('equal metrics keep newer runs first, preserve exact ties and handle an empty or single-row history', () => {
  const old = { date: '2025-01-01T00:00:00Z', metres: 10, bars: 1, seconds: 2 }
  const latest = { ...old, date: '2026-01-01T00:00:00Z' }
  const tie = { ...latest }
  for (const direction of ['ascending', 'descending']) {
    const sorted = sortRunResults([old, latest, tie], 'metres', direction)
    assert.deepEqual(sorted, [latest, tie, old])
    assert.equal(sorted[0], latest)
    assert.equal(sorted[1], tie)
    assert.deepEqual(sortRunResults([], 'metres', direction), [])
    assert.deepEqual(sortRunResults([old], 'maxSpeedKmh', direction), [old])
  }
})
