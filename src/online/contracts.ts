export const ONLINE_RULESET = 'gainer-v0.6' as const

export interface RunSubmission {
  runId: string
  ruleset: typeof ONLINE_RULESET
  metres: number
  seconds: number
  bars: number
  maxSpeedKmh: number
}

export interface OnlineBest {
  metres: number
  achievedAt: string
}

export interface GuestProfile {
  id: string
  nickname: string | null
  participating: boolean
  best: OnlineBest | null
  hasRecoveryCode: boolean
}

export interface LeaderboardEntry {
  playerId: string
  rank: number
  nickname: string
  metres: number
  achievedAt: string
}

export interface Leaderboard {
  entries: LeaderboardEntry[]
  me: LeaderboardEntry | null
  total: number
}

export interface SharedRun {
  id: string
  nickname: string
  metres: number
  seconds: number
  bars: number
  maxSpeedKmh: number
  publishedAt: string
}

export interface ShareResponse {
  share: SharedRun
  url: string
}

export interface ApiErrorResponse {
  error: string
  code?: string
}
