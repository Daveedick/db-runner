export interface RunResult {
  date: string
  metres: number
  seconds: number
  bars: number
  /** Absent in runs saved before speed tracking was introduced. */
  maxSpeedKmh?: number
}

interface HistoryData {
  version: 1
  best: number
  totalRuns: number
  results: RunResult[]
}

const LIMIT = 20
const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const validSpeed = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

function normalizeResult(result: RunResult): RunResult {
  const { date, metres, seconds, bars, maxSpeedKmh } = result
  return { date, metres, seconds, bars, ...(validSpeed(maxSpeedKmh) ? { maxSpeedKmh } : {}) }
}

function validResult(value: unknown): value is RunResult {
  if (!value || typeof value !== 'object') return false
  const row = value as RunResult
  return typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)) &&
    whole(row.metres) && whole(row.seconds) && whole(row.bars)
}

export class RunHistory {
  data: HistoryData = { version: 1, best: 0, totalRuns: 0, results: [] }
  persistent = true
  private storage?: Pick<Storage, 'getItem' | 'setItem'>

  private readonly key: string

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>, mode: 'gainer' | 'korona' = 'gainer') {
    this.key = `db-runner.${mode}.history.v1`
    try {
      this.storage = storage ?? globalThis.localStorage
      if (!this.storage) { this.persistent = false; return }
      const raw = this.storage.getItem(this.key)
      if (!raw) return
      const saved = JSON.parse(raw) as HistoryData
      if (saved?.version !== 1 || !Array.isArray(saved.results)) return
      const results = saved.results.filter(validResult).slice(0, LIMIT).map(normalizeResult)
      this.data = {
        version: 1, results,
        best: Math.max(whole(saved.best) ? saved.best : 0, ...results.map(row => row.metres)),
        totalRuns: Math.max(whole(saved.totalRuns) ? saved.totalRuns : 0, results.length),
      }
    } catch {
      // Corrupt or blocked browser storage must not prevent a run.
      this.persistent = false
    }
  }

  add(result: RunResult): boolean {
    if (!validResult(result)) return false
    const newBest = result.metres > this.data.best
    this.data.best = Math.max(this.data.best, result.metres)
    this.data.totalRuns += 1
    this.data.results = [normalizeResult(result), ...this.data.results].slice(0, LIMIT)
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data))
      this.persistent = Boolean(this.storage)
    } catch { this.persistent = false }
    return newBest
  }
}
