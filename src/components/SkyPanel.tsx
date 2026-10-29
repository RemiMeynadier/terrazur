import { useEffect, useRef } from 'react'
import { SAT_HALF_LAT, SAT_HALF_LON, SAT_SIZE } from '../api/satellite'
import { num, percent, t, tList } from '../i18n'
import { useWidth } from '../lib/chartUtils'
import { clock } from '../lib/format'
import { cloudOffset, type SkyNowcast, skyAt } from '../lib/sky'
import { sunPosition } from '../lib/sun'
import { cloudHeight, type Weather } from '../api/weather'

const HORIZON = 3 * 3600
const STEP = 300

interface Props {
  sky: SkyNowcast
  lat: number
  lon: number
  now: number
  satError: string | null
}

export function SkyPanel({ sky, lat, lon, now, satError }: Props) {
  const steps = Array.from({ length: HORIZON / STEP + 1 }, (_, k) => now + k * STEP).map((time) => ({
    time,
    ...skyAt(sky, time, lat, lon),
    el: sunPosition(time, lat, lon).el,
  }))
  // Broken clouds flicker from one step to the next: judge on 15-minute means.
  const smooth = steps.map((s, i) => {
    const w = steps.slice(Math.max(0, i - 1), i + 2)
    return { ...s, clear: w.reduce((a, x) => a + x.clear, 0) / w.length }
  })
  const cur = smooth[0]
  const day = smooth.filter((s) => s.el > 0)
  const isSunny = (c: number) => c >= 0.5
  const change = day.find((s) => isSunny(s.clear) !== isSunny(cur.clear))
  const head =
    cur.el <= 0 ? t('skyNight') : cur.clear >= 0.7 ? t('skySun') : cur.clear >= 0.4 ? t('skyMixed') : t('skyCloud')
  const icon = cur.el <= 0 ? '🌙' : cur.clear >= 0.7 ? '☀️' : cur.clear >= 0.4 ? '⛅' : '☁️'
  const latest = sky.sat?.frames[sky.sat.frames.length - 1]
  const temp = sky.weather ? nearest(sky.weather, now) : null

  return (
    <div className="sky">
      <div className="sky-main">
        <p className="sky-head">
          <span aria-hidden="true">{icon}</span>
          <strong>{head}</strong>
          {cur.el > 0 && change && (
            <span className="muted">{isSunny(cur.clear) ? t('skyUntil', { time: clock(change.time) }) : t('skyFrom', { time: clock(change.time) })}</span>
          )}
          {temp != null && <span className="muted">· {t('skyTemp', { t: num(temp, 0) })}</span>}
        </p>
        <p className="muted small">
          {satError
            ? t('skyNoSat')
            : latest && sky.sat
              ? motionText(sky, latest.time)
              : cur.el <= 5
                ? t('skySatNight')
                : ''}
        </p>
        {day.length > 1 && <SkyChart steps={steps.filter((s) => s.el > 0)} />}
      </div>
      {sky.sat && latest && <SatView sky={sky} lat={lat} lon={lon} now={now} />}
    </div>
  )
}

function nearest(w: Weather, time: number): number | null {
  const i = w.time.findIndex((end) => end > time)
  return i >= 0 ? w.temp[i] : null
}

function motionText(sky: SkyNowcast, time: number): string {
  const m = sky.motion
  const km = sky.sat!.kmPerPx
  if (!m || Math.hypot(m.dx, m.dy) * km * 60 < 5) return t('skySatStill', { time: clock(time) })
  const toward = (Math.atan2(m.dx, -m.dy) * 180) / Math.PI
  const sector = Math.round(((toward % 360) + 360) % 360 / 45) % 8
  return t('skySatAt', { time: clock(time), dir: tList('dirs')[sector], v: Math.round((Math.hypot(m.dx, m.dy) * km * 60) / 5) * 5 })
}

// Chance of sun over the next 3 hours: blend, satellite and model.
function SkyChart({ steps }: { steps: { time: number; clear: number; sat: number | null; model: number | null }[] }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const height = 130
  const M = { top: 10, right: 10, bottom: 22, left: 38 }
  const t0 = steps[0].time
  const t1 = steps[steps.length - 1].time
  const x = (v: number) => M.left + ((v - t0) / Math.max(1, t1 - t0)) * (width - M.left - M.right)
  const y = (v: number) => M.top + (1 - v) * (height - M.top - M.bottom)
  const line = (get: (s: (typeof steps)[number]) => number | null) => {
    let d = ''
    let pen = false
    for (const s of steps) {
      const v = get(s)
      if (v == null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(s.time).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    }
    return d
  }
  const area = `${line((s) => s.clear)}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`
  const hours: number[] = []
  for (let v = Math.ceil(t0 / 1800) * 1800; v <= t1; v += 1800) hours.push(v)
  return (
    <div className="chart" ref={ref}>
      <ul className="legend">
        <li><i className="key key-blend" />{t('skyChart')}</li>
        <li><i className="key key-sat" />{t('skySat')}</li>
        <li><i className="key key-model" />{t('skyModel')}</li>
      </ul>
      <svg width={width} height={height} role="img" aria-label={t('skyChart')}>
        <g className="grid">
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
              <text x={M.left - 6} y={y(v) + 4} textAnchor="end">{percent(v)}</text>
            </g>
          ))}
          {hours.map((v) => (
            <text key={v} x={x(v)} y={height - 6} textAnchor="middle">{clock(v)}</text>
          ))}
        </g>
        <path d={area} className="blend-area" />
        <path d={line((s) => s.model)} className="line line-model" />
        <path d={line((s) => s.sat)} className="line line-sat" />
      </svg>
    </div>
  )
}

// The latest satellite image around the place, with where the cloud that
// matters is looked up (line of sight to the sun + parallax).
function SatView({ sky, lat, lon, now }: { sky: SkyNowcast; lat: number; lon: number; now: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const sat = sky.sat!
  const latest = sat.frames[sat.frames.length - 1]
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.drawImage(latest.image, 0, 0)
    const toPx = (la: number, lo: number) => [
      ((lo - (sat.lon - SAT_HALF_LON)) / (2 * SAT_HALF_LON)) * SAT_SIZE,
      ((sat.lat + SAT_HALF_LAT - la) / (2 * SAT_HALF_LAT)) * SAT_SIZE,
    ]
    const [px, py] = toPx(lat, lon)
    const { az, el } = sunPosition(now, lat, lon)
    ctx.lineWidth = 2
    if (el > 3) {
      const h = sky.weather ? cloudHeight(sky.weather, now) : 2
      const o = cloudOffset(lat, lon, az, el, h)
      const [qx, qy] = toPx(lat + o.north / 111.2, lon + o.east / (111.32 * Math.cos((lat * Math.PI) / 180)))
      ctx.strokeStyle = '#f2b705'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(qx, qy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(qx, qy, 6, 0, 2 * Math.PI)
      ctx.stroke()
    }
    ctx.fillStyle = '#e34948'
    ctx.strokeStyle = '#fff'
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
  }, [latest, sat, sky.weather, lat, lon, now])
  return (
    <figure className="sat">
      <canvas ref={canvas} width={SAT_SIZE} height={SAT_SIZE} role="img" aria-label={t('skySat')} />
      <figcaption className="muted small">
        MTG · <a href="https://view.eumetsat.int/" target="_blank" rel="noreferrer">EUMETSAT</a> · {clock(latest.time)}
      </figcaption>
    </figure>
  )
}
