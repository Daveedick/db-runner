import type { CollisionBox } from './types'
import { GainerRun } from './GainerRun'
import { Obstacle } from './Obstacle'

// Solid bodies exclude towels, thin handles and small displaced rims.
export const GYM_ITEMS = [
  { name: 'dumbbell', width: 64, height: 37, inset: 5, solidHeight: 32 },
  { name: 'plates', width: 58, height: 58, inset: 5, solidHeight: 52 },
  { name: 'step', width: 84, height: 34, inset: 8, solidHeight: 29 },
  { name: 'dumbbell-pile', width: 78, height: 48, inset: 9, solidHeight: 40 },
  { name: 'plates-messy', width: 78, height: 60, inset: 9, solidHeight: 50 },
  { name: 'step-towel', width: 86, height: 42, inset: 9, solidHeight: 32 },
] as const
export const BAR_ART = ['pump-chocolate', 'pump-berry', 'pump-coconut', 'pump-pistachio'] as const
export const COURSE_PATTERNS = ['rest', 'free', 'obstacle', 'reward', 'precision', 'pair', 'risk', 'train'] as const
export type CoursePattern = typeof COURSE_PATTERNS[number]
export const ACTIVE_COURSE_PATTERNS = COURSE_PATTERNS
export const RISK_MIN_SPEED = GainerRun.BASE_SPEED * GainerRun.BOOST_FACTOR ** 2
const PLAYER_CENTRE_X = 99
const SCENE_RIGHT = 640
const TAKEOFF_NOTICE = 0.65 // 0.35s to take off, plus 0.30s to read the fully visible hazard.
const BAR_BOB_AMPLITUDE = 2.5

/** Complex encounters must remain readable even if a seven-bar train triggers two upgrades. */
export function hasReadableApproach(pattern: 'risk' | 'train', speed: number): boolean {
  const extraWidth = pattern === 'risk' ? Math.max(66, speed * 0.2) : 0
  return (SCENE_RIGHT - PLAYER_CENTRE_X - 40 - extraWidth)
    / (speed * GainerRun.BOOST_FACTOR ** 2) >= TAKEOFF_NOTICE
}
interface Equipment extends CollisionBox { kind: number; consumed: boolean; prototype?: Obstacle }
interface Bar extends CollisionBox { baseY: number; phase: number; art: number; collected: boolean; speedFactor: number; bobAmplitude?: number }
interface Pickup { x: number; y: number; age: number }
export interface CourseChunk { equipment: Equipment[]; bars: Bar[]; length: number }
const overlaps = (a: CollisionBox, b: CollisionBox): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const pick = (random: () => number, count: number): number => Math.min(count - 1, Math.floor(random() * count))

/** Author encounters in world-distance coordinates, then position independently moving bars
 * to reach the player's lane at the intended time. startX is the equipment's spawn origin. */
