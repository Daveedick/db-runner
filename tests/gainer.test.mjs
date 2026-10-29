import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function moduleUrl(name) {
  const source = readFileSync(new URL(`../src/game/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  const code = outputText.replace(/from ['"]\.\/([^'"]+)['"]/g,
    (_, dependency) => `from '${moduleUrl(dependency)}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const load = name => import(moduleUrl(name))
globalThis.Image = class { addEventListener() {} }
const { GainerRun } = await load('GainerRun')
const { GainerCourse, createCourseChunk, GYM_ITEMS, ACTIVE_COURSE_PATTERNS, RISK_MIN_SPEED, hasReadableApproach } = await load('GainerCourse')
const { RunHistory } = await load('RunHistory')
const { Player } = await load('Player')

test('distance measures travel and damage has a 1.2 second simulation-time grace period', () => {
  const run = new GainerRun()
  run.update(1, 210)
  assert.equal(run.distance, 6)
  assert.equal(run.hit(), true)
  assert.equal(run.hit(), false)
  run.update(0.8, 210)
  assert.equal(run.hit(), false)
  run.update(0.41, 210)
  assert.equal(run.hit(), true)
  assert.equal(run.lives, 1)
})

test('both variants share the approved Gainer jump trajectory', () => {
  function flight(variant) {
    const player = new Player(() => {})
    player.setVariant(variant)
    player.reset(304)
    player.jump()
    const impulse = player.velocityY
    let height = 0, seconds = 0
    while (!player.isGrounded && seconds < 2) {
      player.update(1 / 120, 304)
      height = Math.max(height, 258 - player.y)
      seconds += 1 / 120
    }
    return { impulse, height, seconds }
  }
  const old = flight('diesel'), next = flight('classic')
  assert.equal(next.impulse, -624)
  assert.deepEqual(old, next)
  assert.ok(next.height > 130 && next.height < 135)
  assert.ok(next.seconds > 0.84 && next.seconds < 0.88)
})

test('a Gainer press just before landing queues exactly one jump; early input expires', () => {
  const player = new Player(() => {})
  player.reset(304)
  player.y = 250
  player.velocityY = 300
  player.isGrounded = false
  player.jump()
  assert.equal(player.velocityY, 300, 'buffer must not become a double jump')
  player.update(0.03, 304)
  assert.equal(player.isGrounded, false)
  assert.equal(player.velocityY, -624)
  for (let i = 0; i < 120; i++) player.update(1 / 120, 304)
  assert.equal(player.isGrounded, true, 'queued input must be consumed once')
  player.jump()
  player.update(0.02, 304)
  player.jump()
  for (let i = 0; i < 120; i++) player.update(1 / 120, 304)
  assert.equal(player.isGrounded, true, 'an early aerial press must expire')
  player.setVariant('diesel')
  player.y = 250
  player.velocityY = 300
  player.isGrounded = false
  player.jump()
  player.update(0.03, 304)
  assert.equal(player.isGrounded, false, 'Korona uses the same buffered jump')
  assert.equal(player.velocityY, -624)
})

test('standing inside one obstacle consumes it once, not one hit per frame', () => {
  const course = new GainerCourse(304, () => {}, () => 0)
  course.equipment.push({ x: 84, y: 280, width: 42, height: 24, kind: 0, consumed: false })
  const player = { x: 87, y: 261, width: 24, height: 41 }
  assert.equal(course.update(0, 210, player).hit, true)
  for (let i = 0; i < 120; i++) assert.equal(course.update(0, 210, player).hit, false)
})

function simulate(pattern, speed, dt, seed, leadTime, mode = 'gainer', boostAt = Infinity) {
  const course = new GainerCourse(304, () => {})
  course.untilSpawn = Infinity
  const chunk = createCourseChunk(pattern, speed, 304, () => seed, mode, Math.max(350, 99 + speed * 1.6))
  const expectedBars = chunk.bars.length
  course.equipment = chunk.equipment
  course.bars = chunk.bars
  const player = new Player(() => {})
  player.reset(304)
  let collected = 0
  let hits = 0
  for (let frame = 0; frame < 6 / dt; frame++) {
    const frameSpeed = speed * 1.15 ** Math.min(1, Math.max(0, frame * dt - boostAt))
    const obstacle = course.equipment.find(item => item.x + item.width > player.x)
    const target = obstacle ?? course.bars.find(bar => bar.x + bar.width > player.x && bar.baseY < 260)
    if (target && player.isGrounded) {
      const ahead = target.x + target.width / 2 - (player.x + 15)
      if (ahead > 0 && ahead < frameSpeed * leadTime) player.jump()
    }
    player.update(dt, 304)
    const result = course.update(dt, frameSpeed, player.collisionBox)
    hits += Number(result.hit)
    collected += result.bars
  }
  return { hits, collected, expectedBars }
}

test('ordinary and precision chunks retain safe full-pickup paths at 15% speed steps and multiple frame rates', () => {
  for (const mode of ['gainer', 'korona']) for (let level = 0; level <= 12; level++) {
    const speed = GainerRun.BASE_SPEED * 1.15 ** level
    for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
      for (const pattern of ACTIVE_COURSE_PATTERNS.filter(pattern => !['risk', 'train'].includes(pattern))) {
        for (let kind = 0; kind < GYM_ITEMS.length; kind++) {
          const seed = (kind + 0.5) / GYM_ITEMS.length
          const attempts = []
          for (let lead = 0.28; lead <= 0.5; lead += 0.02) attempts.push(simulate(pattern, speed, dt, seed, lead, mode))
          assert.ok(attempts.some(run => run.hits === 0 && run.collected === run.expectedBars),
            `No safe full-pickup path: ${mode}, ${pattern}, kind=${kind}, speed=${speed}, dt=${dt}`)
        }
      }
    }
  }
})

function scheduledRisk(speed, dt, seed, firstJump, secondJump = Infinity, boostAt = Infinity) {
  const course = new GainerCourse(304, () => {})
  course.untilSpawn = Infinity
  const chunk = createCourseChunk('risk', speed, 304, () => seed, 'gainer', 99 + speed * 1.5 - 29)
  course.equipment = chunk.equipment
  course.bars = chunk.bars
  const player = new Player(() => {})
  player.reset(304)
  let hits = 0, collected = 0, jumped = false, recovered = false
  for (let time = 0; time < 3; time += dt) {
    if (!jumped && time >= firstJump) { player.jump(); jumped = true }
    if (jumped && !recovered && player.isGrounded && time >= secondJump) {
      player.jump(); recovered = true
    }
    player.update(dt, 304)
    const frameSpeed = speed * 1.15 ** Math.min(1, Math.max(0, time - boostAt))
    const result = course.update(dt, frameSpeed, player.collisionBox)
    if (result.bars > 0 && boostAt === Infinity) boostAt = time
    hits += Number(result.hit)
    collected += result.bars
  }
  return { hits, collected }
}

test('risky pairs are survivable by skipping the bar, while chasing it costs a hit even with a recovery jump', () => {
  for (const speed of [RISK_MIN_SPEED, GainerRun.BASE_SPEED * 1.15 ** 8, GainerRun.BASE_SPEED * 1.15 ** 16]) {
    for (const dt of [1 / 60, 1 / 30, 1 / 20]) for (const seed of [0, 0.5, 0.99]) for (const boostAt of [Infinity, 1]) {
      const attempts = []
      for (let first = 0.3; first < 1.6; first += dt) {
        attempts.push(scheduledRisk(speed, dt, seed, first, Infinity, boostAt))
        // A second press may be buffered to execute at the earliest landing, or delayed.
        for (let recovery = first + 0.6; recovery < 2.2; recovery += 0.05) {
          attempts.push(scheduledRisk(speed, dt, seed, first, recovery, boostAt))
        }
      }
      assert.ok(attempts.some(run => run.hits === 0 && run.collected === 0), `No safe skip: ${speed}, ${dt}, ${seed}`)
      assert.ok(attempts.some(run => run.collected === 1), `Bar itself unreachable: ${speed}, ${dt}, ${seed}`)
      assert.ok(attempts.filter(run => run.collected === 1).every(run => run.hits > 0),
        `Risk has a safe full-pickup path: ${speed}, ${dt}, ${seed}`)
    }
  }
})

test('an in-flight 15% speed upgrade preserves a safe route through every generated pattern', () => {
  for (const speed of [RISK_MIN_SPEED, GainerRun.BASE_SPEED * 1.15 ** 12]) {
    for (const dt of [1 / 60, 1 / 30, 1 / 20]) for (const seed of [0, 0.5, 0.99]) {
      for (const pattern of ACTIVE_COURSE_PATTERNS) {
        const attempts = []
        for (let lead = 0.2; lead <= 0.5; lead += 0.01) {
          attempts.push(simulate(pattern, speed, dt, seed, lead, 'gainer', 1.2))
        }
        assert.ok(attempts.some(run => run.hits === 0), `No route during boost: ${pattern}, ${speed}, ${dt}, ${seed}`)
      }
    }
  }
})

test('bars move forward relative to the ground while the runner catches them, with swept high-speed collection', () => {
  const course = new GainerCourse(304, () => {})
  course.untilSpawn = Infinity
  const chunk = createCourseChunk('reward', 500, 304, () => 0.5, 'gainer', 700)
  course.equipment = chunk.equipment
  course.bars = chunk.bars
  const itemX = course.equipment[0].x, barX = course.bars[0].x
  course.update(0.1, 500, { x: -100, y: 0, width: 1, height: 1 })
  assert.equal(itemX - course.equipment[0].x, 50)
  assert.ok(Math.abs(barX - course.bars[0].x - 47) < 1e-8)
  assert.ok(Math.abs((course.bars[0].x - course.equipment[0].x) - (barX - itemX) - 3) < 1e-8,
    'the bar advances three world pixels while the runner travels fifty')
  course.equipment = []
  course.bars = [{ x: 42, y: 270, baseY: 270, width: 44, height: 16, phase: 0, art: 0,
    collected: false, speedFactor: 0.94 }]
  assert.equal(course.update(0.05, 1000, { x: 87, y: 261, width: 24, height: 41 }).bars, 0,
    'the faster ground sweep must not collect a slower bar that was already behind the runner')
  course.bars = [{ x: 150, y: 270, baseY: 270, width: 44, height: 16, phase: 0, art: 0,
    collected: false, speedFactor: 0.96 }]
  assert.equal(course.update(0.05, 20000, { x: 87, y: 261, width: 24, height: 41 }).bars, 1,
    'collect a bar that crosses the player completely using its relative approach')
})

test('risk is withheld during the opening and until two speed upgrades', () => {
  for (const [elapsed, speed] of [[0, RISK_MIN_SPEED * 2], [30, RISK_MIN_SPEED - 1]]) {
    const course = new GainerCourse(304, () => {}, () => 0.999)
    course.elapsed = elapsed
    for (let i = 0; i < 20; i++) {
      course.spawn(speed)
      assert.notEqual(course.previousPattern, 'risk')
    }
  }
})

function trainRandom(count, tail) {
  let first = true
  return () => { if (first) { first = false; return (count - 5 + 0.5) / 3 } return tail }
}

function runTrain(level, remainder, dt, count, tail, options = {}) {
  const { barLead = 0.28, safe = true, standing = false, singleJump = Infinity, delay = 0 } = options
  const run = new GainerRun()
  run.bars = level * 5 + remainder
  run.speed = GainerRun.BASE_SPEED * 1.15 ** level
  const initialBars = run.bars
  const course = new GainerCourse(304, () => {})
  course.untilSpawn = Infinity
  const chunk = createCourseChunk('train', run.speed, 304, trainRandom(count, tail), 'gainer', 664)
  const firstArrival = (chunk.bars[0].x + 22 - 99) / (run.speed * chunk.bars[0].speedFactor)
  const lastArrival = (chunk.bars.at(-1).x + 22 - 99) / (run.speed * chunk.bars[0].speedFactor)
  course.equipment = chunk.equipment
  course.bars = chunk.bars
  const player = new Player(() => {})
  player.reset(304)
  let hits = 0, visibleAt = Infinity, hazardJumpAt = Infinity, landingAt = -Infinity
  let didSingleJump = false
  const perJump = []
  for (let time = 0; time < 8; time += dt) {
    const obstacle = course.equipment.find(item => !item.consumed && item.x + item.width > 87)
    const hazardTime = obstacle ? (obstacle.x + obstacle.width / 2 - 99) / run.speed : Infinity
    if (obstacle && obstacle.x + obstacle.width <= 640) visibleAt = Math.min(visibleAt, time)
    const next = course.bars.find(bar => bar.x + bar.width > 87)
    const barTime = next ? (next.x + next.width / 2 - 99) / (run.speed * next.speedFactor) : Infinity
    const scripted = Number.isFinite(singleJump)
    const jump = !standing && player.isGrounded && (scripted
      ? !didSingleJump && time >= singleJump
      : time - landingAt >= delay && ((safe && hazardTime > 0 && hazardTime < 0.35)
        || (barTime > 0 && barTime < barLead && (!safe || hazardTime > 1.2))))
    if (jump) {
      player.jump()
      perJump.push(0)
      didSingleJump = true
      if (hazardTime < 0.35) hazardJumpAt = time
    }
    const grounded = player.isGrounded
    const speed = run.speed
    player.update(dt, 304)
    if (!grounded && player.isGrounded) landingAt = time
    run.update(dt, speed)
    const result = course.update(dt, speed, player.collisionBox)
    run.bars += result.bars
    hits += Number(result.hit)
    if (result.bars) perJump[perJump.length - 1] += result.bars
  }
  return { hits, collected: run.bars - initialBars, count, boosts: run.speedLevel - level,
    notice: hazardJumpAt - visibleAt, perJump, firstArrival, lastArrival, hasHazard: chunk.equipment.length > 0 }
}

test('airborne trains have wider stable spacing, gentle bobbing and an optional varied tail obstacle', () => {
  for (const count of [5, 6, 7]) for (const tail of [0, 0.4, 0.9]) {
    const course = new GainerCourse(304, () => {})
    course.untilSpawn = Infinity
    const chunk = createCourseChunk('train', GainerRun.BASE_SPEED, 304, trainRandom(count, tail), 'gainer', 700)
    assert.equal(chunk.bars.length, count)
    const lastBarArrival = (chunk.bars.at(-1).x + 22 - 99) / (GainerRun.BASE_SPEED * chunk.bars[0].speedFactor)
    course.bars = chunk.bars
    const gaps = course.bars.slice(1).map((bar, i) => bar.x - course.bars[i].x - 44)
    assert.ok(gaps.every(gap => gap > 70), 'wrappers need visible breathing room')
    const ys = []
    for (let frame = 0; frame < 24; frame++) {
      course.update(0.1, 0, { x: -100, y: 0, width: 1, height: 1 })
      ys.push(course.bars[0].y)
    }
    assert.ok(Math.max(...ys) - Math.min(...ys) > 4, 'the train visibly levitates again')
    assert.ok(course.bars.every(bar => bar.baseY === 164 && Math.abs(bar.y - bar.baseY) <= 2.5
      && bar.speedFactor >= 0.92 && bar.speedFactor <= 0.96))
    course.update(0.5, 300, { x: -100, y: 0, width: 1, height: 1 })
    for (let i = 1; i < course.bars.length; i++) {
      assert.ok(Math.abs(course.bars[i].x - course.bars[i - 1].x - 44 - gaps[i - 1]) < 1e-8)
    }
    assert.equal(chunk.equipment.length, tail < 0.6 ? 1 : 0)
    if (chunk.equipment.length) {
      const obstacle = chunk.equipment[0]
      const obstacleTime = (obstacle.x - 99) / GainerRun.BASE_SPEED
      assert.ok(obstacleTime > lastBarArrival, 'the hazard follows the airborne chain instead of occupying its last bar')
    }
  }
})

test('one jump collects two or occasionally three airborne train bars, never a whole chain', () => {
  let hasThree = false
  for (let level = 0; level <= 6; level++) for (const remainder of [0, 4]) for (const dt of [1 / 60, 1 / 20]) {
    const initial = runTrain(level, remainder, dt, 7, 0.9, { standing: true })
    assert.equal(initial.collected, 0, 'grounded running must not collect airborne bars')
    let maximum = 0
    for (let time = Math.max(0, initial.firstArrival - 0.8); time < initial.lastArrival; time += 0.02) {
      const result = runTrain(level, remainder, dt, 7, 0.9, { singleJump: time })
      maximum = Math.max(maximum, result.collected)
    }
    assert.ok(maximum >= 2 && maximum <= 3, `Wrong single-jump yield: ${level}, ${remainder}, ${dt}, ${maximum}`)
    if (level === 0 && remainder === 0) assert.equal(maximum, 2)
    hasThree ||= maximum === 3
  }
  assert.ok(hasThree, 'three bars remain possible with suitable speed and timing')
})

test('airborne chains support repeated jumps, missed rewards and a readable choice before a tail hazard', () => {
  let greedyHit = false, safeSacrifice = false, doubleBoost = false, fullChain = false
  for (let level = 0; level <= 6; level++) for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
    for (const count of [5, 6, 7]) for (const tail of [0, 0.4, 0.9]) for (const remainder of [0, 4]) {
      const attempts = []
      for (let lead = 0.22; lead <= 0.36; lead += 0.02) {
        attempts.push(runTrain(level, remainder, dt, count, tail, { barLead: lead }))
      }
      const safe = attempts.filter(run => run.hits === 0)
      assert.ok(safe.some(run => run.collected >= 2), `No rewarding route: ${level}, ${dt}, ${count}, ${tail}, ${remainder}`)
      assert.ok(safe.every(run => run.perJump.every(bars => bars <= 3)), 'repeated jumps must not sweep five bars at once')
      if (tail >= 0.6) {
        assert.ok(safe.some(run => run.collected >= count - 2), `No useful chain with repeat jumps: ${level}, ${dt}, ${count}, ${remainder}`)
        fullChain ||= safe.some(run => run.collected === count && run.perJump.length >= 2)
        doubleBoost ||= safe.some(run => run.boosts === 2)
      } else {
        safeSacrifice ||= safe.some(run => run.collected < count)
        if (hasReadableApproach('train', GainerRun.BASE_SPEED * 1.15 ** level)) {
          assert.ok(safe.some(run => run.notice >= 0.3), `Unreadable tail hazard: ${level}, ${dt}, ${count}, ${tail}, ${remainder}`)
        }
        greedyHit ||= runTrain(level, remainder, dt, count, tail, { safe: false }).hits > 0
      }
    }
  }
  assert.ok(greedyHit && safeSacrifice, 'the optional hazard creates a timing/skip decision')
  assert.ok(fullChain, 'a train without a hazard can be collected through repeated jumps')
  assert.ok(doubleBoost, 'repeat jumps can collect seven bars across two upgrade boundaries')
  const quick = runTrain(0, 0, 1 / 60, 7, 0.9)
  const slow = runTrain(0, 0, 1 / 60, 7, 0.9, { delay: 0.45 })
  assert.ok(slow.collected < quick.collected, 'waiting too long between jumps leaves some rewards behind')
})

test('risk rewards follow the visible first obstacle and unreadable complex patterns leave the generation pool', () => {
  const speed = RISK_MIN_SPEED
  const chunk = createCourseChunk('risk', speed, 304, () => 0.5, 'gainer', 120 + speed * 2.2)
  const firstTime = (chunk.equipment[0].x + chunk.equipment[0].width / 2 - 99) / speed
  const barTime = (chunk.bars[0].x + 22 - 99) / (speed * chunk.bars[0].speedFactor)
  assert.ok(barTime > firstTime, 'bait must arrive after the first hazard')
  const fullyVisibleAt = Math.max(...chunk.equipment.map(item => (item.x + item.width - 640) / speed))
  assert.ok(firstTime - 0.35 - fullyVisibleAt >= 0.3, 'both stacks must be visible before takeoff')
  for (const pattern of ['risk', 'train']) assert.equal(hasReadableApproach(pattern, 3000), false)
  const course = new GainerCourse(304, () => {}, () => 0.999)
  course.elapsed = 30
  for (let i = 0; i < 20; i++) {
    course.spawn(3000)
    assert.ok(!['risk', 'train'].includes(course.previousPattern))
  }
})

test('waiting for a chased low reward costs one life; a visible safe jump sacrifices it', () => {
  for (const level of [2, 4]) for (const remainder of [0, 4]) for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
    for (const seed of [0, 0.5, 0.999]) for (const skip of [false, true]) {
      const run = new GainerRun()
      run.bars = level * 5 + remainder
      run.speed = GainerRun.BASE_SPEED * 1.15 ** level
      const initialBars = run.bars
      const course = new GainerCourse(304, () => {})
      course.untilSpawn = Infinity
      const chunk = createCourseChunk('risk', run.speed, 304, () => seed, 'gainer', Math.max(664, 120 + run.speed * 2.2))
      course.equipment = chunk.equipment
      course.bars = chunk.bars
      const player = new Player(() => {})
      player.reset(304)
      let jumped = false, fullyVisibleAt = Infinity, jumpAt = Infinity
      for (let time = 0; time < 6; time += dt) {
        if (course.equipment.every(item => item.x + item.width <= 640)) fullyVisibleAt = Math.min(fullyVisibleAt, time)
        const first = course.equipment[0]
        if (skip && !jumped && first && (first.x + first.width / 2 - 99) / run.speed < 0.35) {
          player.jump(); jumped = true; jumpAt = time
        }
        const speed = run.speed
        player.update(dt, 304)
        run.update(dt, speed)
        const result = course.update(dt, speed, player.collisionBox)
        if (result.hit) run.hit()
        run.bars += result.bars
      }
      assert.equal(run.lives, skip ? 3 : 2, `Wrong trap damage: ${level}, ${remainder}, ${dt}, ${seed}, ${skip}`)
      assert.equal(run.bars - initialBars, skip ? 0 : 1)
      if (skip) assert.ok(jumpAt - fullyVisibleAt >= 0.3, 'both hazards must be readable before sacrificing the reward')
    }
  }
})

