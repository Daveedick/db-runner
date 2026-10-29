/** Distance is world travel, not wall-clock time; 35 logical pixels = one metre. */
export class GainerRun {
  static readonly BASE_SPEED = 25 / 3.6 * 35
  static readonly BARS_PER_BOOST = 5
  static readonly BOOST_FACTOR = 1.15
  speed = GainerRun.BASE_SPEED
  maxSpeedKmh = this.kilometresPerHour
  distance = 0
  seconds = 0
  lives = 3
  bars = 0
  invulnerability = 0

  get finished(): boolean { return this.lives === 0 }

  get speedLevel(): number { return Math.floor(this.bars / GainerRun.BARS_PER_BOOST) }
  get barsUntilBoost(): number {
    return GainerRun.BARS_PER_BOOST - this.bars % GainerRun.BARS_PER_BOOST
  }
  get targetSpeed(): number { return GainerRun.BASE_SPEED * GainerRun.BOOST_FACTOR ** this.speedLevel }
  get kilometresPerHour(): number { return this.speed / 35 * 3.6 }

  update(deltaTime: number, speed = this.speed): void {
    if (this.finished) return
    this.seconds += deltaTime
    this.distance += speed * deltaTime / 35
    this.invulnerability = Math.max(0, this.invulnerability - deltaTime)
    // Each multiplicative step takes one active second; inactive runs never advance.
    this.speed = Math.min(this.targetSpeed, this.speed * GainerRun.BOOST_FACTOR ** deltaTime)
    this.maxSpeedKmh = Math.max(this.maxSpeedKmh, this.kilometresPerHour)
  }

  hit(): boolean {
    if (this.finished || this.invulnerability > 0) return false
    this.lives -= 1
    this.invulnerability = 1.2
    return true
  }

  reset(): void {
    this.distance = this.seconds = this.bars = this.invulnerability = 0
    this.lives = 3
    this.speed = GainerRun.BASE_SPEED
    this.maxSpeedKmh = this.kilometresPerHour
  }
}
