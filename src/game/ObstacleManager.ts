import { Obstacle, type ObstacleKind } from './Obstacle'
import type { CollisionBox } from './types'

const SAFE_START_TIME = 3
const MAX_DUPLICATE_TYPES = 2
const MIN_GAP = 190
const MAX_GAP_FACTOR = 1.45
const JUMP_CYCLE_SECONDS = 0.9
const SPAWN_MARGIN = 24

interface ObstacleTypeConfig {
  kind: ObstacleKind
  unlockTime: number
}

const OBSTACLE_TYPES: ObstacleTypeConfig[] = [
  { kind: 'low', unlockTime: 0 },
  { kind: 'tall', unlockTime: 8 },
  { kind: 'cluster', unlockTime: 12 },
]

export class ObstacleManager {
  private readonly obstacles: Obstacle[] = []
  private readonly history: ObstacleKind[] = []
  private elapsedTime = 0

  constructor(
    private readonly sceneWidth: number,
    private readonly groundY: number,
  ) {}

  update(deltaTime: number, speed: number, playerBox: CollisionBox): boolean {
    this.elapsedTime += deltaTime

    for (const obstacle of this.obstacles) {
      obstacle.update(deltaTime, speed)
    }

    while (this.obstacles[0]?.isOffscreen()) {
      this.obstacles.shift()
    }

    if (this.elapsedTime >= SAFE_START_TIME) {
      const lastObstacle = this.obstacles.at(-1)

      if (!lastObstacle) {
        this.spawn(speed)
      } else if (
        !lastObstacle.followerCreated &&
        lastObstacle.x + lastObstacle.width + lastObstacle.gapAfter <= this.sceneWidth
      ) {
        lastObstacle.followerCreated = true
        this.spawn(speed)
      }
    }

    return this.obstacles.some((obstacle) => obstacle.intersects(playerBox))
  }

  render(context: CanvasRenderingContext2D, playerBox: CollisionBox): void {
    for (const obstacle of this.obstacles) {
      obstacle.render(context, obstacle.intersects(playerBox))
    }
  }

  private spawn(speed: number): void {
    const kind = this.chooseKind()
    const clusterSize = this.elapsedTime >= 22 && Math.random() > 0.55 ? 3 : 2
    const obstacle = new Obstacle(
      kind,
      this.sceneWidth + SPAWN_MARGIN,
      this.groundY,
      clusterSize,
    )

    const minGap = Math.max(
      MIN_GAP,
      speed * JUMP_CYCLE_SECONDS + obstacle.width * 0.25,
    )
    obstacle.gapAfter = minGap + Math.random() * minGap * (MAX_GAP_FACTOR - 1)

    this.obstacles.push(obstacle)
    this.history.unshift(kind)
    this.history.splice(MAX_DUPLICATE_TYPES)
  }

  private chooseKind(): ObstacleKind {
    const eligibleKinds = OBSTACLE_TYPES.filter(
      ({ unlockTime }) => this.elapsedTime >= unlockTime,
    ).map(({ kind }) => kind)

    const repeatedKind =
      this.history.length === MAX_DUPLICATE_TYPES &&
      this.history.every((kind) => kind === this.history[0])
        ? this.history[0]
        : null
    const candidates = eligibleKinds.filter((kind) => kind !== repeatedKind)
    const pool = candidates.length > 0 ? candidates : eligibleKinds

    return pool[Math.floor(Math.random() * pool.length)]!
  }
}