test('ordinary obstacles allow a continuous timing window, not just one possible takeoff', () => {
  const windows = []
  for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
    for (let kind = 0; kind < GYM_ITEMS.length; kind++) {
      let streak = 0, longest = 0
      for (let lead = 0.1; lead <= 0.8; lead += 0.01) {
        const result = simulate('obstacle', GainerRun.BASE_SPEED, dt, (kind + 0.5) / GYM_ITEMS.length, lead)
        streak = result.hits === 0 ? streak + 1 : 0
        longest = Math.max(longest, streak)
      }
      windows.push(longest * 10)
      assert.ok(longest >= 20, `Timing window too narrow: ${GYM_ITEMS[kind].name}, dt=${dt}, ${longest * 10}ms`)
    }
  }
  console.log(`Ordinary-obstacle safe takeoff windows: ${Math.min(...windows)}–${Math.max(...windows)} ms at base speed`)
})

test('25 km/h grows by 15% every five items without a ceiling; reset restores the start', () => {
  const run = new GainerRun()
  assert.equal(run.kilometresPerHour, 25)
  assert.equal(run.barsUntilBoost, 5)
  for (let level = 1; level <= 30; level++) {
    const before = run.speed
    run.bars = level * 5 - 1
    assert.equal(run.speedLevel, level - 1)
    assert.equal(run.barsUntilBoost, 1)
    run.update(1)
    assert.ok(Math.abs(run.speed - before) < 1e-7)
    run.bars++
    assert.equal(run.barsUntilBoost, 5)
    run.update(0.5)
    assert.ok(run.speed > before && run.speed < before * 1.15)
    run.update(0.5)
    assert.ok(Math.abs(run.kilometresPerHour - 25 * 1.15 ** level) < 1e-7)
  }
  run.reset()
  assert.equal(run.kilometresPerHour, 25)
  assert.equal(run.bars, 0)
  assert.equal(run.barsUntilBoost, 5)
})

