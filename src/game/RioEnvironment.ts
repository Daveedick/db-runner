import type { SceneBounds } from './GymEnvironment'

const CITY_WIDTH = 1000
const CITY_HEIGHT = 572
// Push the car meet into the second plane without shrinking the playable road.
const MEET_SCALE = 0.85
const MEET_WIDTH = 900 * MEET_SCALE
const MEET_HEIGHT = 514 * MEET_SCALE
const ROAD_WIDTH = 900
const ROAD_HEIGHT = 128
const LANDMARK_SPACING = 2400

/** Decorative layers only; no people, cars or signs participate in collisions. */
export class RioEnvironment {
  private readonly skyline = new Image()
  private readonly landmark = new Image()
  private readonly meet = new Image()
  private road: HTMLCanvasElement | null = null
  private cityOffset = 0
  private landmarkOffset = 0
  private meetOffset = 0
  private roadOffset = 0

  constructor(onReady: () => void) {
    for (const [image, path] of [
      [this.skyline, '/environment/rio-skyline.webp'],
      [this.landmark, '/environment/rio-landmark.webp'],
      [this.meet, '/environment/rio-meet-korona.webp'],
    ] as const) {
      image.addEventListener('load', () => {
        if (image === this.meet) this.road = this.createRoad()
        onReady()
      }, { once: true })
      image.addEventListener('error', onReady, { once: true })
      image.src = path
    }
  }

  update(deltaTime: number, worldSpeed: number): void {
    const distance = deltaTime * worldSpeed
    // A long landmark loop is independent of the repeated street: no statue per bay.
    this.landmarkOffset = (this.landmarkOffset + distance * 0.018) % LANDMARK_SPACING
    this.cityOffset = (this.cityOffset + distance * 0.07) % (CITY_WIDTH * 2)
    this.meetOffset = (this.meetOffset + distance * 0.32) % MEET_WIDTH
    this.roadOffset = (this.roadOffset + distance) % ROAD_WIDTH
  }

  render(context: CanvasRenderingContext2D, bounds: SceneBounds, groundY: number): void {
    const width = bounds.right - bounds.left
    context.save()
    context.imageSmoothingEnabled = false
    context.fillStyle = '#06142c'
    context.fillRect(bounds.left, bounds.top, width, bounds.bottom - bounds.top)

    if (this.ready(this.skyline)) {
      const first = Math.floor((bounds.left + this.cityOffset) / CITY_WIDTH)
      const last = Math.ceil((bounds.right + this.cityOffset) / CITY_WIDTH)
      for (let tile = first; tile < last; tile++) {
        const x = Math.round(tile * CITY_WIDTH - this.cityOffset)
        // Alternating the text-free panorama gives identical pixels at sky joins.
        if (tile % 2 !== 0) {
          context.save()
          context.translate(x + CITY_WIDTH, 0)
          context.scale(-1, 1)
          context.drawImage(this.skyline, 0, -140, CITY_WIDTH, CITY_HEIGHT)
          context.restore()
        } else {
          context.drawImage(this.skyline, x, -140, CITY_WIDTH, CITY_HEIGHT)
        }
      }
    }

    if (this.ready(this.landmark)) {
      const first = Math.floor((bounds.left - 320 + this.landmarkOffset) / LANDMARK_SPACING)
      const last = Math.ceil((bounds.right - 320 + this.landmarkOffset) / LANDMARK_SPACING)
      for (let tile = first; tile <= last; tile++) {
        const x = Math.round(320 + tile * LANDMARK_SPACING - this.landmarkOffset)
        if (x + 240 < bounds.left || x > bounds.right) continue
        context.drawImage(this.landmark, x, 12, 240, 240)
      }
    }

    // Asphalt continues below the logical scene in tall viewports, not a stretched road.
    context.fillStyle = '#0a0d19'
    context.fillRect(bounds.left, groundY - 21, width, Math.max(0, bounds.bottom - groundY + 21))
    const firstMeet = Math.floor((bounds.left + this.meetOffset) / MEET_WIDTH)
    const lastMeet = Math.ceil((bounds.right + this.meetOffset) / MEET_WIDTH)
    for (let tile = firstMeet; tile < lastMeet; tile++) {
      const x = Math.round(tile * MEET_WIDTH - this.meetOffset)
      if (this.ready(this.meet)) {
        // Art's curb is at ~71% source height; park cars behind the player's lane.
        context.drawImage(this.meet, x, groundY - 38 - MEET_HEIGHT * 0.71, MEET_WIDTH, MEET_HEIGHT)
      } else {
        this.drawFallback(context, x, groundY)
      }
    }

    if (this.road) {
      const first = Math.floor((bounds.left + this.roadOffset) / ROAD_WIDTH)
      const last = Math.ceil((bounds.right + this.roadOffset) / ROAD_WIDTH)
      for (let tile = first; tile < last; tile++) {
        context.drawImage(this.road, Math.round(tile * ROAD_WIDTH - this.roadOffset), groundY - 21)
      }
    }
    context.restore()
  }

  private ready(image: HTMLImageElement): boolean {
    return image.complete && image.naturalWidth > 0
  }

  private createRoad(): HTMLCanvasElement {
    const road = document.createElement('canvas')
    road.width = ROAD_WIDTH
    road.height = ROAD_HEIGHT
    const context = road.getContext('2d')!
    context.imageSmoothingEnabled = false
    const sourceY = Math.round(this.meet.naturalHeight * 0.76)
    context.drawImage(this.meet, 0, sourceY, this.meet.naturalWidth, this.meet.naturalHeight - sourceY,
      0, 0, ROAD_WIDTH, ROAD_HEIGHT)
    const fade = context.createLinearGradient(0, 0, 0, ROAD_HEIGHT)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    fade.addColorStop(0.15, 'rgba(0, 0, 0, 1)')
    fade.addColorStop(0.55, 'rgba(0, 0, 0, 1)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.globalCompositeOperation = 'destination-in'
    context.fillStyle = fade
    context.fillRect(0, 0, ROAD_WIDTH, ROAD_HEIGHT)
    return road
  }

  private drawFallback(context: CanvasRenderingContext2D, x: number, groundY: number): void {
    // A deliberately simple loading/error fallback; never draw a broken image.
    context.fillStyle = '#12213a'
    context.fillRect(x, groundY - 40, MEET_WIDTH, 19)
    context.fillStyle = '#ffca79'
    context.font = 'bold 22px monospace'
    context.fillText('KORONA →', x + 440, groundY - 105)
    context.font = 'bold 10px monospace'
    context.fillText('EXTRA', x + 476, groundY - 90)
  }
}
