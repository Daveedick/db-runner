import { formatMessage, localeTag, type Locale } from '../i18n/locale'

const en = {
  leaderboard: 'Leaderboard',
  profile: 'Profile',
  loading: 'Loading…',
  participationDisabled: 'Participation is off. Your online best is saved.',
  linkCopied: 'Link copied.',
  codeCopied: 'Code copied. Save it somewhere safe.',
  nicknameInvalid: 'Enter 2–24 characters: Latin or Cyrillic letters, numbers, spaces, hyphens and _.',
  participationEnabled: 'You are on the leaderboard. New personal bests update automatically.',
  nicknameSaved: 'Nickname saved.',
  linkReady: 'Your link is ready to share.',
  nativeShare: '{nickname} ran {distance} in D&B Runner. Can you beat that?',
  nativeUnavailable: 'Sharing is unavailable. Copy the link below.',
  copyFailed: 'Could not copy automatically. The text is selected; copy it manually.',
  codeCreated: 'Code created. Save it before closing this menu.',
  profileRecovered: 'Profile restored. Your personal history on this device is unchanged.',
  pending: 'Waiting to send: {count}. Results are saved on this device.',
  onlineBest: 'Online best: {distance}',
  noOnlineBest: 'No online best yet',
  saveJoin: 'Save nickname and join',
  saveShare: 'Save nickname and create link',
  saveNickname: 'Save nickname',
  joinIntent: 'Your nickname and best result will be public. New personal bests update automatically.',
  shareIntent: 'Only this run will be published. Your leaderboard participation will stay as it is.',
  participating: 'You are on the leaderboard.',
  notParticipating: 'Participation is off.',
  leave: 'Leave leaderboard',
  join: 'Join leaderboard',
  replaceCode: 'Create a new code',
  createCode: 'Create recovery code',
  thisRun: 'This run: {distance}',
  shareNeedsNickname: 'Enter a nickname below to create a public link.',
  shareSaving: 'Saving your run…',
  shareHelp: 'Create a link to share this result.',
  boardSummary: 'Top 50 · players: {count}. Equal distances are ranked by the earliest record.',
  boardIntro: 'Players’ best results will appear here.',
  boardEmpty: 'No results yet. The first record could be yours.',
  boardNotLoaded: 'The leaderboard has not loaded yet.',
  ownRank: 'Your rank: {rank} · {nickname} · {distance}',
  metreUnit: 'm',
  nicknameRequired: 'Save a nickname first.',
  recoveryRequired: 'Enter your recovery code.',
  participationRequired: 'Join the leaderboard before sending a result.',
  participationHidden: 'Your leaderboard entry is hidden. Your best is saved.',
  recoveredDeviceHistory: 'Profile restored. Run history stays on each device.',
  resultSent: 'Result sent to the leaderboard.',
  resultRejected: 'The server rejected this result. Your personal statistics are saved.',
  profileChanged: 'Your profile changed in another tab. Refresh it before trying again.',
  resultQueued: 'Your result is saved on this device. You can try sending it again later.',
  networkError: 'Could not reach the leaderboard. Try again later.',
  requestFailed: 'Could not complete this request. Try again.',
  unauthorized: 'Your profile session is unavailable. Open your profile or restore it with your code.',
  invalidRecovery: 'Recovery code not found. Check the code and try again.',
  runMismatch: 'This run was already saved with different data.',
  rulesetMismatch: 'This game version is no longer accepted. Reload the game.',
  invalidRun: 'This result could not be accepted. Your personal statistics are saved.',
  rateLimited: 'Too many requests. Wait a moment and try again.',
  originRequired: 'Open the game on its usual website and try again.',
  notFound: 'This item could not be found.',
  serviceUnavailable: 'The service is temporarily unavailable. Try again later.',
} as const