test('multiple boosts collected during a ramp are retained and frame rate does not change the result', () => {
  for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
    const run = new GainerRun()
    run.bars = 5
    run.update(0.5)
    run.bars = 15
    for (let i = 0; i < 4 / dt; i++) run.update(dt)
    assert.ok(Math.abs(run.kilometresPerHour - 25 * 1.15 ** 3) < 1e-7)
  }
})

test('generator varies layouts, flavors and quiet gaps without unbounded arrays', () => {
  let state = 4321
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
  const course = new GainerCourse(304, () => {}, random)
  const patterns = new Set(), flavors = new Set(), equipment = new Set()
  for (let frame = 0; frame < 60 * 600; frame++) {
    course.update(1 / 60, (RISK_MIN_SPEED * 1.05), { x: -200, y: 0, width: 1, height: 1 })
    patterns.add(course.previousPattern)
    course.bars.forEach(bar => flavors.add(bar.art))
    course.equipment.forEach(item => equipment.add(item.kind))
    assert.ok(course.equipment.length < 8 && course.bars.length < 16 && course.pickups.length < 10)
  }
  assert.equal(flavors.size, 4)
  assert.equal(equipment.size, 6)
  for (const pattern of ACTIVE_COURSE_PATTERNS) assert.ok(patterns.has(pattern))
  assert.equal(patterns.has('risk'), true)
})

