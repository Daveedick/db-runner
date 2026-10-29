import './online.css'
import { getLocale, subscribeLocale } from '../i18n'
import { onlineErrorMessage, onlineMessage, onlineMetres, onlineNumber, type OnlineMessage } from './messages'
import type { OnlineClient, OnlineState } from './OnlineClient'
import type { LeaderboardEntry, RunSubmission, ShareResponse } from './contracts'

type OnlineView = 'leaderboard' | 'profile'
type MenuHooks = { openMenu: () => void; closeMenu: () => void }

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing online UI: ${id}`)
  return node as T
}

/** Online menus never own gameplay state; Game pauses and gates input through the hooks. */
export class OnlineUI {
  private readonly panel = element('online-panel')
  private readonly nickname = element<HTMLInputElement>('online-nickname')
  private readonly recoverInput = element<HTMLInputElement>('online-recover-input')
  private state: OnlineState
  private view: OnlineView = 'leaderboard'
  private opened = false
  private busy = false
  private currentRun: RunSubmission | null = null
  private sharedRun: ShareResponse | null = null
  private shareIntent = false
  private joinIntent = false
  private recoveryCode = ''
  private message: OnlineMessage | null = null
  private nicknameInvalid = false
  private recoveryInvalid = false
  private messageIsError = false
  private previousFocus: HTMLElement | null = null
  private renderedProfileId: string | null = null
  private renderedNickname: string | null = null
  private profileEpoch = 0

  constructor(private readonly client: OnlineClient, private readonly hooks: MenuHooks) {
    this.state = client.snapshot
    client.subscribe(state => { this.state = state; this.render() })
    this.click('online-button', () => this.open())
    this.click('online-back', () => this.close())
    this.click('online-leaderboard-tab', () => this.switchView('leaderboard'))
    this.click('online-profile-tab', () => this.switchView('profile'))
    this.click('online-join-button', () => this.beginJoin())
    this.click('online-ranking-join', () => this.beginJoin())
    this.click('online-share-button', () => this.beginShare())
    this.click('online-ranking-refresh', () => this.perform(() => client.loadLeaderboard()))
    this.click('online-retry', () => this.perform(() => client.retryPending()))
    this.click('online-participation-toggle', () => {
      if (this.state.profile?.participating) {
        void this.perform(() => client.setParticipation(false), { key: 'participationDisabled' })
      } else this.beginJoin()
    })
    element<HTMLFormElement>('online-nickname-form').addEventListener('submit', event => {
      event.preventDefault()
      void this.saveNickname()
    })
    this.nickname.addEventListener('invalid', () => {
      this.nicknameInvalid = true
      this.nickname.setCustomValidity(this.t('nicknameInvalid'))
    })
    this.nickname.addEventListener('input', () => { this.nicknameInvalid = false; this.nickname.setCustomValidity('') })
    this.click('online-share-native', () => this.shareNative())
    this.click('online-share-retry', () => this.publishShare())
    this.click('online-share-copy', () => this.copyValue(element<HTMLInputElement>('online-share-link'), { key: 'linkCopied' }))
    this.click('online-recovery-generate', () => {
      if (this.state.profile?.hasRecoveryCode) element('online-recovery-replace').hidden = false
      else void this.generateRecovery()
    })
    this.click('online-recovery-replace-confirm', () => this.generateRecovery())
    this.click('online-recovery-replace-cancel', () => { element('online-recovery-replace').hidden = true })
    this.click('online-recovery-copy', () => this.copyValue(element<HTMLInputElement>('online-recovery-code'), { key: 'codeCopied' }))
    element<HTMLFormElement>('online-recover-form').addEventListener('submit', event => {
      event.preventDefault()
      if (!this.recoverInput.value.trim() || this.busy) return
      if (this.state.profile) element('online-recover-confirmation').hidden = false
      else void this.recoverProfile()
    })
    this.recoverInput.addEventListener('invalid', () => {
      this.recoveryInvalid = true
      this.recoverInput.setCustomValidity(this.t('recoveryRequired'))
    })
    this.recoverInput.addEventListener('input', () => {
      this.recoveryInvalid = false
      this.recoverInput.setCustomValidity('')
      element('online-recover-confirmation').hidden = true
    })
    this.click('online-recover-confirm', () => this.recoverProfile())
    this.click('online-recover-cancel', () => { element('online-recover-confirmation').hidden = true })
    this.panel.addEventListener('keydown', event => this.handleKeyDown(event))
    subscribeLocale(() => this.render())
    this.render()
  }

  open(view: OnlineView = 'leaderboard'): void {
    if (!this.opened) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      this.opened = true
      this.hooks.openMenu()
      element('play-menu').hidden = true
      element('statistics-panel').hidden = true
      element('game-overlay').classList.add('has-online')
      this.panel.hidden = false
    }
    this.switchView(view)
    element('online-back').focus()
    void this.perform(async () => {
      await this.client.load()
      await this.client.loadLeaderboard()
    }).then(() => {
      if (this.shareIntent && this.state.profile?.nickname && !this.sharedRun) void this.publishShare()
    })
  }

  close(): void {
    if (!this.opened) return
    this.opened = false
    this.panel.hidden = true
    element('game-overlay').classList.remove('has-online')
    element('play-menu').hidden = false
    this.joinIntent = false
    this.shareIntent = false
    this.recoveryCode = ''
    this.recoverInput.value = ''
    this.clearValidation()
    element('online-recovery-replace').hidden = true
    element('online-recover-confirmation').hidden = true
    this.hooks.closeMenu()
    this.render()
    if (this.previousFocus && !this.previousFocus.closest('[hidden]')) this.previousFocus.focus()
    else element('online-button').focus()
  }

  setCompletedRun(run: RunSubmission | null): void {
    if (run?.runId !== this.currentRun?.runId) {
      this.sharedRun = null
      this.shareIntent = false
    }
    this.currentRun = run
    this.render()
  }

  private click(id: string, action: () => void | Promise<unknown>): void {
    element<HTMLButtonElement>(id).addEventListener('click', () => { void action() })
  }

  private switchView(view: OnlineView): void {
    this.view = view
    this.render()
  }

  private beginJoin(): void {
    this.shareIntent = false
    this.joinIntent = true
    this.message = null
    if (!this.opened) this.open('profile')
    else this.switchView('profile')
    this.render()
    this.nickname.focus()
  }

  private beginShare(): void {
    if (!this.currentRun) return
    this.joinIntent = false
    this.shareIntent = true
    this.message = null
    if (!this.opened) this.open('profile')
    else this.switchView('profile')
    this.render()
    if (!this.state.profile?.nickname) this.nickname.focus()
    else void this.publishShare()
  }

  private async saveNickname(): Promise<void> {
    const value = this.nickname.value.normalize('NFC').trim().replace(/\s+/gu, ' ')
    if (!/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N} _-]{2,24}$/u.test(value)) {
      this.nicknameInvalid = true
      this.nickname.setCustomValidity(this.t('nicknameInvalid'))
      this.nickname.reportValidity()
      return
    }
    await this.perform(async () => {
      await this.client.saveNickname(value)
      if (this.joinIntent) {
        await this.client.setParticipation(true)
        this.joinIntent = false
        this.message = { key: 'participationEnabled' }
      } else this.message = { key: 'nicknameSaved' }
    })
    if (this.shareIntent && this.state.profile?.nickname && !this.messageIsError) await this.publishShare()
  }

  private async publishShare(): Promise<void> {
    const run = this.currentRun
    const profileId = this.state.profile?.id ?? null
    const epoch = this.profileEpoch
    if (!run || !this.shareIntent) return
    if (this.sharedRun) { this.render(); return }
    await this.perform(async () => {
      const result = await this.client.createShare(run)
      // Neither a next run nor another tab's profile switch can receive this response.
      if (this.currentRun?.runId === run.runId && profileId === (this.state.profile?.id ?? null) && epoch === this.profileEpoch) {
        this.sharedRun = { ...result, url: new URL(result.url, window.location.origin).href }
        this.message = { key: 'linkReady' }
      }
    })
  }

  private async shareNative(): Promise<void> {
    if (!this.sharedRun || typeof navigator.share !== 'function') return
    try {
      // This call stays directly in the click gesture; publication has already finished.
      await navigator.share({
        title: 'D&B Runner',
        text: this.t('nativeShare', { nickname: this.sharedRun.share.nickname, distance: this.metres(this.sharedRun.share.metres) }),
        url: this.sharedUrl(),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      this.message = { key: 'nativeUnavailable' }
      this.messageIsError = true
      this.render()
    }
  }

  private async copyValue(input: HTMLInputElement, success: OnlineMessage): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(input.value)
      this.message = success
      this.messageIsError = false
    } catch {
      this.message = { key: 'copyFailed' }
      this.messageIsError = true
      input.focus()
      input.select()
    }
    this.render()
  }

  private async generateRecovery(): Promise<void> {
    const profileId = this.state.profile?.id ?? null
    const epoch = this.profileEpoch
    await this.perform(async () => {
      const code = await this.client.generateRecoveryCode()
      // Creating the first guest is allowed; replacing an existing identity is not.
      if (epoch !== this.profileEpoch || (profileId !== null && profileId !== this.state.profile?.id)) return
      this.recoveryCode = this.opened ? code : ''
      element('online-recovery-replace').hidden = true
      this.message = { key: 'codeCreated' }
    })
  }

  private async recoverProfile(): Promise<void> {
    const code = this.recoverInput.value.trim()
    if (!code) return
    await this.perform(async () => {
      await this.client.recover(code)
      this.recoveryCode = ''
      this.recoverInput.value = ''
      this.sharedRun = null
      this.shareIntent = false
      this.joinIntent = false
      this.setCompletedRun(null)
      element('online-recover-confirmation').hidden = true
      this.message = { key: 'profileRecovered' }
    })
  }

  private async perform(action: () => Promise<unknown>, success?: OnlineMessage): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.message = null
    this.messageIsError = false
    this.render()
    try {
      await action()
      if (success) this.message = success
    } catch (error) {
      this.message = onlineErrorMessage(error)
      this.messageIsError = true
    } finally {
      this.busy = false
      this.render()
    }
  }

  private render(): void {
    const profile = this.state.profile
    const profileId = profile?.id ?? null
    if (this.renderedProfileId !== null && this.renderedProfileId !== profileId) {
      this.profileEpoch++
      this.currentRun = null
      this.sharedRun = null
      this.recoveryCode = ''
      this.shareIntent = false
      this.joinIntent = false
      this.recoverInput.value = ''
      this.clearValidation()
      element('online-recovery-replace').hidden = true
      element('online-recover-confirmation').hidden = true
      this.message = null
      this.messageIsError = false
    }
    element('online-title').textContent = this.t(this.view === 'leaderboard' ? 'leaderboard' : 'profile')
    element('online-leaderboard-view').hidden = this.view !== 'leaderboard'
    element('online-profile-view').hidden = this.view !== 'profile'
    element('online-leaderboard-tab').setAttribute('aria-pressed', String(this.view === 'leaderboard'))
    element('online-profile-tab').setAttribute('aria-pressed', String(this.view === 'profile'))
    const status = element('online-status')
    status.textContent = (this.message ? this.t(this.message.key, this.message.values) : '') || this.state.error || (this.busy || this.state.loading ? this.t('loading') : this.state.status || '')
    status.dataset.error = String(this.messageIsError || (!this.message && Boolean(this.state.error)))
    this.panel.setAttribute('aria-busy', String(this.busy || this.state.loading))
    element('online-storage-note').hidden = this.state.storageAvailable
    element('online-pending').hidden = this.state.pendingCount === 0
    element('online-pending-label').textContent = this.t('pending', { count: this.number(this.state.pendingCount) })
    element('online-run-actions').hidden = !this.currentRun
    element('online-join-button').hidden = profile?.participating === true
    element('online-profile-best').textContent = profile?.best ? this.t('onlineBest', { distance: this.metres(profile.best.metres) }) : this.t('noOnlineBest')
    if (this.renderedProfileId !== (profile?.id ?? null) || this.renderedNickname !== (profile?.nickname ?? null)) {
      // Initial guest creation must not erase a nickname already being typed.
      if (document.activeElement !== this.nickname || this.renderedNickname !== (profile?.nickname ?? null) || this.renderedProfileId !== null) {
        this.nickname.value = profile?.nickname ?? ''
      }
      this.renderedProfileId = profile?.id ?? null
      this.renderedNickname = profile?.nickname ?? null
    }
    element('online-nickname-save').textContent = this.t(this.joinIntent ? 'saveJoin' : this.shareIntent && !this.sharedRun ? 'saveShare' : 'saveNickname')
    element('online-nickname-intent').hidden = !this.joinIntent && !this.shareIntent
    element('online-nickname-intent').textContent = this.joinIntent
      ? this.t('joinIntent')
      : this.t('shareIntent')
    element('online-participation-label').textContent = this.t(profile?.participating ? 'participating' : 'notParticipating')
    element('online-participation-toggle').textContent = this.t(profile?.participating ? 'leave' : 'join')
    element('online-recovery-generate').textContent = this.t(profile?.hasRecoveryCode ? 'replaceCode' : 'createCode')
    element('online-recovery-result').hidden = !this.recoveryCode
    const codeInput = element<HTMLInputElement>('online-recovery-code')
    if (codeInput.value !== this.recoveryCode) codeInput.value = this.recoveryCode
    if (this.nicknameInvalid) this.nickname.setCustomValidity(this.t('nicknameInvalid'))
    if (this.recoveryInvalid) this.recoverInput.setCustomValidity(this.t('recoveryRequired'))
    const disabledIds = ['online-nickname-save', 'online-ranking-refresh', 'online-retry', 'online-ranking-join', 'online-participation-toggle', 'online-recovery-generate', 'online-recovery-replace-confirm', 'online-recover-submit', 'online-recover-confirm', 'online-share-retry']
    for (const id of disabledIds) element<HTMLButtonElement>(id).disabled = this.busy
    element('online-share-section').hidden = !this.shareIntent
    element('online-share-summary').textContent = this.currentRun ? this.t('thisRun', { distance: this.metres(this.currentRun.metres) }) : ''
    element('online-share-help').textContent = this.sharedRun ? '' : this.t(!profile?.nickname ? 'shareNeedsNickname' : this.busy ? 'shareSaving' : 'shareHelp')
    element('online-share-retry').hidden = !this.shareIntent || !profile?.nickname || Boolean(this.sharedRun) || this.busy
    element('online-share-ready').hidden = !this.sharedRun
    const linkInput = element<HTMLInputElement>('online-share-link')
    const shareUrl = this.sharedUrl()
    if (linkInput.value !== shareUrl) linkInput.value = shareUrl
    element('online-share-native').hidden = typeof navigator.share !== 'function'
    this.renderRanking()
  }

  private renderRanking(): void {
    const board = this.state.leaderboard
    element('online-ranking-invite').hidden = this.state.profile?.participating === true
    element('online-ranking-summary').textContent = board ? this.t('boardSummary', { count: this.number(board.total) }) : this.t('boardIntro')
    element('online-ranking-empty').hidden = Boolean(board?.entries.length)
    element('online-ranking-empty').textContent = this.t(board ? 'boardEmpty' : 'boardNotLoaded')
    element('online-ranking-table').hidden = !board?.entries.length
    const rows = element('online-ranking-rows')
    rows.replaceChildren()
    for (const entry of board?.entries ?? []) {
      const row = document.createElement('tr')
      if (entry.playerId === this.state.profile?.id) row.className = 'is-me'
      for (const value of [this.number(entry.rank), entry.nickname, this.metres(entry.metres)]) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      }
      rows.append(row)
    }
    const own = element('online-own-rank')
    const me = board?.me
    own.hidden = !me
    own.textContent = me ? this.ownRankLabel(me) : ''
  }

  private ownRankLabel(entry: LeaderboardEntry): string {
    return this.t('ownRank', { rank: this.number(entry.rank), nickname: entry.nickname, distance: this.metres(entry.metres) })
  }

  private clearValidation(): void {
    this.nicknameInvalid = false
    this.recoveryInvalid = false
    this.nickname.setCustomValidity('')
    this.recoverInput.setCustomValidity('')
  }

  private t(key: OnlineMessage['key'], values?: OnlineMessage['values']): string {
    return onlineMessage(getLocale(), key, values)
  }

  private metres(value: number): string { return onlineMetres(getLocale(), value) }
  private number(value: number): string { return onlineNumber(getLocale(), value) }

  private sharedUrl(): string {
    if (!this.sharedRun) return ''
    const url = new URL(this.sharedRun.url, window.location.origin)
    if (getLocale() === 'ru') url.searchParams.set('lang', 'ru')
    else url.searchParams.delete('lang')
    return url.href
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.opened) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
    } else if (event.key === 'Tab') {
      const controls = [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')]
        .filter(control => !control.closest('[hidden]'))
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }
}
