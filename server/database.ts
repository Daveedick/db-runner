import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GuestProfile, Leaderboard, LeaderboardEntry, OnlineBest, RunSubmission, SharedRun } from '../src/online/contracts.js'
import { ONLINE_RULESET } from '../src/online/contracts.js'
import { ApiError } from './validation.js'

type Row = Record<string, string | number | null>
const token = (): string => randomBytes(32).toString('base64url')
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const encodeRun = (run: RunSubmission): string => JSON.stringify(run)

export class OnlineDatabase {
  readonly sqlite: DatabaseSync

  constructor(path: string, private readonly now: () => number = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.sqlite = new DatabaseSync(path)
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    const version = this.sqlite.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 1) {
      this.sqlite.close()
      throw new Error('The online database schema is newer than this server. Restore the matching server version.')
    }
    if (version.user_version === 0) this.sqlite.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        nickname TEXT,
        participating INTEGER NOT NULL DEFAULT 0 CHECK(participating IN (0,1)),
        recovery_hash TEXT UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE bests (
        player_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        ruleset TEXT NOT NULL,
        run_id TEXT NOT NULL,
        metres INTEGER NOT NULL,
        achieved_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(player_id, ruleset)
      );
      CREATE INDEX bests_ranking ON bests(ruleset, metres DESC, achieved_at ASC, player_id ASC);
      CREATE TABLE shared_runs (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        metres INTEGER NOT NULL,
        seconds REAL NOT NULL,
        bars INTEGER NOT NULL,
        max_speed_kmh REAL NOT NULL,
        published_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(player_id, run_id)
      );
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }

  close(): void { this.sqlite.close() }

  private transaction<T>(operation: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.sqlite.exec('COMMIT')
      return value
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  playerForSession(rawToken: string | undefined): string | null {
    if (!rawToken || !/^[a-zA-Z0-9_-]{43}$/.test(rawToken)) return null
    const row = this.sqlite.prepare('SELECT player_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(digest(rawToken), this.now()) as Row | undefined
    return row ? String(row.player_id) : null
  }

  private session(playerId: string): string {
    const rawToken = token()
    this.sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now())
    this.sqlite.prepare('INSERT INTO sessions(token_hash, player_id, expires_at) VALUES (?, ?, ?)')
      .run(digest(rawToken), playerId, this.now() + 365 * 86_400_000)
    return rawToken
  }

  createProfile(name?: string): { profile: GuestProfile; sessionToken: string } {
    return this.transaction(() => {
      const id = randomBytes(16).toString('base64url')
      this.sqlite.prepare('INSERT INTO profiles(id, nickname, created_at) VALUES (?, ?, ?)')
        .run(id, name ?? null, new Date(this.now()).toISOString())
      const sessionToken = this.session(id)
      return { profile: this.profile(id)!, sessionToken }
    })
  }

  profile(id: string): GuestProfile | null {
    const row = this.sqlite.prepare(`SELECT p.id, p.nickname, p.participating, p.recovery_hash,
      b.metres, b.achieved_at FROM profiles p LEFT JOIN bests b ON b.player_id = p.id AND b.ruleset = ? WHERE p.id = ?`)
      .get(ONLINE_RULESET, id) as Row | undefined
    return row ? {
      id: String(row.id), nickname: row.nickname === null ? null : String(row.nickname),
      participating: Boolean(row.participating), hasRecoveryCode: row.recovery_hash !== null,
      best: row.metres === null ? null : { metres: Number(row.metres), achievedAt: String(row.achieved_at) },
    } : null
  }

  updateProfile(id: string, values: { nickname?: string; participating?: boolean }): GuestProfile {
    return this.transaction(() => {
      const profile = this.profile(id)
      if (!profile) throw new ApiError(401, 'Профиль не найден.', 'unauthorized')
      if (values.participating === true && !(values.nickname ?? profile.nickname)) {
        throw new ApiError(400, 'Сначала укажите никнейм.', 'nickname_required')
      }
      this.sqlite.prepare('UPDATE profiles SET nickname = ?, participating = ? WHERE id = ?')
        .run(values.nickname ?? profile.nickname, Number(values.participating ?? profile.participating), id)
      return this.profile(id)!
    })
  }

  submit(id: string, run: RunSubmission): OnlineBest {
    return this.transaction(() => {
      const profile = this.profile(id)
      if (!profile?.participating) throw new ApiError(409, 'Включите участие в рейтинге.', 'participation_required')
      const payload = encodeRun(run)
      this.assertRunMatches(id, run, payload)
      this.sqlite.prepare(`INSERT INTO bests(player_id, ruleset, run_id, metres, achieved_at, payload) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, ruleset) DO UPDATE SET run_id = excluded.run_id, metres = excluded.metres,
          achieved_at = excluded.achieved_at, payload = excluded.payload WHERE excluded.metres > bests.metres`)
        .run(id, run.ruleset, run.runId, Math.floor(run.metres), new Date(this.now()).toISOString(), payload)
      return this.profile(id)!.best!
    })
  }

  leaderboard(playerId: string | null): Leaderboard {
    const ranked = `SELECT b.player_id, p.nickname, b.metres, b.achieved_at,
      ROW_NUMBER() OVER (ORDER BY b.metres DESC, b.achieved_at ASC, b.player_id ASC) AS rank
      FROM bests b JOIN profiles p ON p.id = b.player_id WHERE b.ruleset = ? AND p.participating = 1`
    const map = (row: Row): LeaderboardEntry => ({
      playerId: String(row.player_id), nickname: String(row.nickname), metres: Number(row.metres),
      achievedAt: String(row.achieved_at), rank: Number(row.rank),
    })
    const rows = this.sqlite.prepare(`${ranked} ORDER BY rank LIMIT 50`).all(ONLINE_RULESET) as Row[]
    const me = playerId ? this.sqlite.prepare(`SELECT * FROM (${ranked}) WHERE player_id = ?`)
      .get(ONLINE_RULESET, playerId) as Row | undefined : undefined
    const count = this.sqlite.prepare(`SELECT COUNT(*) AS total FROM bests b JOIN profiles p ON p.id = b.player_id
      WHERE b.ruleset = ? AND p.participating = 1`).get(ONLINE_RULESET) as Row
    return { entries: rows.map(map), me: me ? map(me) : null, total: Number(count.total) }
  }

  private shareFromRow(row: Row): SharedRun {
    return { id: String(row.id), nickname: String(row.nickname), metres: Number(row.metres),
      seconds: Number(row.seconds), bars: Number(row.bars), maxSpeedKmh: Number(row.max_speed_kmh),
      publishedAt: String(row.published_at) }
  }

  private assertRunMatches(playerId: string, run: RunSubmission, payload: string): void {
    const known = this.sqlite.prepare(`SELECT payload FROM bests WHERE player_id = ? AND run_id = ?
      UNION ALL SELECT payload FROM shared_runs WHERE player_id = ? AND run_id = ?`)
      .all(playerId, run.runId, playerId, run.runId) as Row[]
    if (known.some(row => row.payload !== payload)) {
      throw new ApiError(409, 'Этот забег уже сохранён с другими данными.', 'run_mismatch')
    }
  }

  share(id: string): SharedRun | null {
    const row = this.sqlite.prepare('SELECT * FROM shared_runs WHERE id = ?').get(id) as Row | undefined
    return row ? this.shareFromRow(row) : null
  }

  publish(playerId: string, run: RunSubmission): SharedRun {
    return this.transaction(() => {
      const profile = this.profile(playerId)
      if (!profile?.nickname) throw new ApiError(400, 'Сначала укажите никнейм.', 'nickname_required')
      const existing = this.sqlite.prepare('SELECT * FROM shared_runs WHERE player_id = ? AND run_id = ?')
        .get(playerId, run.runId) as Row | undefined
      const payload = encodeRun(run)
      this.assertRunMatches(playerId, run, payload)
      if (existing) {
        if (existing.payload !== payload) throw new ApiError(409, 'Этот забег уже опубликован с другими данными.', 'run_mismatch')
        return this.shareFromRow(existing)
      }
      const id = randomBytes(16).toString('base64url')
      this.sqlite.prepare(`INSERT INTO shared_runs(id, player_id, run_id, nickname, metres, seconds, bars,
        max_speed_kmh, published_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, playerId, run.runId, profile.nickname, Math.floor(run.metres), run.seconds, run.bars,
          run.maxSpeedKmh, new Date(this.now()).toISOString(), payload)
      return this.share(id)!
    })
  }

  rotateRecovery(id: string): string {
    const code = randomBytes(20).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-')
    this.sqlite.prepare('UPDATE profiles SET recovery_hash = ? WHERE id = ?').run(digest(code.replace(/-/g, '')), id)
    return code
  }

  recover(rawCode: string): { profile: GuestProfile; sessionToken: string } {
    const normalized = rawCode.replace(/[\s-]/g, '').toUpperCase()
    if (!/^[A-F0-9]{40}$/.test(normalized)) throw new ApiError(400, 'Код восстановления не найден.', 'invalid_recovery_code')
    return this.transaction(() => {
      const row = this.sqlite.prepare('SELECT id FROM profiles WHERE recovery_hash = ?').get(digest(normalized)) as Row | undefined
      if (!row) throw new ApiError(400, 'Код восстановления не найден.', 'invalid_recovery_code')
      const id = String(row.id)
      return { profile: this.profile(id)!, sessionToken: this.session(id) }
    })
  }
}
