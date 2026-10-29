import type { CollisionBox, GameSize } from './types'

// ~18% longer than Corona's original arc, retaining iteration 3's apex height.
const GAINER_GRAVITY = 1_450
const GAINER_JUMP_VELOCITY = -624
const JUMP_BUFFER_SECONDS = 0.14
const SPRITE_PATHS = {
  classic: { legacy: '/player-sprite.png?v=5', restored: '/player-sprite-restored.png' },
  diesel: { legacy: '/player-sprite-diesel.png', restored: '/player-sprite-diesel-restored.png' },
} as const
const SPRITE_COLUMNS = 3
const SPRITE_ROWS = 2
const SPRITE_DRAW_SIZE = 80
const SPRITE_BASELINE = 69
const SPRITE_OFFSET_X = -21
const RUN_FRAMES = [1, 2, 3, 4] as const
const RUN_FRAMES_PER_SECOND = 8

export type PlayerArt = 'restored' | 'legacy'
export type RunnerVariant = keyof typeof SPRITE_PATHS

interface SpriteAsset {
  image: HTMLImageElement
  usesLegacyArt: boolean
}

export function resolvePlayerArt(search: string): PlayerArt {
  const runner = new URLSearchParams(search).get('runner')
  return runner === 'refactored' || runner === 'restored' ? 'restored' : 'legacy'
}

export class Player {
  readonly width = 30
  readonly height = 46
  readonly x = 84

  y = 0
  velocityY = 0
  isGrounded = true

  private readonly sprites: Partial<Record<RunnerVariant, SpriteAsset>>
  private variant: RunnerVariant = 'classic'
  private animationTime = 0
  private jumpBufferTime = 0

  constructor(private readonly onSpriteReady: () => void, private readonly art: PlayerArt = 'legacy') {
    this.sprites = {
      classic: this.loadSprite('classic', art, onSpriteReady),
    }
  }

  setVariant(variant: RunnerVariant): void {
    // A costume change never resets a jump or the current animation phase.
    this.variant = variant
    this.clearJumpBuffer()
  }

  captureMotion() {
    return { y: this.y, velocityY: this.velocityY, isGrounded: this.isGrounded, animationTime: this.animationTime }
  }

  restoreMotion(motion: ReturnType<Player['captureMotion']>): void {
    Object.assign(this, motion)
  }

  private get sprite(): HTMLImageElement {
    return this.spriteAsset.image
  }

  private get usesLegacyArt(): boolean {
    return this.spriteAsset.usesLegacyArt
  }

  private get spriteAsset(): SpriteAsset {
    return this.sprites[this.variant] ??= this.loadSprite(this.variant, this.art, this.onSpriteReady)
  }

  private loadSprite(variant: RunnerVariant, art: PlayerArt, onReady: () => void): SpriteAsset {
    const asset = { image: new Image(), usesLegacyArt: art === 'legacy' }
    asset.image.addEventListener('load', onReady, { once: true })
    asset.image.addEventListener('error', () => {
      // Fall back within the selected costume, never silently change the hero.
      if (!asset.usesLegacyArt) {
        asset.usesLegacyArt = true
        asset.image.src = SPRITE_PATHS[variant].legacy
      } else {
        onReady()
      }
    })
    asset.image.src = SPRITE_PATHS[variant][art]
    return asset
  }

  get collisionBox(): CollisionBox {
    return {
      x: this.x + 3,
      y: this.y + 3,
      width: this.width - 6,
      height: this.height - 5,
    }
  }

  reset(groundY: number): void {
    this.y = groundY - this.height
    this.velocityY = 0
    this.isGrounded = true
    this.animationTime = 0
    this.clearJumpBuffer()
  }

  clearJumpBuffer(): void { this.jumpBufferTime = 0 }

  jump(): void {
    if (!this.isGrounded) {
      this.jumpBufferTime = JUMP_BUFFER_SECONDS
      return
    }

    this.clearJumpBuffer()
    this.velocityY = GAINER_JUMP_VELOCITY
    this.isGrounded = false
  }

  update(deltaTime: number, groundY: number): void {
    this.animationTime += deltaTime
    this.jumpBufferTime = Math.max(0, this.jumpBufferTime - deltaTime)

    if (this.isGrounded) return

    this.velocityY += GAINER_GRAVITY * deltaTime
    this.y += this.velocityY * deltaTime

    const floorY = groundY - this.height
    if (this.y >= floorY) {
      this.y = floorY
      this.velocityY = 0
      this.isGrounded = true
      if (this.jumpBufferTime > 0) this.jump()
    }
  }

  render(context: CanvasRenderingContext2D, size: GameSize, isPlaying: boolean): void {
    const floorY = size.height - 56
    const heightAboveGround = Math.max(0, floorY - (this.y + this.height))
    const shadowScale = Math.max(0.25, 1 - heightAboveGround / 180)

    context.fillStyle = 'rgba(6, 3, 12, 0.55)'
    context.fillRect(
      this.x + this.width * (1 - shadowScale) * 0.5,
      floorY + 7,
      this.width * shadowScale,
      3,
    )

    if (!this.sprite.complete || this.sprite.naturalWidth === 0) {
      this.renderFallback(context)
      return
    }

    const frame = this.currentFrame(isPlaying)
    // Sample the full-resolution atlas directly; never shrink it to 64px cells.
    const frameWidth = this.sprite.naturalWidth / SPRITE_COLUMNS
    const frameHeight = this.sprite.naturalHeight / SPRITE_ROWS
    const sourceX = (frame % SPRITE_COLUMNS) * frameWidth
    const sourceY = Math.floor(frame / SPRITE_COLUMNS) * frameHeight
    const drawX = this.x + SPRITE_OFFSET_X
    const drawY = this.y + this.height - SPRITE_BASELINE

    context.save()
    // Smooth only the detailed source's downsampling. The legacy pixel grid and
    // gym rendering keep their existing nearest-neighbor treatment.
    context.imageSmoothingEnabled = !this.usesLegacyArt
    if (!this.usesLegacyArt) context.imageSmoothingQuality = 'high'
    context.drawImage(
      this.sprite,
      sourceX,
      sourceY,
      frameWidth,
      frameHeight,
      drawX,
      drawY,
      SPRITE_DRAW_SIZE,
      SPRITE_DRAW_SIZE,
    )
    context.restore()
  }

  private currentFrame(isPlaying: boolean): number {
    if (!this.isGrounded) return 5
    if (!isPlaying) return 0

    const frameIndex = Math.floor(this.animationTime * RUN_FRAMES_PER_SECOND)
    return RUN_FRAMES[frameIndex % RUN_FRAMES.length]
  }

  private renderFallback(context: CanvasRenderingContext2D): void {
    context.fillStyle = '#b4ffd4'
    context.fillRect(this.x, this.y, this.width, this.height)

    context.fillStyle = '#080b0d'
    context.fillRect(this.x + 19, this.y + 9, 5, 5)
    context.fillRect(this.x + 4, this.y + this.height - 8, 7, 8)
    context.fillRect(this.x + 20, this.y + this.height - 8, 7, 8)
  }
}