test('bars bob with separate phases; reduced motion stops bobbing and pickup rises above the head', () => {
  const course = new GainerCourse(304, () => {})
  course.untilSpawn = Infinity
  course.bars = [0, Math.PI].map(phase => ({ x: 400, y: 200, baseY: 200, width: 44, height: 16, phase, art: 0, collected: false, speedFactor: 0.94 }))
  const away = { x: 0, y: 0, width: 1, height: 1 }
  course.update(0.2, 0, away)
  assert.notEqual(course.bars[0].y, course.bars[1].y)
  assert.ok(course.bars.every(bar => Math.abs(bar.y - bar.baseY) <= 2.5))
  course.reducedMotion = true
  course.update(0.2, 0, away)
  assert.equal(course.bars[0].y, 200)
  const player = { x: 400, y: 180, width: 24, height: 41 }
  course.update(0, 0, player)
  assert.ok(course.pickups.every(pickup => pickup.y <= player.y - 30))
  const ys = []
  const context = { save() {}, restore() {}, strokeText() {}, fillText(text, x, y) { ys.push(y) } }
  course.reducedMotion = false
  course.renderFeedback(context, player)
  const initial = ys[0]
  course.update(0.2, 0, away)
  course.renderFeedback(context, player)
  assert.ok(ys.at(-1) < initial - 20)
  course.renderFeedback(context, { ...player, y: 130 })
  assert.ok(ys.at(-1) <= 96, 'feedback must stay above the rising player')
  course.update(0.6, 0, away)
  assert.equal(course.pickups.length, 0)
})

