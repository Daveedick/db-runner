import { GainerRun } from './GainerRun'
import type { RunHistory, RunResult } from './RunHistory'
import { getLocale, number, pickupCount, runCount, subscribeLocale, t } from '../i18n'
import { localeTag } from '../i18n/locale'

const SORT_LABELS = { date: 'Date', metres: 'Distance', bars: 'Bars', seconds: 'Time', maxSpeedKmh: 'Max speed' } as const
export type SortColumn = keyof typeof SORT_LABELS
export type SortDirection = 'ascending' | 'descending'

/** Sort the visible copy; storage stays chronological. Missing legacy speeds stay last. */
export function sortRunResults(results: readonly RunResult[], column: SortColumn, direction: SortDirection): RunResult[] {
  const sign = direction === 'ascending' ? 1 : -1
  const value = (result: RunResult): number | undefined => column === 'date' ? Date.parse(result.date) : result[column]
  return [...results].sort((a, b) => {
    const left = value(a), right = value(b)
    const newestFirst = Date.parse(b.date) - Date.parse(a.date)
    if (left === undefined) return right === undefined ? newestFirst : 1
    if (right === undefined) return -1
    return (left - right) * sign || newestFirst
  })
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing run UI: ${id}`)
  return node as T
}

export class RunUI {
  readonly statisticsButton = element<HTMLButtonElement>('statistics-button')
  readonly backButton = element<HTMLButtonElement>('statistics-back')
  private readonly hud = element('run-hud')
  private readonly distance = element('run-distance')
  private readonly lives = element('run-lives')
  private readonly bars = element('run-bars')
  private readonly pickupIcon = element<HTMLImageElement>('run-pickup-icon')
  private readonly logLabel = element('statistics-mode')
  private readonly pickupHeading = element('statistics-pickups')
  private mode: 'gainer' | 'korona' | null = null
  private readonly best = element('run-best')
  private readonly speed = element('run-speed')
  private readonly boost = element('run-boost')
  private readonly menu = element('play-menu')
  private readonly statistics = element('statistics-panel')
  private readonly summary = element('statistics-summary')
  private readonly rows = element('statistics-rows')
  private readonly empty = element('statistics-empty')
  private readonly storageNote = element('statistics-storage')
  private readonly scroll = element('statistics-scroll')
  private readonly sortButtons = (Object.keys(SORT_LABELS) as SortColumn[]).map(column => ({
    column, button: element<HTMLButtonElement>(`statistics-sort-${column}`),
  }))
  private results: readonly RunResult[] = []
  private sortColumn: SortColumn = 'metres'
  private sortDirection: SortDirection = 'descending'
  private history: RunHistory | null = null

  constructor() {
    subscribeLocale(() => {
      this.mode = null
      if (this.history) this.renderStatistics()
    })
    for (const { column, button } of this.sortButtons) {
      button.addEventListener('click', () => {
        this.sortDirection = this.sortColumn === column && this.sortDirection === 'descending' ? 'ascending' : 'descending'
        this.sortColumn = column
        this.renderStatisticsRows()
      })
    }
  }

  update(run: GainerRun, best: number, mode: 'gainer' | 'korona'): void {
    const bottles = mode === 'korona'
    if (this.mode !== mode) {
      this.mode = mode
      this.hud.setAttribute('aria-label', t('runStatistics', { name: bottles ? 'Korona' : 'Gainer' }))
      this.pickupIcon.src = `/items/${bottles ? 'korona-bottle' : 'pump-chocolate'}.webp`
      this.pickupIcon.alt = t(bottles ? 'pickupBottles' : 'pickupBars')
      this.pickupIcon.classList.toggle('bottle-icon', bottles)
    }
    this.setText(this.distance, `${number(Math.floor(run.distance))} ${t('metre')}`)
    this.setText(this.bars, number(run.bars))
    this.setText(this.best, `${t('best')} ${number(best)} ${t('metre')}`)
    this.setText(this.speed, `${number(run.kilometresPerHour, 1)} ${t('kmh')}`)
    this.setText(this.boost, `${pickupCount(run.barsUntilBoost, bottles)} → +${Math.round((GainerRun.BOOST_FACTOR - 1) * 100)}%`)
    this.setText(this.lives, '♥'.repeat(run.lives) + '♡'.repeat(3 - run.lives))
    this.lives.setAttribute('aria-label', t('lives', { count: run.lives }))
  }

  showStatistics(history: RunHistory, mode: 'gainer' | 'korona'): void {
    this.history = history
    this.statisticsMode = mode
    this.menu.hidden = true
    this.statistics.hidden = false
    this.statistics.parentElement?.classList.add('has-statistics')
    this.renderStatistics()
    this.backButton.focus()
  }

  private statisticsMode: 'gainer' | 'korona' = 'gainer'
  private renderStatistics(): void {
    const history = this.history!
    const name = this.statisticsMode === 'korona' ? 'Korona' : 'Gainer'
    this.logLabel.textContent = t('runLog', { name })
    this.pickupHeading.textContent = t(this.statisticsMode === 'korona' ? 'bottles' : 'bars')
    this.empty.textContent = t('emptyRuns', { name })
    this.summary.textContent = `${t('best')} ${number(history.data.best)} ${t('metre')} · ${runCount(history.data.totalRuns)}`
    this.empty.hidden = history.data.results.length > 0
    this.results = history.data.results
    this.renderStatisticsRows()
    this.storageNote.textContent = history.persistent
      ? t('savedRuns', { name })
      : t('storageUnavailable')
    if (history.data.results.some(result => result.maxSpeedKmh === undefined)) {
      this.storageNote.textContent += ` ${t('legacySpeed')}`
    }
  }

  private renderStatisticsRows(): void {
    for (const { column, button } of this.sortButtons) {
      const active = this.sortColumn === column
      button.closest('th')?.setAttribute('aria-sort', active ? this.sortDirection : 'none')
      button.dataset.direction = active ? this.sortDirection : ''
      const label = column === 'bars' ? this.pickupHeading.textContent ?? '' : t(column === 'metres' ? 'distance' : column === 'seconds' ? 'time' : column === 'maxSpeedKmh' ? 'maxSpeed' : 'date')
      const nextDirection = active && this.sortDirection === 'descending' ? 'ascending' : 'descending'
      button.setAttribute('aria-label', t(nextDirection === 'ascending' ? 'sortAscending' : 'sortDescending', { label }))
    }
    this.rows.replaceChildren()
    for (const result of sortRunResults(this.results, this.sortColumn, this.sortDirection)) {
      const row = document.createElement('tr')
      const date = new Date(result.date)
      const dateLabel = `${date.toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' })}\n${date.toLocaleTimeString(localeTag(getLocale()), { hour: '2-digit', minute: '2-digit', hour12: false })}`
      for (const [index, value] of [dateLabel, `${number(result.metres)} ${t('metre')}`, number(result.bars), `${number(result.seconds)}${t('second')}`,
        result.maxSpeedKmh === undefined ? '—' : number(result.maxSpeedKmh, 1)].entries()) {
        const cell = document.createElement('td')
        cell.textContent = value
        if (index === 0) cell.className = 'result-date'
        if (index === 4 && result.maxSpeedKmh === undefined) cell.setAttribute('aria-label', t('noSpeed'))
        row.append(cell)
      }
      this.rows.append(row)
    }
    this.scroll.scrollTop = 0
  }

  closeStatistics(): void {
    this.statistics.hidden = true
    this.statistics.parentElement?.classList.remove('has-statistics')
    this.menu.hidden = false
    this.statisticsButton.focus()
  }

  private setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value
  }
}
