import { exposure, type HorizonMeta, type Terrace } from './horizon'
import { type SkyNowcast, skyAt } from './sky'
import { sunPosition } from './sun'

export type State = 'sun' | 'partial' | 'trees' | 'shade' | 'cloud' | 'night'

export interface Status {
  state: State
  share: number // share of the terrace the sun's geometry reaches, 0–1
  clear: number // chance the sun is out, 0–1
}

export const STEP = 300 // seconds

export function statusAt(t: number, terrace: Terrace, meta: HorizonMeta, sky: SkyNowcast): Status {
  const { az, el } = sunPosition(t, terrace.lat, terrace.lon)
  if (el <= 0) return { state: 'night', share: 0, clear: 0 }
  const e = exposure(terrace, meta, az, el)
  const clear = skyAt(sky, t, terrace.lat, terrace.lon).clear
  if (e.sun === 0) return { state: e.trees > 0 ? 'trees' : 'shade', share: 0, clear }
  if (clear < 0.5) return { state: 'cloud', share: e.sun, clear }
  return { state: e.sun >= 0.99 ? 'sun' : 'partial', share: e.sun, clear }
}

// In the sun: at least half of the terrace, under a mostly clear sky.
export const sunny = (s: Status) => (s.state === 'sun' || s.state === 'partial') && s.share >= 0.5

export interface Outlook {
  now: Status
  until: number | null // when the sun leaves (if sunny now)
  untilBy: State | null // and why: 'cloud', 'shade', 'trees' or 'night'
  from: number | null // when it comes (if not)
  minutes: number // sunny minutes left today from t
  series: Status[] // every STEP from `start`
}

// The day around t: status every 5 minutes from `start` to `end`.
export function outlook(t: number, start: number, end: number, terrace: Terrace, meta: HorizonMeta, sky: SkyNowcast): Outlook {
  const series: Status[] = []
  for (let time = start; time < end; time += STEP) series.push(statusAt(time, terrace, meta, sky))
  const now = statusAt(t, terrace, meta, sky)
  const i0 = Math.max(0, Math.floor((t - start) / STEP) + 1)
  let until: number | null = null
  let untilBy: State | null = null
  let from: number | null = null
  let minutes = 0
  for (let i = i0; i < series.length; i++) {
    const s = sunny(series[i])
    if (s) minutes += STEP / 60
    if (sunny(now) && until == null && !s) {
      until = start + i * STEP
      untilBy = series[i].state === 'partial' || series[i].state === 'sun' ? 'shade' : series[i].state
    }
    if (!sunny(now) && from == null && s) from = start + i * STEP
  }
  return { now, until, untilBy, from, minutes, series }
}