test('history keeps only 20 rows, preserves the all-time best and reloads', () => {
  const data = new Map()
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const history = new RunHistory(storage)
  for (let i = 0; i < 25; i++) history.add({ date: new Date(2026, 8, 6, 12, i).toISOString(), metres: 500 - i, seconds: 80, bars: 2 })
  const reloaded = new RunHistory(storage)
  assert.equal(reloaded.data.totalRuns, 25)
  assert.equal(reloaded.data.results.length, 20)
  assert.equal(reloaded.data.best, 500)
  assert.equal(reloaded.data.results[0].metres, 476)
})

test('corrupt and blocked storage cannot interrupt a run; malformed rows are discarded', () => {
  for (const storage of [
    { getItem: () => '{broken', setItem() {} },
    { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } },
  ]) {
    const history = new RunHistory(storage)
    assert.equal(history.data.results.length, 0)
    history.add({ date: new Date().toISOString(), metres: 42, seconds: 7, bars: 1 })
    assert.equal(history.data.best, 42)
  }
  const history = new RunHistory({ getItem: () => JSON.stringify({ version: 1, best: -1,
    results: [{ date: 'invalid', metres: '<script>', seconds: 1, bars: 1 }] }), setItem() {} })
  assert.equal(history.data.results.length, 0)
  assert.equal(history.data.best, 0)
})

