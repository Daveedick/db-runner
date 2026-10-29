import { ONLINE_RULESET, type RunSubmission } from '../src/online/contracts.js'
import { GainerRun } from '../src/game/GainerRun.js'

const BASE_SPEED_KMH = new GainerRun().kilometresPerHour

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'invalid_request') {
    super(message)
  }
}

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Ожидается JSON-объект.')
  }
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) {
    throw new ApiError(400, 'Неизвестное поле запроса.')
  }
  return result
}

export function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Введите никнейм.', 'invalid_nickname')
  const normalized = value.normalize('NFC').trim().replace(/ +/g, ' ')
  if (!/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}_ -]{2,24}$/u.test(normalized)) {
    throw new ApiError(400, 'Ник: 2–24 символа, буквы, цифры, пробел, дефис или подчёркивание.', 'invalid_nickname')
  }
  return normalized
}

function finite(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

/** Plausibility checks, not proof of an honest run. The game still runs on an untrusted client. */
export function runSubmission(value: unknown): RunSubmission {
  const run = object(value, ['runId', 'ruleset', 'metres', 'seconds', 'bars', 'maxSpeedKmh'])
  if (typeof run.runId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(run.runId)) {
    throw new ApiError(400, 'Недопустимый идентификатор забега.')
  }
  if (run.ruleset !== ONLINE_RULESET) throw new ApiError(400, 'Эта версия правил больше не принимается.', 'ruleset_mismatch')
  // Storage/safety bounds allow up to a day of active play and extremely large distances.
  // Peak speed has no arbitrary fixed cap: the existing multiplicative rules bound it.
  if (!finite(run.seconds, 86_400) || !finite(run.metres, Number.MAX_SAFE_INTEGER) ||
      !finite(run.bars, 1_000_000) || !Number.isInteger(run.bars) ||
      !finite(run.maxSpeedKmh, Number.MAX_SAFE_INTEGER) || run.maxSpeedKmh < BASE_SPEED_KMH - 0.01) {
    throw new ApiError(400, 'Недопустимые значения результата.', 'invalid_run')
  }
  const { seconds, metres, bars, maxSpeedKmh } = run
  const maxLevel = Math.floor(bars / GainerRun.BARS_PER_BOOST)
  const speedFromBars = BASE_SPEED_KMH * GainerRun.BOOST_FACTOR ** maxLevel
  const speedFromTime = BASE_SPEED_KMH * GainerRun.BOOST_FACTOR ** (seconds + 1)
  // A second of tolerance accepts the existing floored run-history display values.
  // Pickups can arrive in small groups; this deliberately generous bound rejects floods.
  if (bars > (seconds + 1) * 20 + 10 || maxSpeedKmh > speedFromBars * 1.001 + 0.01 ||
      maxSpeedKmh > speedFromTime * 1.001 + 0.01 ||
      metres + 8 < Math.max(0, seconds - 1) * BASE_SPEED_KMH / 3.6 ||
      metres > (seconds + 1) * maxSpeedKmh / 3.6 + 1) {
    throw new ApiError(400, 'Результат не соответствует правилам игры.', 'implausible_run')
  }
  return { runId: run.runId, ruleset: ONLINE_RULESET, metres, seconds, bars, maxSpeedKmh }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