export function createCourseChunk(pattern: CoursePattern, speed: number, groundY: number,
  random: () => number = Math.random, mode: 'gainer' | 'korona' = 'gainer', startX = 0): CourseChunk {
  const equipment: Equipment[] = []
  const bars: Bar[] = []
  const item = (x: number, kind = pick(random, GYM_ITEMS.length)): Equipment => {
    const prototype = mode === 'korona'
      ? new Obstacle((['low', 'tall', 'cluster'] as const)[kind % 3], x, groundY, kind < 3 ? 2 : 3)
      : undefined
    const profile = prototype ?? GYM_ITEMS[kind]
    const obstacle = { x, y: groundY - profile.height, width: profile.width, height: profile.height, kind, consumed: false, prototype }
    equipment.push(obstacle)
    return obstacle
  }
  const bar = (centre: number, height: number, bobAmplitude = BAR_BOB_AMPLITUDE,
    speedFactor = mode === 'gainer' ? 0.96 - random() * 0.04 : 1): void => {
    const width = mode === 'korona' ? 22 : 44
    const itemHeight = mode === 'korona' ? 44 : 16
    const baseY = groundY - height - (itemHeight - 16) / 2
    bars.push({ x: centre - width / 2, y: baseY, baseY, width, height: itemHeight,
      phase: random() * Math.PI * 2, art: pick(random, BAR_ART.length), collected: false,
      speedFactor, bobAmplitude })
  }
  let end = 0
  switch (pattern) {
    case 'rest': return { equipment, bars, length: speed * (2.5 + random() * 1.5) }
    case 'free': {
      const height = random() < 0.55 ? 30 : 134
      const count = random() < 0.5 ? 1 : 2
      for (let i = 0; i < count; i++) bar(30 + i * speed * 0.26, height)
      end = 30 + (count - 1) * speed * 0.26 + 44
      break
    }
    case 'obstacle': {
      const obstacle = item(0)
      end = obstacle.width
      break
    }
    case 'reward': {
      const obstacle = item(0)
      bar(obstacle.width / 2 + speed * (random() - 0.5) * 0.08, 134)
      end = obstacle.width
      break
    }
    case 'precision': {
      const obstacle = item(0)
      // A later, higher reward narrows the useful takeoff window without blocking survival.
      bar(obstacle.width / 2 + speed * (0.18 + random() * 0.06), 158)
      end = obstacle.width + speed * 0.24
      break
    }
    case 'pair': {
      const first = item(0)
      const second = item(first.width + speed * (0.9 + random() * 0.25))
      if (random() < 0.6) bar(second.x + second.width / 2, 134)
      end = second.x + second.width
      break
    }
    case 'risk': {
      // The low reward follows the first stack, visibly inside the hazardous pair.
      // A safe jump clears both stacks and leaves the bar underneath the runner.
      const first = item(0, 1)
      const second = item(Math.max(first.width + 8, speed * 0.2), 1)
      bar(first.width / 2 + 10, 30)
      end = second.x + second.width
      break
    }
    case 'train': {
      const count = 5 + pick(random, 3)
      const factor = mode === 'gainer' ? 0.96 - random() * 0.04 : 1
      // Airborne chains need several jumps. Space by time at faster speeds so
      // one flight still takes two, occasionally three bars rather than the whole row.
      const spacing = Math.max(128, speed * 0.36)
      for (let i = 0; i < count; i++) bar(30 + i * spacing, 140, BAR_BOB_AMPLITUDE, factor)
      const lastCentre = 30 + (count - 1) * spacing
      end = lastCentre + 44
      // A hazard sometimes follows the chain at a varied gap. It never occupies
      // a fixed final-bar slot; the player can leave late rewards and prepare for it.
      if (random() < 0.6) {
        const kind = random() < 0.5 ? 1 : 4
        const obstacle = item(lastCentre + speed * (0.16 + random() * 0.34), kind)
        end = obstacle.x + obstacle.width
      }
      break
    }
  }
  const length = end + speed * GainerRun.BOOST_FACTOR * (1.25 + random() * 1.25)
  for (const item of equipment) item.x += startX
  for (const pickup of bars) {
    const centre = startX + pickup.x + pickup.width / 2
    pickup.x = PLAYER_CENTRE_X + (centre - PLAYER_CENTRE_X) * pickup.speedFactor - pickup.width / 2
  }
  return { equipment, bars, length }
}

/** Shared course lifecycle; Gainer adds independently flying bars to the equipment layouts. */
export class GainerCourse {
  private equipment: Equipment[] = []
  private bars: Bar[] = []
  private pickups: Pickup[] = []
  private untilSpawn = 3 * GainerRun.BASE_SPEED
  private elapsed = 0
  private bobTime = 0
  private previousPattern: CoursePattern | null = null
  private readonly images = new Map<string, HTMLImageElement>()
  private reducedMotion = false

  constructor(private readonly groundY: number, onReady: () => void, private readonly random = Math.random, private readonly mode: 'gainer' | 'korona' = 'gainer') {
    for (const name of mode === 'gainer' ? [...GYM_ITEMS.map(item => item.name), ...BAR_ART] : ['korona-bottle']) {
      const image = new Image()
      image.addEventListener('load', onReady, { once: true })
      image.src = `/items/${name}.webp`
      this.images.set(name, image)
    }
    const preference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.reducedMotion = preference?.matches ?? false
    preference?.addEventListener('change', event => { this.reducedMotion = event.matches })
  }

  reset(): void {
    this.equipment = []
    this.bars = []
    this.pickups = []
    this.untilSpawn = 3 * GainerRun.BASE_SPEED
    this.elapsed = this.bobTime = 0
    this.previousPattern = null
  }