test('maximum speed tracks the actual ramp, survives a slowdown and resets per run', () => {
  const run = new GainerRun()
  assert.equal(run.maxSpeedKmh, 25)
  run.bars = 5
  assert.equal(run.maxSpeedKmh, 25, 'collecting the fifth item does not immediately reach the target')
  run.update(0.5)
  assert.ok(run.maxSpeedKmh > 25 && run.maxSpeedKmh < 28.75)
  run.update(0.5)
  assert.ok(Math.abs(run.maxSpeedKmh - 28.75) < 1e-8)
  run.speed = GainerRun.BASE_SPEED
  run.update(0)
  assert.ok(Math.abs(run.maxSpeedKmh - 28.75) < 1e-8)
  run.reset()
  assert.equal(run.maxSpeedKmh, 25)
})

test('speed round-trips through storage; legacy and malformed speed fields preserve valid runs', () => {
  const rows = [undefined, null, -10, 'fast', 31.27].map(maxSpeedKmh => ({
    date: '2026-09-09T12:00:00Z', metres: 123, seconds: 15, bars: 5, maxSpeedKmh,
  }))
  let saved = JSON.stringify({ version: 1, best: 408, totalRuns: 5, results: rows })
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value } }
  const history = new RunHistory(storage)
  assert.equal(history.data.best, 408)
  assert.equal(history.data.results.length, 5)
  assert.deepEqual(history.data.results.map(row => row.maxSpeedKmh), [undefined, undefined, undefined, undefined, 31.27])
  history.add({ ...rows[0], maxSpeedKmh: 26.231 })
  const reloaded = new RunHistory(storage)
  assert.equal(reloaded.data.results[0].maxSpeedKmh, 26.231)
  assert.equal(reloaded.data.results.length, 6)
})


