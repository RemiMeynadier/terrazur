import { type Satellite, SAT_HALF_LAT, SAT_HALF_LON, SAT_SIZE } from '../api/satellite'
import { cloudHeight, modelClear, type Weather } from '../api/weather'
import { estimateMotion, type Motion, sampleAt } from './nowcast'
import { sunPosition } from './sun'

// Is the sun's disc free of clouds, seen from a given place and time?
// Within ~1 h: the satellite image, moved along the clouds' motion, looked
// up where the line of sight to the sun crosses the cloud layer. Beyond:
// the model's direct sunlight. The two are blended in between.

const MTG_LON = 0 // the satellite sits over the equator at 0°
const DEG = Math.PI / 180

export interface SkyNowcast {
  sat: Satellite | null
  motion: Motion | null
  weather: Weather | null
}

export function satMotion(sat: Satellite): Motion | null {
  const f = sat.frames
  if (f.length < 3) return null
  // ~100 km/h at most (jet-level cirrus can be faster, but they rarely hide the sun alone).
  return estimateMotion(f[f.length - 3], f[f.length - 1], 100 / 60 / sat.kmPerPx)
}

// Where the cloud blocking the sun shows up in the satellite image (km east, km north of the place):
// along the line of sight to the sun, then shifted by the satellite's parallax.
export function cloudOffset(lat: number, lon: number, az: number, el: number, heightKm: number) {
  const reach = Math.min(30, heightKm / Math.tan(Math.max(3, el) * DEG))
  let east = reach * Math.sin(az * DEG)
  let north = reach * Math.cos(az * DEG)
  // Parallax: a geostationary satellite sees a cloud at height h displaced away from
  // its sub-point by h·tan(viewing zenith).
  const g = Math.acos(Math.cos(lat * DEG) * Math.cos((lon - MTG_LON) * DEG))
  const vza = Math.atan2(Math.sin(g), Math.cos(g) - 6378 / 42164)
  const shift = heightKm * Math.tan(vza)
  const bearing = Math.atan2(Math.sin((lon - MTG_LON) * DEG), Math.tan(lat * DEG))
  east += shift * Math.sin(bearing)
  north += shift * Math.cos(bearing)
  return { east, north }
}

export interface SkyAt {
  clear: number // chance the sun is out, 0–1
  sat: number | null // the satellite's view alone
  model: number | null // the model's alone
}

export function skyAt(s: SkyNowcast, t: number, lat: number, lon: number): SkyAt {
  const { az, el } = sunPosition(t, lat, lon)
  const model = s.weather ? modelClear(s.weather, t) : null
  let sat: number | null = null
  let w = 0
  const latest = s.sat?.frames[s.sat.frames.length - 1]
  if (s.sat && latest && el > 5) {
    const lead = (t - latest.time) / 60
    // Full trust in the first hour, fading out by two hours.
    w = Math.max(0, Math.min(1, (120 - lead) / 60))
    if (w > 0) {
      const h = s.weather ? cloudHeight(s.weather, t) : 2
      const o = cloudOffset(lat, lon, az, el, h)
      const kmLon = 111.32 * Math.cos(s.sat.lat * DEG)
      const px = ((lon + o.east / kmLon - (s.sat.lon - SAT_HALF_LON)) / (2 * SAT_HALF_LON)) * SAT_SIZE
      const py = ((s.sat.lat + SAT_HALF_LAT - (lat + o.north / 111.2)) / (2 * SAT_HALF_LAT)) * SAT_SIZE
      const m = s.motion ?? { dx: 0, dy: 0 }
      const back = Math.max(0, lead)
      // ~0.5 km around the line of sight, widening as the extrapolation ages.
      const r = 1 + back / 15
      sat = 1 - sampleAt(latest, px - m.dx * back, py - m.dy * back, r).chance
    }
  }
  if (sat == null) return { clear: model ?? 1, sat, model }
  if (model == null) return { clear: sat, sat, model }
  return { clear: w * sat + (1 - w) * model, sat, model }
}

// Broken clouds flicker from one 5-minute step to the next: a 15-minute mean
// is what someone sitting there experiences. Used everywhere a state is shown.
// Cached per ~150 m: a satellite pixel is ~400 m, so neighbouring terraces share it.
const cache = new WeakMap<SkyNowcast, Map<string, number>>()

export function clearAround(s: SkyNowcast, t: number, lat: number, lon: number): number {
  let m = cache.get(s)
  if (!m) cache.set(s, (m = new Map()))
  const key = `${t}|${Math.round(lat * 700)}|${Math.round(lon * 500)}`
  let v = m.get(key)
  if (v === undefined) {
    v = [-300, 0, 300].reduce((a, d) => a + skyAt(s, t + d, lat, lon).clear, 0) / 3
    m.set(key, v)
  }
  return v
}
