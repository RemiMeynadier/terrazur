import { useMemo } from 'react'
import { horizonAt, type HorizonMeta, type Terrace } from '../lib/horizon'
import { t, tList, type TKey } from '../i18n'
import { useWidth } from '../lib/chartUtils'
import { clock } from '../lib/format'
import { type Outlook, type State, STEP } from '../lib/status'
import { sunPosition } from '../lib/sun'

const STRIP_STATES: State[] = ['sun', 'partial', 'trees', 'shade', 'cloud']

// One cell per 5 minutes, sunrise to sunset.
export function DayStrip({ outlook, dayStart, time, now }: { outlook: Outlook; dayStart: number; time: number; now: number }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const cells = outlook.series.map((s, i) => ({ s, t: dayStart + i * STEP })).filter((c) => c.s.state !== 'night')
  if (!cells.length) return null
  const t0 = cells[0].t
  const t1 = cells[cells.length - 1].t + STEP
  const x = (v: number) => ((v - t0) / (t1 - t0)) * width
  const h = 28
  const hours: number[] = []
  for (let v = Math.ceil(t0 / 3600) * 3600; v < t1; v += 3600) hours.push(v)
  const every = width < 420 ? 3 : 2
  return (
    <div className="strip" ref={ref}>
      <svg width={width} height={h + 18} role="img" aria-label={t('dayStrip')}>
        {cells.map((c) => (
          <rect key={c.t} x={x(c.t)} y={0} width={Math.max(1, x(c.t + STEP) - x(c.t)) + 0.3} height={h} className={`st-fill st-${c.s.state}`} opacity={c.t + STEP <= now ? 0.45 : 1} />
        ))}
        {time >= t0 && time <= t1 && <line x1={x(time)} x2={x(time)} y1={-2} y2={h + 2} className="strip-now" />}
        {hours.map((v, i) =>
          i % every === 0 ? (
            <text key={v} x={x(v)} y={h + 14} textAnchor="middle">
              {clock(v).replace(':00', ' h').replace(/^0/, '')}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="legend">
        {STRIP_STATES.map((s) => (
          <li key={s}>
            <i className={`swatch st-${s}`} />
            {t(`stripLegend${s[0].toUpperCase()}${s.slice(1)}` as TKey)}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Panorama from the terrace's middle point: obstacles against the sun's path.
export function SkyPlot({ terrace, meta, dayStart, time }: { terrace: Terrace; meta: HorizonMeta; dayStart: number; time: number }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const height = 200
  const M = { top: 10, right: 8, bottom: 22, left: 30 }
  const az0 = meta.az0
  const az1 = meta.az0 + meta.naz - 1
  const elMax = 70
  const x = (az: number) => M.left + ((az - az0) / (az1 - az0)) * (width - M.left - M.right)
  const y = (el: number) => M.top + (1 - Math.max(0, el) / elMax) * (height - M.top - M.bottom)
  const p = Math.floor(meta.points / 2)

  const { bldg, all } = useMemo(() => {
    const line = (h: Uint8Array) => {
      let d = `M${x(az0)},${y(0)}`
      for (let az = az0; az <= az1; az++) d += `L${x(az).toFixed(1)},${y(Math.min(elMax, horizonAt(h, meta, p, az))).toFixed(1)}`
      return `${d}L${x(az1)},${y(0)}Z`
    }
    return { bldg: line(terrace.hb), all: line(terrace.h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrace, meta, width])

  const path = useMemo(() => {
    let d = ''
    for (let s = dayStart; s < dayStart + 86400; s += 600) {
      const { az, el } = sunPosition(s, terrace.lat, terrace.lon)
      if (el < 0) continue
      d += `${d ? 'L' : 'M'}${x(az).toFixed(1)},${y(el).toFixed(1)}`
    }
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrace, dayStart, width])

  const sun = sunPosition(time, terrace.lat, terrace.lon)
  const dirs = tList('dirsShort')
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={t('skyPlot')}>
        <g className="grid">
          {[0, 20, 40, 60].map((el) => (
            <g key={el}>
              <line x1={M.left} x2={width - M.right} y1={y(el)} y2={y(el)} />
              <text x={M.left - 5} y={y(el) + 4} textAnchor="end">{el}°</text>
            </g>
          ))}
          {[90, 135, 180, 225, 270].map((az) => (
            <text key={az} x={x(az)} y={height - 6} textAnchor="middle">
              {dirs[az / 45]}
            </text>
          ))}
        </g>
        <path d={all} className="sky-trees" />
        <path d={bldg} className="sky-bldg" />
        {path && <path d={path} className="sun-path" />}
        {sun.el > 0 && sun.az >= az0 && sun.az <= az1 && <circle cx={x(sun.az)} cy={y(sun.el)} r={7} className="sun-dot" />}
      </svg>
    </div>
  )
}
