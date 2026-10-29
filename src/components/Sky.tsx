import { type Weather } from '../api/weather'
import { num, t } from '../i18n'
import { useWidth } from '../lib/chartUtils'
import { clock, parisMidnight } from '../lib/format'
import { clearAround, type SkyNowcast } from '../lib/sky'
import { sunPosition, sunTimes } from '../lib/sun'

const STEP = 900
const SPAN = 4 * 3600

interface Props {
  sky: SkyNowcast
  lat: number
  lon: number
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
export function Sky({ sky, lat, lon, time, now, satError }: Props) {
  const day = parisMidnight(time)
  const times = sunTimes(day, lat, lon)
  const temp = tempAt(sky.weather, time)
  const tempText = temp != null ? ` · ${t('skyTemp', { t: num(temp, 0) })}` : ''

  if (!times || time < times.rise || time >= times.set) {
    const next = times && time < times.rise ? times.rise : sunTimes(parisMidnight(time, 1), lat, lon)?.rise
    return (
      <p className="sky-line">
        {t('skyNight')}
        {next != null && <span className="soft"> · {t('sunrise', { time: clock(next) })}</span>}
        <span className="soft">{tempText}</span>
      </p>
    )
  }

  const c = clearAround(sky, time, lat, lon)
  let change: number | null = null
  for (let s = time + 300; s <= Math.min(times.set, time + SPAN); s += 300) {
    if (clearAround(sky, s, lat, lon) >= 0.5 !== c >= 0.5) {
      change = s
      break
    }
  }
  const head = c >= 0.7 ? t('skySun') : c >= 0.4 ? t('skyMixed') : t('skyCloud')
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
        {head}
        {tail && <span className="soft"> · {tail}</span>}
        <span className="soft">{tempText}</span>
      </p>
      <SkyStrip sky={sky} lat={lat} lon={lon} from={time} to={Math.min(times.set, time + SPAN)} />
      <p className="note">
        {source}
        {satError && time - now < 7200 && ` · ${t('skyNoSat')}`}
      </p>
    </>
  )
}

// Next hours, one cell per 15 minutes: the brighter, the likelier the sun.
function SkyStrip({ sky, lat, lon, from, to }: { sky: SkyNowcast; lat: number; lon: number; from: number; to: number }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  if (to - from < STEP) return null
  const start = Math.floor(from / STEP) * STEP
  const cells: { t: number; c: number }[] = []
  for (let s = start; s < to; s += STEP) cells.push({ t: s, c: clearAround(sky, Math.max(from, s + STEP / 2), lat, lon) })
  const x = (v: number) => ((v - start) / (cells.length * STEP)) * width
  const h = 18
  const hours: number[] = []
  for (let v = Math.ceil(start / 3600) * 3600; v < start + cells.length * STEP; v += 3600) {
    if (x(v) > 14 && x(v) < width - 14) hours.push(v) // no clipped labels at the edges
  }
  return (
    <div className="strip" ref={ref}>
      <svg width={width} height={h + 16} role="img" aria-label={t('skyChart')}>
        {cells.map((cell) => (
          <rect key={cell.t} x={x(cell.t) + 1} y={0} width={Math.max(1, x(cell.t + STEP) - x(cell.t) - 2)} height={h} rx={3} className="sky-cell" style={{ fillOpacity: 0.12 + 0.88 * cell.c }} />
        ))}
        {hours.map((v) => (
          <text key={v} x={x(v)} y={h + 13} textAnchor="middle">
            {clock(v).replace(':00', ' h').replace(/^0/, '')}
          </text>
        ))}
      </svg>
    </div>
  )
}
