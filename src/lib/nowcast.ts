// Cloud nowcast by satellite extrapolation (same method as the rain nowcast
// of LocalWeatherForecast): estimate how the cloud field moved between two
// images, then slide the latest image along that motion. Good for 30–90
// minutes; blind to clouds that form or dissolve on the way.

// A 0–1 cloud index on a square pixel grid, at one time (unix seconds).
export interface Field {
  time: number
  size: number
  rate: Float32Array // cloud index, 0–1
}

// Pixels per minute (x to the east, y to the south).
export interface Motion {
  dx: number
  dy: number
}

export const CLOUD_MIN = 0.3 // index above which a pixel counts as cloudy
const COARSE = 4

function coarsen(f: Field): { n: number; v: Float32Array; cloudy: number } {
  const n = Math.floor(f.size / COARSE)
  const v = new Float32Array(n * n)
  let cloudy = 0
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let s = 0
      for (let y = 0; y < COARSE; y++) {
        const row = (cy * COARSE + y) * f.size + cx * COARSE
        for (let x = 0; x < COARSE; x++) s += f.rate[row + x]
      }
      // Log scale, so that the shape of the clouds matters more than their brightness.
      const m = Math.log1p(s / (COARSE * COARSE))
      v[cy * n + cx] = m
      if (m > 0.05) cloudy++
    }
  }
  return { n, v, cloudy }
}

// Mean squared difference between `b` and `a` shifted by (sx, sy), over
// cells where either has cloud. `step` subsamples the comparison.
function cost(a: Float32Array, b: Float32Array, n: number, sx: number, sy: number, margin: number, step = 1) {
  let sum = 0
  let count = 0
  for (let y = margin; y < n - margin; y += step) {
    for (let x = margin; x < n - margin; x += step) {
      const va = a[(y - sy) * n + (x - sx)]
      const vb = b[y * n + x]
      if (va === 0 && vb === 0) continue
      sum += (va - vb) ** 2
      count++
    }
  }
  // A tiny pull towards small shifts breaks ties in uniform cloud.
  return count ? sum / count + 1e-4 * (sx * sx + sy * sy) : Infinity
}

// Motion of the cloud field from `a` to `b` (same grid, `a` earlier), or null
// when there are too few clouds around to tell.
export function estimateMotion(a: Field, b: Field, maxPxPerMin: number): Motion | null {
  const minutes = (b.time - a.time) / 60
  if (minutes <= 0) return null
  const ca = coarsen(a)
  const cb = coarsen(b)
  if (cb.cloudy < 12 || ca.cloudy < 12) return null

  const S = Math.ceil((maxPxPerMin * minutes) / COARSE)
  let best = { c: Infinity, sx: 0, sy: 0 }
  for (let sy = -S; sy <= S; sy++) {
    for (let sx = -S; sx <= S; sx++) {
      const c = cost(ca.v, cb.v, ca.n, sx, sy, S)
      if (c < best.c) best = { c, sx, sy }
    }
  }

  // Refine to the pixel on the full-resolution fields.
  const la = a.rate.map(Math.log1p)
  const lb = b.rate.map(Math.log1p)
  const margin = (S + 1) * COARSE
  let fine = { c: Infinity, sx: best.sx * COARSE, sy: best.sy * COARSE }
  for (let dy = -COARSE; dy <= COARSE; dy++) {
    for (let dx = -COARSE; dx <= COARSE; dx++) {
      const sx = best.sx * COARSE + dx
      const sy = best.sy * COARSE + dy
      const c = cost(la, lb, a.size, sx, sy, margin, 2)
      if (c < fine.c) fine = { c, sx, sy }
    }
  }
  return { dx: fine.sx / minutes, dy: fine.sy / minutes }
}

// Mean cloud index and cloudy fraction in a square of radius r around (x, y).
export function sampleAt(f: Field, x: number, y: number, r: number): { rate: number; chance: number } {
  const x0 = Math.max(0, Math.round(x - r))
  const x1 = Math.min(f.size - 1, Math.round(x + r))
  const y0 = Math.max(0, Math.round(y - r))
  const y1 = Math.min(f.size - 1, Math.round(y + r))
  let sum = 0
  let wet = 0
  let n = 0
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const v = f.rate[yy * f.size + xx]
      sum += v
      if (v >= CLOUD_MIN) wet++
      n++
    }
  }
  return n ? { rate: sum / n, chance: wet / n } : { rate: 0, chance: 0 }
}

export interface NowcastStep {
  time: number // unix seconds
  rate: number // mean cloud index
  chance: number // 0–1, share of the neighbourhood that is cloudy
}

// Clouds at pixel (x, y) at each time, by sliding `latest` along `motion`.
// The neighbourhood widens with lead time, as position errors grow.
export function extrapolate(latest: Field, motion: Motion | null, x: number, y: number, times: number[]): NowcastStep[] {
  const m = motion ?? { dx: 0, dy: 0 }
  return times.map((time) => {
    const lead = Math.max(0, (time - latest.time) / 60)
    const r = 1.5 + lead / 12
    const { rate, chance } = sampleAt(latest, x - m.dx * lead, y - m.dy * lead, r)
    return { time, rate, chance }
  })
}
