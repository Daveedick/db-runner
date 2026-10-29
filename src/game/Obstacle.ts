import type { CollisionBox } from './types'

export type ObstacleKind = 'low' | 'tall' | 'cluster'

interface ObstacleSegment {
  x: number
  width: number
  height: number
}

const BLOCK_GAP = 5

export class Obstacle {
  readonly height: number
  readonly width: number

  followerCreated = false
  gapAfter = 0
  x: number

  private readonly segments: ObstacleSegment[]

  constructor(
    readonly kind: ObstacleKind,
    x: number,
    private readonly groundY: number,
    clusterSize = 2,
  ) {
    this.x = x
    this.segments = this.createSegments(clusterSize)
    this.width = this.segments.at(-1)!.x + this.segments.at(-1)!.width
    this.height = Math.max(...this.segments.map((segment) => segment.height))
  }

  update(deltaTime: number, speed: number): void {
    this.x -= speed * deltaTime
  }

  isOffscreen(): boolean {
    return this.x + this.width < 0
  }

  intersects(box: CollisionBox): boolean {
    return this.segments.some((segment) => {
      const segmentX = this.x + segment.x + 2
      const segmentY = this.groundY - segment.height + 3
      const segmentWidth = Math.max(1, segment.width - 4)
      const segmentHeight = Math.max(1, segment.height - 3)

      return (
        box.x < segmentX + segmentWidth &&
        box.x + box.width > segmentX &&
        box.y < segmentY + segmentHeight &&
        box.y + box.height > segmentY
      )
    })
  }

  render(context: CanvasRenderingContext2D, isColliding: boolean): void {
    for (const segment of this.segments) {
      const x = this.x + segment.x
      const y = this.groundY - segment.height

      context.fillStyle = isColliding ? '#ff6b6b' : '#b4ffd4'
      context.fillRect(x, y, segment.width, segment.height)

      context.fillStyle = '#080b0d'
      context.fillRect(x + 4, y + 7, Math.max(4, segment.width - 8), 3)
      context.fillRect(x + 4, y + 15, Math.max(7, segment.width * 0.45), 3)
      if (segment.height > 40) {
        context.fillRect(x + 4, y + 23, Math.max(4, segment.width - 11), 3)
      }
    }
  }

  private createSegments(clusterSize: number): ObstacleSegment[] {
    if (this.kind === 'low') return [{ x: 0, width: 24, height: 34 }]
    if (this.kind === 'tall') return [{ x: 0, width: 28, height: 52 }]

    return Array.from({ length: clusterSize }, (_, index) => ({
      x: index * (20 + BLOCK_GAP),
      width: 20,
      height: index % 2 === 0 ? 34 : 44,
    }))
  }
}
