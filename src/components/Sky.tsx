import { rainBetween, type Weather } from '../api/weather'
import { num, t } from '../i18n'
import { clock, parisMidnight } from '../lib/format'
import { clearAround, type SkyNowcast } from '../lib/sky'
import { icon } from '../lib/weatherIcon'
import { sunPosition, sunTimes } from '../lib/sun'

const SPAN = 4 * 3600 // how far to look for the sun coming or going

interface Props {
  sky: SkyNowcast
  lat: number
  lon: number
  points: { lat: number; lon: number }[] // terraces of the chosen place, to average over
  time: number
  now: number
  satError: string | null
}

function tempAt(w: Weather | null, time: number): number | null {
  if (!w) return null
  const i = w.time.findIndex((end) => end > time)
  return i >= 0 ? w.temp[i] : null
}

// The sky at the chosen place and time: is the sun out, until when, and the next hours.
// Mean chance of sun over the place: an arrondissement can be half sunny.
function areaClear(sky: SkyNowcast, points: { lat: number; lon: number }[], t: number) {
  return points.reduce((a, p) => a + clearAround(sky, t, p.lat, p.lon), 0) / points.length
}

export function Sky({ sky, lat, lon, points: all, time, now, satError }: Props) {
  // Up to 25 terraces spread over the place (or its centre when it has none).
  const points = all.length ? all.filter((_, i) => i % Math.ceil(all.length / 25) === 0) : [{ lat, lon }]
  const day = parisMidnight(time)
  const times = sunTimes(day, lat, lon)
  const temp = tempAt(sky.weather, time)
  const tempText = temp != null ? ` · ${t('skyTemp', { t: num(temp, 0) })}` : ''

  if (!times || time < times.rise || time >= times.set) {
    const next = times && time < times.rise ? times.rise : sunTimes(parisMidnight(time, 1), lat, lon)?.rise
    return (
      <p className="sky-line">
        <span className="sky-icon" aria-hidden="true">🌙</span>
        {t('skyNight')}
        {next != null && <span className="soft"> · {t('sunrise', { time: clock(next) })}</span>}
        <span className="soft">{tempText}</span>
      </p>
    )
  }

  const c = areaClear(sky, points, time)
  let change: number | null = null
  for (let s = time + 300; s <= Math.min(times.set, time + SPAN); s += 300) {
    if (areaClear(sky, points, s) >= 0.5 !== c >= 0.5) {
      change = s
      break
    }
  }
  const rainNow = sky.weather ? rainBetween(sky.weather, time - 450, time + 450) : 0
  const head = rainNow >= 0.1 ? t('skyRain') : c >= 0.7 ? t('skySun') : c >= 0.25 ? t('skyMixed') : t('skyCloud')
  const tail =
    change != null ? (c >= 0.5 ? t('skyUntil', { time: clock(change) }) : t('skyFrom', { time: clock(change) })) : c >= 0.5 ? t('skyAllDay') : ''

  const latest = sky.sat?.frames[sky.sat.frames.length - 1]
  const lead = latest ? (time - latest.time) / 60 : Infinity
  const source = !sky.weather && !latest
    ? t('skyNoData')
    : latest && lead < 120 && sunPosition(time, lat, lon).el > 5
      ? t('skyBySat', { time: clock(latest.time) })
      : sky.weather
        ? t('skyByModel')
        : ''

  return (
    <>
      <p className="sky-line">
        <span className="sky-icon" aria-hidden="true">{icon(c, rainNow, true)}</span>
        {head}
        {tail && <span className="soft"> · {tail}</span>}
        <span className="soft">{tempText}</span>
      </p>
      <Hours sky={sky} lat={lat} lon={lon} points={points} from={time} />
      <p className="note">
        {source}
        {satError && time - now < 7200 && ` · ${t('skyNoSat')}`}
      </p>
    </>
  )
}

// The next hours, one symbol each.
function Hours({ sky, lat, lon, points, from }: { sky: SkyNowcast; lat: number; lon: number; points: { lat: number; lon: number }[]; from: number }) {
  const first = Math.ceil(from / 3600) * 3600
  const hours = Array.from({ length: 5 }, (_, k) => first + k * 3600)
  return (
    <ol className="hours">
      {hours.map((h) => {
        const mid = h + 1800
        const day = sunPosition(mid, lat, lon).el > 0
        const rain = sky.weather ? rainBetween(sky.weather, h, h + 3600) : 0
        return (
          <li key={h}>
            <span className="h">{clock(h).replace(':00', ' h').replace(/^0/, '')}</span>
            <span className="i" aria-hidden="true">{icon(day ? areaClear(sky, points, mid) : 0, rain, day)}</span>
          </li>
        )
      })}
    </ol>
  )
}
