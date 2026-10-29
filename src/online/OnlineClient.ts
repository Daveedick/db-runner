import { getLocale, subscribeLocale } from '../i18n'
import { onlineErrorMessage, onlineMessage, type OnlineMessage } from './messages'
import type { GuestProfile, Leaderboard, OnlineBest, RunSubmission, ShareResponse } from './contracts'

export interface OnlineState {
  profile: GuestProfile | null
  leaderboard: Leaderboard | null
  pendingCount: number
  loading: boolean
  error: string | null
  status: string | null
  storageAvailable: boolean
}

interface PendingRun { profileId: string; run: RunSubmission }
interface SavedOnlineData { version: 1; profile: GuestProfile | null; pending: PendingRun[] }
interface ClientOptions {
  fetch?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}

const STORAGE_KEY = 'db-runner.online.v1'
const PENDING_LIMIT = 20

export class OnlineError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(onlineMessage(getLocale(), onlineErrorMessage({ status, code }).key))
  }
}

function isProfile(value: unknown): value is GuestProfile {
  if (!value || typeof value !== 'object') return false
  const row = value as GuestProfile
  return typeof row.id === 'string' && row.id.length < 100 &&
    (row.nickname === null || typeof row.nickname === 'string') && typeof row.participating === 'boolean' &&
    typeof row.hasRecoveryCode === 'boolean' && (row.best === null ||
      (Number.isFinite(row.best?.metres) && typeof row.best?.achievedAt === 'string'))
}

function isPending(value: unknown): value is PendingRun {
  if (!value || typeof value !== 'object') return false
  const row = value as PendingRun
  return typeof row.profileId === 'string' && typeof row.run?.runId === 'string' &&
    row.run.ruleset === 'gainer-v0.6' && [row.run.metres, row.run.seconds, row.run.bars, row.run.maxSpeedKmh]
      .every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0)
}