type OnlineMessageKey = keyof typeof en
const ru: Record<OnlineMessageKey, string> = {
  leaderboard: 'Общий рейтинг',
  profile: 'Профиль',
  loading: 'Загрузка…',
  participationDisabled: 'Участие отключено. Онлайн-рекорд сохранён.',
  linkCopied: 'Ссылка скопирована.',
  codeCopied: 'Код скопирован. Сохраните его в надёжном месте.',
  nicknameInvalid: 'Введите 2–24 символа: латинские или русские буквы, цифры, пробел, дефис и _.',
  participationEnabled: 'Вы участвуете в рейтинге. Новые рекорды обновляются автоматически.',
  nicknameSaved: 'Ник сохранён.',
  linkReady: 'Ссылка готова. Теперь её можно отправить.',
  nativeShare: '{nickname} пробежал(а) {distance} в D&B Runner. Сможешь больше?',
  nativeUnavailable: 'Меню отправки недоступно. Скопируйте ссылку ниже.',
  copyFailed: 'Не удалось скопировать автоматически. Текст выделен — скопируйте его вручную.',
  codeCreated: 'Код создан. Сохраните его перед закрытием меню.',
  profileRecovered: 'Профиль восстановлен. Личная история на устройстве сохранена.',
  pending: 'Ожидают отправки: {count}. Результаты сохранены на этом устройстве.',
  onlineBest: 'Онлайн-рекорд: {distance}',
  noOnlineBest: 'Онлайн-рекорда пока нет',
  saveJoin: 'Сохранить ник и участвовать',
  saveShare: 'Сохранить ник и создать ссылку',
  saveNickname: 'Сохранить ник',
  joinIntent: 'Твой ник и лучший результат будут видны всем. Новые рекорды обновляются автоматически.',
  shareIntent: 'Будет опубликован только выбранный забег. Участие в рейтинге не изменится.',
  participating: 'Вы участвуете в рейтинге.',
  notParticipating: 'Участие пока отключено.',
  leave: 'Отключить участие',
  join: 'Участвовать в рейтинге',
  replaceCode: 'Выпустить новый код',
  createCode: 'Создать код восстановления',
  thisRun: 'Этот забег: {distance}',
  shareNeedsNickname: 'Укажите ник ниже, чтобы создать публичную ссылку.',
  shareSaving: 'Сохраняем карточку забега…',
  shareHelp: 'Создайте ссылку, чтобы отправить именно этот результат.',
  boardSummary: 'Топ-50 · игроков: {count}. При равной дистанции выше более ранний рекорд.',
  boardIntro: 'Здесь появятся лучшие результаты игроков.',
  boardEmpty: 'Пока нет результатов. Первый рекорд может быть вашим.',
  boardNotLoaded: 'Рейтинг пока не загружен.',
  ownRank: 'Ваше место: {rank} · {nickname} · {distance}',
  metreUnit: 'м',
  nicknameRequired: 'Сначала сохраните никнейм.',
  recoveryRequired: 'Введите код восстановления.',
  participationRequired: 'Включите участие в рейтинге перед отправкой результата.',
  participationHidden: 'Твоя строка скрыта из рейтинга. Рекорд сохранён.',
  recoveredDeviceHistory: 'Профиль восстановлен. История забегов остаётся на каждом устройстве.',
  resultSent: 'Результат отправлен в рейтинг.',
  resultRejected: 'Сервер отклонил результат. Личная статистика сохранена.',
  profileChanged: 'Профиль изменился в другой вкладке. Обновите его перед повторной попыткой.',
  resultQueued: 'Результат сохранён на устройстве. Можно повторить отправку позже.',
  networkError: 'Нет связи с рейтингом. Попробуйте ещё раз позже.',
  requestFailed: 'Не удалось выполнить запрос. Попробуйте ещё раз.',
  unauthorized: 'Сессия профиля недоступна. Откройте профиль или восстановите его с помощью кода.',
  invalidRecovery: 'Код восстановления не найден. Проверьте код и попробуйте ещё раз.',
  runMismatch: 'Этот забег уже сохранён с другими данными.',
  rulesetMismatch: 'Эта версия игры больше не принимается. Перезагрузите игру.',
  invalidRun: 'Этот результат не принят. Личная статистика сохранена.',
  rateLimited: 'Слишком много запросов. Подождите немного и попробуйте ещё раз.',
  originRequired: 'Откройте игру на её обычном сайте и попробуйте ещё раз.',
  notFound: 'Не удалось найти эту запись.',
  serviceUnavailable: 'Сервис временно недоступен. Попробуйте ещё раз позже.',
}

export interface OnlineMessage {
  key: OnlineMessageKey
  values?: Record<string, string | number>
}

export function onlineMessage(locale: Locale, key: OnlineMessageKey, values: Record<string, string | number> = {}): string {
  return formatMessage((locale === 'ru' ? ru : en)[key], values)
}

export function onlineNumber(locale: Locale, value: number): string {
  return Math.floor(value).toLocaleString(localeTag(locale))
}

export function onlineMetres(locale: Locale, value: number): string {
  return `${onlineNumber(locale, value)} ${onlineMessage(locale, 'metreUnit')}`
}

/** Never expose an API-provided message: the API and the current UI can use different languages. */
export function onlineErrorMessage(error: unknown): OnlineMessage {
  const data = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {}
  const codes: Record<string, OnlineMessageKey> = {
    PROFILE_CHANGED: 'profileChanged', unauthorized: 'unauthorized', nickname_required: 'nicknameRequired',
    invalid_nickname: 'nicknameInvalid', invalid_recovery_code: 'invalidRecovery', participation_required: 'participationRequired',
    run_mismatch: 'runMismatch', ruleset_mismatch: 'rulesetMismatch', invalid_run: 'invalidRun', implausible_run: 'invalidRun',
    rate_limited: 'rateLimited', origin_required: 'originRequired', not_found: 'notFound', internal_error: 'serviceUnavailable',
  }
  if (typeof data.code === 'string' && Object.hasOwn(codes, data.code)) return { key: codes[data.code] }
  if (data.status === 0) return { key: 'networkError' }
  if (data.status === 401) return { key: 'unauthorized' }
  if (data.status === 429) return { key: 'rateLimited' }
  if (typeof data.status === 'number' && data.status >= 500) return { key: 'serviceUnavailable' }
  return { key: 'requestFailed' }
}