  update(deltaTime: number, speed: number, player: CollisionBox): { hit: boolean; bars: number } {
    const travel = speed * deltaTime
    this.elapsed += deltaTime
    this.bobTime = (this.bobTime + deltaTime * 2.8) % (Math.PI * 2)
    for (const item of this.equipment) item.x -= travel
    for (const bar of this.bars) {
      // Bars travel forward in the world at 4–8% of runner speed. Subtract that
      // from the camera's ground travel: the fixed-screen runner catches them.
      bar.x -= travel * bar.speedFactor
      bar.y = bar.baseY + (this.reducedMotion ? 0 : Math.sin(this.bobTime + bar.phase) * (bar.bobAmplitude ?? BAR_BOB_AMPLITUDE))
    }
    for (const pickup of this.pickups) pickup.age += deltaTime
    this.pickups = this.pickups.filter(pickup => pickup.age < 0.65)
    this.untilSpawn -= travel
    if (this.untilSpawn <= 0) this.spawn(speed)

    // Sweep horizontal travel before culling so fast objects cannot tunnel through the player.
    const sweptPlayer = { ...player, x: player.x - travel, width: player.width + travel }
    let hit = false
    for (const item of this.equipment) {
      const profile = GYM_ITEMS[item.kind]
      const box = { x: item.x + profile.inset, y: this.groundY - profile.solidHeight,
        width: item.width - 2 * profile.inset, height: profile.solidHeight }
      if (item.prototype) item.prototype.x = item.x
      if (!item.consumed && (item.prototype
        ? item.prototype.intersects(sweptPlayer) : overlaps(box, sweptPlayer))) {
        item.consumed = true
        hit = true
      }
    }
    let bars = 0
    for (const bar of this.bars) {
      // Sweep each bar's relative approach, including speed ramps, before culling.
      const barTravel = travel * bar.speedFactor
      if (!bar.collected && overlaps(bar, { ...player, x: player.x - barTravel, width: player.width + barTravel })) {
        bar.collected = true
        bars += 1
        this.pickups.push({ x: player.x + player.width / 2, y: Math.min(player.y - 34, bar.y - 20), age: 0 })
      }
    }
    this.equipment = this.equipment.filter(item => item.x + item.width > 0)
    this.bars = this.bars.filter(item => !item.collected && item.x + item.width > 0)
    return { hit, bars }
  }

  private spawn(speed: number): void {
    const pool: CoursePattern[] = this.elapsed < 18
      ? ['free', 'reward', 'obstacle', 'reward']
      : ['rest', 'free', 'free', 'obstacle', 'reward', 'precision', 'pair']
    if (this.elapsed >= 18 && this.mode === 'gainer') {
      if (speed >= RISK_MIN_SPEED && hasReadableApproach('risk', speed)) pool.push('risk')
      if (hasReadableApproach('train', speed)) pool.push('train')
    }
    const choices = pool.filter(pattern => pattern !== this.previousPattern)
    const pattern = choices[pick(this.random, choices.length)]
    this.previousPattern = pattern
    const spawnX = Math.max(664, 120 + speed * 2.2)
    const chunk = createCourseChunk(pattern, speed, this.groundY, this.random, this.mode, spawnX)
    this.equipment.push(...chunk.equipment)
    this.bars.push(...chunk.bars)
    this.untilSpawn += chunk.length
  }

  render(context: CanvasRenderingContext2D): void {
    for (const item of this.equipment) {
      if (item.prototype) {
        item.prototype.x = item.x
        item.prototype.render(context, item.consumed)
      } else this.draw(context, GYM_ITEMS[item.kind].name, item, '#b493c8')
    }
    for (const bar of this.bars) if (!bar.collected) {
      this.draw(context, this.mode === 'korona' ? 'korona-bottle' : BAR_ART[bar.art], bar, '#ffc175')
    }
  }

  /** Render after Player and above its head, never underneath the costume. */
  renderFeedback(context: CanvasRenderingContext2D, player: CollisionBox): void {
    context.save()
    context.font = 'bold 15px monospace'
    context.textAlign = 'center'
    context.lineWidth = 3
    context.lineJoin = 'round'
    for (const pickup of this.pickups) {
      const progress = pickup.age / 0.65
      const rise = this.reducedMotion ? 0 : 34 * (1 - Math.pow(1 - progress, 3))
      const y = Math.max(24, Math.min(pickup.y - rise, player.y - 34))
      context.globalAlpha = Math.min(1, (1 - progress) * 2.5)
      context.strokeStyle = '#090611'
      context.strokeText('+1', pickup.x, y)
      context.fillStyle = '#ffc175'
      context.fillText('+1', pickup.x, y)
    }
    context.restore()
  }

  private draw(context: CanvasRenderingContext2D, name: string, box: CollisionBox, fallback: string): void {
    const image = this.images.get(name)!
    if (image.complete && image.naturalWidth > 0) {
      context.save()
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, box.x, box.y, box.width, box.height)
      context.restore()
    } else {
      context.fillStyle = fallback
      context.fillRect(box.x, box.y, box.width, box.height)
      context.fillStyle = '#130d1c'
      context.fillRect(box.x + 4, box.y + 5, box.width - 8, 3)
    }
  }
}
