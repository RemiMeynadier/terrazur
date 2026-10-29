import { t, type TKey } from '../i18n'
import { clock } from './format'
import type { Outlook, State } from './status'

export const STATE_LABEL: Record<State, TKey> = {
  sun: 'sSun',
  partial: 'sPartial',
  trees: 'sTrees',
  shade: 'sShade',
  cloud: 'sCloud',
  night: 'sNight',
}

export function sunText(o: Outlook, sunset: number | null): string {
  if (o.now.state === 'sun' || o.now.state === 'partial') {
    if (o.until == null) return t('untilSunset')
    return t('until', { time: clock(o.until) })
  }
  if (o.from != null) return t('from', { time: clock(o.from) })
  return sunset != null ? t('noMore') : ''
}
