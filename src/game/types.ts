export type GameState = 'paused' | 'playing' | 'gameover'

export type InputAction = 'jump' | 'pause'

export interface GameSize {
  width: number
  height: number
}

export interface CollisionBox {
  x: number
  y: number
  width: number
  height: number
}
