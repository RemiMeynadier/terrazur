import { sunPosition } from './sun'

// Sky horizons computed by scripts/build_horizons.py: for a few points on
// each terrace, the elevation of the highest obstacle in every direction,
// once with all obstacles (buildings and trees) and once with buildings only.

export interface HorizonMeta {
  az0: number // first azimuth, degrees
  naz: number // one value per degree
  angleStep: number // degrees per unit
  points: number
}

export interface Terrace {
  id: number
  name: string
  addr: string
  arr: string | null
  typ: string
  lat: number
  lon: number
  L: number
  W: number
  axis: number // facade direction, degrees from north
  z: number // ground altitude
  h: Uint8Array // [points × naz], all obstacles
  hb: Uint8Array // [points × naz], buildings only
}

export function decode(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// Horizon elevation (degrees) of point `p` at azimuth `az`, linearly interpolated.
export function horizonAt(h: Uint8Array, meta: HorizonMeta, p: number, az: number): number {
  const i = az - meta.az0
  if (i < 0 || i > meta.naz - 1) return 90 // the sun never shines from there in Paris
  const i0 = Math.floor(i)
  const i1 = Math.min(meta.naz - 1, i0 + 1)
  const f = i - i0
  const row = p * meta.naz
  return (h[row + i0] * (1 - f) + h[row + i1] * f) * meta.angleStep
}

// What a terrace gets from the sun's geometry alone (clouds aside).
export interface Exposure {
  sun: number // share of the terrace in direct sun, 0–1
  trees: number // share in the shade of trees only (dappled light)
}

export function exposure(t: Terrace, meta: HorizonMeta, az: number, el: number): Exposure {
  if (el <= 0) return { sun: 0, trees: 0 }
  let sun = 0
  let trees = 0
  for (let p = 0; p < meta.points; p++) {
    if (el > horizonAt(t.h, meta, p, az)) sun++
    else if (el > horizonAt(t.hb, meta, p, az)) trees++
  }
  return { sun: sun / meta.points, trees: trees / meta.points }
}

export type Geometry = 'sun' | 'partial' | 'trees' | 'shade' | 'night'

export function geometryState(e: Exposure, el: number): Geometry {
  if (el <= 0) return 'night'
  if (e.sun >= 0.99) return 'sun'
  if (e.sun > 0) return 'partial'
  if (e.trees > 0) return 'trees'
  return 'shade'
}

// Exposure every `step` seconds over [from, to).
export function exposureSeries(t: Terrace, meta: HorizonMeta, from: number, to: number, step: number) {
  const out: { time: number; az: number; el: number; e: Exposure }[] = []
  for (let time = from; time < to; time += step) {
    const { az, el } = sunPosition(time, t.lat, t.lon)
    out.push({ time, az, el, e: exposure(t, meta, az, el) })
  }
  return out
}
