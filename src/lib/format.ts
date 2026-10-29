import { getLang, locale } from '../i18n'

export const TZ = 'Europe/Paris'

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale()}|${JSON.stringify(opts)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), { timeZone: TZ, ...opts })
    cache.set(key, f)
  }
  return f
}

// "14:35", Paris time.
export const clock = (unix: number) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000))

// "Saturday", capitalised.
export const weekday = (unix: number) => {
  const s = fmt({ weekday: 'long' }).format(new Date(unix * 1000))
  return s[0].toUpperCase() + s.slice(1)
}

export const dayName = (unix: number) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(unix * 1000))

// "1 h 20" / "45 min".
export function duration(minutes: number): string {
  const m = Math.round(minutes / 5) * 5
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return getLang() === 'fr' ? `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${h} h${r ? ` ${r} min` : ''}`
}

// Seconds since Paris midnight, by the Paris wall clock.
function wallSeconds(unix: number): number {
  const parts = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(unix * 1000))
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return get('hour') * 3600 + get('minute') * 60 + get('second')
}

// Paris midnight of the day containing `unix`, plus `days`.
export function parisMidnight(unix: number, days = 0): number {
  let m = Math.floor(unix) - wallSeconds(unix)
  // On DST days the offset at midnight differs from the one at `unix` by an hour.
  const w = wallSeconds(m)
  if (w !== 0) m += w < 43200 ? -w : 86400 - w
  if (!days) return m
  // Days are 23–25 h around DST changes: step by 24 h and re-anchor.
  return parisMidnight(m + days * 86400 + 4 * 3600)
}

const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'au', 'aux', 'en', 'sur', 'sous', 'par'])

// The City's file is in capitals: "LA VOIE LACTEE" → "La Voie Lactee".
export function prettyName(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
}