/** Online requests never own gameplay or the browser-local RunHistory. */
export class OnlineClient {
  private readonly fetcher: typeof fetch
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null = null
  private pending: PendingRun[] = []
  private latestRun: RunSubmission | null = null
  private listeners = new Set<(state: OnlineState) => void>()
  private busy = 0
  private flushPromise: Promise<void> | null = null
  private flushProfileId: string | null = null
  private creationPromise: Promise<GuestProfile> | null = null
  private profileVersion = 0
  private profileLoadSequence = 0
  private errorMessage: OnlineMessage | null = null
  private statusMessage: OnlineMessage | null = null
  private state: OnlineState = {
    profile: null, leaderboard: null, pendingCount: 0, loading: false,
    error: null, status: null, storageAvailable: true,
  }

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    try {
      this.storage = options.storage === undefined ? globalThis.localStorage ?? null : options.storage
      if (!this.storage) this.state.storageAvailable = false
      const raw = this.storage?.getItem(STORAGE_KEY)
      if (raw && raw.length < 128_000) {
        const saved = JSON.parse(raw) as SavedOnlineData
        if (saved.version === 1) {
          this.state.profile = isProfile(saved.profile) ? saved.profile : null
          this.pending = Array.isArray(saved.pending) ? saved.pending.filter(isPending).slice(-PENDING_LIMIT) : []
        }
      }
    } catch { this.state.storageAvailable = false }
    this.updatePendingCount()
    subscribeLocale(() => this.patch({}))
  }

  get snapshot(): OnlineState { return this.state }

  subscribe(listener: (state: OnlineState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<void> {
    await this.action(async () => {
      const version = this.profileVersion
      const sequence = ++this.profileLoadSequence
      const result = await this.request<{ profile: GuestProfile | null }>('/api/profile')
      // A slow GET must not undo a newer recovery, nickname or participation change.
      if (sequence !== this.profileLoadSequence || version !== this.profileVersion) return
      this.setProfile(result.profile, false)
      await this.retryPending().catch(() => {})
    })
  }

  async saveNickname(nickname: string): Promise<void> {
    await this.action(async () => {
      const profile = await this.ensureProfile(nickname)
      if (profile.nickname !== nickname) {
        const result = await this.request<{ profile: GuestProfile }>('/api/profile', 'PATCH', { nickname }, true)
        this.setProfile(result.profile)
      }
      this.patch({ status: { key: 'nicknameSaved' } })
    })
  }

  async setParticipation(participating: boolean): Promise<void> {
    await this.action(async () => {
      if (!this.state.profile?.nickname) throw new OnlineError(400, 'nickname_required')
      const result = await this.request<{ profile: GuestProfile }>('/api/profile', 'PATCH', { participating }, true)
      this.setProfile(result.profile)
      if (participating) {
        if (this.latestRun) this.enqueue(this.latestRun)
        await this.retryPending().catch(() => {})
      } else {
        this.pending = this.pending.filter(item => item.profileId !== result.profile.id)
        this.persist()
      }
      this.patch({ status: { key: participating ? 'participationEnabled' : 'participationHidden' } })
      await this.refreshLeaderboardIfOpen()
    })
  }

  /** Called only with runs completed during this page session, never imported history. */
  rememberCompletedRun(run: RunSubmission | null): void {
    this.latestRun = run
    if (run && this.state.profile?.participating) {
      this.enqueue(run)
      void this.retryPending().catch(() => { /* Persisted queue is retried on reconnect or manually. */ })
    }
  }

  async loadLeaderboard(): Promise<void> {
    await this.action(async () => {
      const leaderboard = await this.request<Leaderboard>('/api/leaderboard')
      this.patch({ leaderboard })
    })
  }

  async createShare(run: RunSubmission): Promise<ShareResponse> {
    return this.action(async () => {
      if (!this.state.profile?.nickname) throw new OnlineError(400, 'nickname_required')
      return this.request<ShareResponse>('/api/shares', 'POST', { run }, true)
    })
  }

  async generateRecoveryCode(): Promise<string> {
    return this.action(async () => {
      await this.ensureProfile()
      const result = await this.request<{ code: string }>('/api/profile/recovery-code', 'POST', {}, true)
      if (this.state.profile) this.setProfile({ ...this.state.profile, hasRecoveryCode: true })
      return result.code
    })
  }

  async recover(code: string): Promise<void> {
    await this.action(async () => {
      const result = await this.request<{ profile: GuestProfile }>('/api/profile/recover', 'POST', { code })
      this.latestRun = null
      this.setProfile(result.profile)
      this.patch({ leaderboard: null, status: { key: 'recoveredDeviceHistory' } })
      void this.retryPending().catch(() => {})
    })
  }

  retryPending(): Promise<void> {
    if (this.flushPromise) {
      if (this.flushProfileId === this.state.profile?.id) return this.flushPromise
      return this.flushPromise.catch(() => {}).then(() => this.retryPending())
    }
    this.flushProfileId = this.state.profile?.id ?? null
    const promise = this.flushPending()
    this.flushPromise = promise
    void promise.finally(() => { if (this.flushPromise === promise) this.flushPromise = null }).catch(() => {})
    return promise
  }

  private async flushPending(): Promise<void> {
    const profile = this.state.profile
    if (!profile?.participating) return
    while (this.state.profile?.id === profile.id && this.state.profile.participating) {
      const item = this.pending.find(row => row.profileId === profile.id)
      if (!item) break
      try {
        const { best } = await this.request<{ best: OnlineBest | null }>('/api/runs', 'POST', item.run, true)
        this.pending = this.pending.filter(row => row.profileId !== item.profileId || row.run.runId !== item.run.runId)
        if (this.state.profile?.id === profile.id) {
          this.setProfile({ ...this.state.profile, best }, false)
          this.patch({ error: null, status: { key: 'resultSent' } })
        } else this.persist()
      } catch (error) {
        if (this.state.profile?.id !== profile.id) throw error
        if (error instanceof OnlineError && error.status === 400) {
          this.pending = this.pending.filter(row => row !== item)
          this.persist()
          this.patch({ error: { key: 'resultRejected' } })
          continue
        }
        this.patch({ error: error instanceof OnlineError && error.code === 'PROFILE_CHANGED'
          ? { key: 'profileChanged' }
          : { key: 'resultQueued' } })
        throw error
      }
    }
  }

  private enqueue(run: RunSubmission): void {
    const profileId = this.state.profile?.id
    if (!profileId) return
    // Only a personal best is uploaded. Preserve the strongest offline candidate,
    // even when many shorter runs follow it before connectivity returns.
    const previous = this.pending.find(item => item.profileId === profileId)
    if (previous && previous.run.metres >= run.metres) return
    this.pending = this.pending.filter(item => item.profileId !== profileId)
    this.pending.push({ profileId, run: { ...run } })
    this.pending = this.pending.slice(-PENDING_LIMIT)
    this.persist()
  }

  private async ensureProfile(nickname?: string): Promise<GuestProfile> {
    if (this.state.profile) return this.state.profile
    if (!this.creationPromise) {
      this.creationPromise = this.request<{ profile: GuestProfile }>('/api/profile', 'POST', { nickname })
        .then(result => {
          if (this.state.profile && this.state.profile.id !== result.profile.id) {
            throw new OnlineError(409, 'PROFILE_CHANGED')
          }
          this.setProfile(result.profile)
          return result.profile
        })
        .finally(() => { this.creationPromise = null })
    }
    return this.creationPromise
  }

  private async refreshLeaderboardIfOpen(): Promise<void> {
    if (!this.state.leaderboard) return
    try { this.patch({ leaderboard: await this.request<Leaderboard>('/api/leaderboard') }) }
    catch { this.patch({ leaderboard: null }) }
  }

  private async request<T>(url: string, method = 'GET', body?: unknown, authenticated = false): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    const expectedProfileId = this.state.profile?.id
    try {
      const response = await this.fetcher(url, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: method === 'GET' ? {} : {
          'Content-Type': 'application/json',
          ...(authenticated ? { 'X-Profile-Id': expectedProfileId ?? '' } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const value = await response.json() as T & { error?: string; code?: string }
      if (!response.ok) throw new OnlineError(response.status, value.code)
      if (authenticated && this.state.profile?.id !== expectedProfileId) {
        throw new OnlineError(409, 'PROFILE_CHANGED')
      }
      return value
    } catch (error) {
      if (error instanceof OnlineError) throw error
      throw new OnlineError(0)
    } finally { clearTimeout(timer) }
  }

  private async action<T>(operation: () => Promise<T>): Promise<T> {
    this.busy += 1
    this.patch({ loading: true, error: null, status: null })
    try { return await operation() }
    catch (error) {
      // Preserve the more useful queued-result explanation from flushPending.
      if (!this.state.error) this.patch({ error: onlineErrorMessage(error) })
      throw error
    } finally {
      this.busy -= 1
      this.patch({ loading: this.busy > 0 })
    }
  }

  private setProfile(profile: GuestProfile | null, invalidateReads = true): void {
    const changedId = this.state.profile?.id !== profile?.id
    const identityChanged = this.state.profile !== null && this.state.profile.id !== profile?.id
    if (identityChanged) this.latestRun = null
    if (invalidateReads || changedId) this.profileVersion += 1
    this.state = { ...this.state, profile, ...(identityChanged ? { leaderboard: null } : {}) }
    this.persist()
  }

  private persist(): void {
    this.updatePendingCount()
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, profile: this.state.profile, pending: this.pending }))
    } catch { this.state = { ...this.state, storageAvailable: false } }
    this.emit()
  }

  private updatePendingCount(): void {
    this.state = { ...this.state, pendingCount: this.pending.filter(item => item.profileId === this.state.profile?.id).length }
  }

  private patch(update: Omit<Partial<OnlineState>, 'error' | 'status'> & { error?: OnlineMessage | null; status?: OnlineMessage | null }): void {
    const { error, status, ...values } = update
    if ('error' in update) this.errorMessage = error ?? null
    if ('status' in update) this.statusMessage = status ?? null
    const locale = getLocale()
    this.state = {
      ...this.state, ...values,
      error: this.errorMessage ? onlineMessage(locale, this.errorMessage.key, this.errorMessage.values) : null,
      status: this.statusMessage ? onlineMessage(locale, this.statusMessage.key, this.statusMessage.values) : null,
    }
    this.emit()
  }

  private emit(): void { this.listeners.forEach(listener => listener(this.state)) }
}
