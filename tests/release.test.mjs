import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('package, lockfile, visible badge and latest changelog release agree', () => {
  const { version } = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
  assert.ok(read('index.html').replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').includes(`D&B Runner V${version}`))
  const releases = [...read('CHANGELOG.md').matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)]
  const pending = read('CHANGELOG.md').match(/^Target version: `(\d+\.\d+\.\d+)`/m)?.[1]
  assert.equal(pending ?? releases[0]?.[1], version)
  if (pending) assert.ok(!releases.some(([, released]) => released === pending), 'pending version must not pretend to be a dated release')
  assert.match(read('index.html'), /<title>Drum &amp; Bass Runner<\/title>/)
  assert.equal(new Set(releases.map(match => match[1])).size, releases.length)
  for (const [, , date] of releases) {
    assert.equal(new Date(date).toISOString().slice(0, 10), date)
  }
})