test('Korona shares course patterns and bobbing but uses upright bottles and original prototype shapes', () => {
  for (const pattern of ACTIVE_COURSE_PATTERNS) {
    const gym = createCourseChunk(pattern, GainerRun.BASE_SPEED, 304, () => 0.5)
    const rio = createCourseChunk(pattern, GainerRun.BASE_SPEED, 304, () => 0.5, 'korona')
    assert.equal(gym.bars.length, rio.bars.length)
    assert.equal(gym.equipment.length, rio.equipment.length)
    assert.ok(rio.bars.every(b => b.width === 22 && b.height === 44))
    assert.ok(rio.equipment.every(e => e.prototype && e.width === e.prototype.width))
  }
})

test('fast equipment and pickups still collide when crossing the entire player between frames', () => {
  for (const mode of ['gainer', 'korona']) {
    const course = new GainerCourse(304, () => {}, () => 0, mode)
    course.untilSpawn = Infinity
    const chunk = createCourseChunk('reward', 4000, 304, () => 0, mode)
    for (const item of [...chunk.equipment, ...chunk.bars]) item.x = 150
    chunk.bars[0].baseY = 265
    course.equipment = chunk.equipment
    course.bars = chunk.bars
    const result = course.update(0.05, 4000, { x: 87, y: 261, width: 24, height: 41 })
    assert.deepEqual(result, { hit: true, bars: 1 })
    assert.deepEqual(course.update(0, 0, { x: 87, y: 261, width: 24, height: 41 }), { hit: false, bars: 0 })
  }
})

test('history uses independent keys and preserves existing Gainer results', () => {
  const data = new Map()
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  new RunHistory(storage).add({ date: new Date().toISOString(), metres: 123, seconds: 18, bars: 5 })
  new RunHistory(storage, 'korona').add({ date: new Date().toISOString(), metres: 456, seconds: 60, bars: 10 })
  assert.equal(new RunHistory(storage).data.best, 123)
  assert.equal(new RunHistory(storage, 'korona').data.best, 456)
  assert.ok(data.has('db-runner.gainer.history.v1'))
  assert.ok(data.has('db-runner.korona.history.v1'))
})
