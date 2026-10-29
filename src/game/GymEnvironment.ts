/** Scenery only: the player, collisions and input stay in the logical game world. */
export interface SceneBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const BAY_WIDTH = 720
const BAY_HEIGHT = 405
const FLOOR_HEIGHT = 112
const WALL_SPEED = 0.32

export class GymEnvironment {
  private readonly plate = new Image()
  private floor: HTMLCanvasElement | null = null
  private wallOffset = 0
  private floorOffset = 0

  constructor(onReady: () => void) {
    this.plate.addEventListener('load', () => {
      this.floor = this.createFloor()
      onReady()
    }, { once: true })
    // Missing decorative art must never prevent gameplay.
    this.plate.addEventListener('error', onReady, { once: true })
    this.plate.src = '/environment/neon-gym.webp'
  }

  update(deltaTime: number, worldSpeed: number): void {
    // Bounded phases stay continuous for long runs and do not change on resize.
    this.wallOffset = (this.wallOffset + worldSpeed * WALL_SPEED * deltaTime) % BAY_WIDTH
    this.floorOffset = (this.floorOffset + worldSpeed * deltaTime) % BAY_WIDTH
  }

  render(context: CanvasRenderingContext2D, bounds: SceneBounds, groundY: number): void {
    const width = bounds.right - bounds.left
    context.save()
    context.imageSmoothingEnabled = false
    context.fillStyle = '#090611'
    context.fillRect(bounds.left, bounds.top, width, bounds.bottom - bounds.top)

    this.drawCeilingExtension(context, bounds)

    const firstBay = Math.floor((bounds.left + this.wallOffset) / BAY_WIDTH)
    const lastBay = Math.ceil((bounds.right + this.wallOffset) / BAY_WIDTH)
    const isReady = this.plate.complete && this.plate.naturalWidth > 0
    for (let bay = firstBay; bay < lastBay; bay += 1) {
      const x = Math.round(bay * BAY_WIDTH - this.wallOffset)
      if (isReady) {
        context.drawImage(this.plate, x, 0, BAY_WIDTH, BAY_HEIGHT)
      } else {
        this.drawFallback(context, x, groundY)
      }
      // An architectural pier hides the small edge mismatch of the repeated art.
      context.fillStyle = '#0c0813'
      context.fillRect(x - 3, 0, 6, groundY - 21)
      context.fillStyle = '#24172d'
      context.fillRect(x + 3, 80, 1, groundY - 101)
    }

    // The ground plane is independent of the distant wall. It moves at world speed.
    const floorY = groundY - 21
    context.fillStyle = '#0c0813'
    context.fillRect(bounds.left, floorY, width, Math.max(0, bounds.bottom - floorY))
    if (this.floor) {
      const firstFloor = Math.floor((bounds.left + this.floorOffset) / BAY_WIDTH)
      const lastFloor = Math.ceil((bounds.right + this.floorOffset) / BAY_WIDTH)
      for (let tile = firstFloor; tile < lastFloor; tile += 1) {
        context.drawImage(this.floor, Math.round(tile * BAY_WIDTH - this.floorOffset), floorY)
      }
    }

    // Sparse floor seams extend the room into portrait viewports, never the physics.
    context.fillStyle = '#160e1e'
    for (let y = groundY + 70; y < bounds.bottom; y += 96) {
      context.fillRect(bounds.left, y, width, 1)
    }
    context.restore()
  }

  private createFloor(): HTMLCanvasElement {
    const tile = document.createElement('canvas')
    tile.width = BAY_WIDTH
    tile.height = FLOOR_HEIGHT
    const context = tile.getContext('2d')!
    context.imageSmoothingEnabled = false
    // This source is the regenerated shipping plate, not the approved concept.
    const sourceY = Math.round(this.plate.naturalHeight * 0.715)
    context.drawImage(this.plate, 0, sourceY,
      this.plate.naturalWidth, this.plate.naturalHeight - sourceY,
      0, 0, BAY_WIDTH, FLOOR_HEIGHT)
    const fade = context.createLinearGradient(0, 0, 0, FLOOR_HEIGHT)
    fade.addColorStop(0, 'rgba(0, 0, 0, 1)')
    fade.addColorStop(0.5, 'rgba(0, 0, 0, 1)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.globalCompositeOperation = 'destination-in'
    context.fillStyle = fade
    context.fillRect(0, 0, BAY_WIDTH, FLOOR_HEIGHT)
    return tile
  }

  private drawCeilingExtension(context: CanvasRenderingContext2D, bounds: SceneBounds): void {
    // Recycled geometry above the 16:9 scene fills tall screens without stretching art.
    context.fillStyle = '#130d1c'
    for (let y = -96; y > bounds.top - 96; y -= 96) {
      context.fillRect(bounds.left, y, bounds.right - bounds.left, 5)
    }
    const offset = this.wallOffset % 180
    for (let x = Math.floor((bounds.left + offset) / 180) * 180 - offset;
      x < bounds.right; x += 180) {
      context.fillStyle = '#100b18'
      context.fillRect(Math.round(x), bounds.top, 12, -bounds.top)
      context.fillStyle = '#1e1327'
      context.fillRect(Math.round(x), bounds.top, 1, -bounds.top)
    }
  }

  private drawFallback(context: CanvasRenderingContext2D, x: number, groundY: number): void {
    context.fillStyle = '#1b1027'
    context.fillRect(x, 85, BAY_WIDTH, groundY - 100)
    context.fillStyle = '#100a19'
    context.fillRect(x + 25, 130, 300, groundY - 155)
    context.fillStyle = '#dc8df6'
    context.fillRect(x + 110, 54, 100, 3)
    context.fillStyle = '#ffc175'
    context.font = 'bold 20px monospace'
    context.fillText('GAINER →', x + 425, 155)
  }
}
