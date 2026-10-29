import { describe, expect, it } from 'vitest'
import { cloudIndex } from '../api/satellite'
import { duration, parisMidnight } from './format'
import { exposure, type HorizonMeta, type Terrace } from './horizon'
import { cloudOffset } from './sky'
import { sunPosition, sunTimes } from './sun'

describe('sun', () => {
  it('matches the Python pipeline (NOAA)', () => {
    const cases: [number, number, number, number, number][] = [
      [1782043200, 48.8566, 2.3522, 184.0491, 64.5454], // 21 June 2026, 12:00 UTC, Paris
      [1797841800, 48.8566, 2.3522, 135.3999, 5.3958], // 21 Dec, 08:30 UTC
      [1774025100, 43.6, 1.44, 256.5553, 13.8365], // 20 March, 16:45 UTC, Toulouse
    ]
    for (const [ts, lat, lon, az, el] of cases) {
      const p = sunPosition(ts, lat, lon)
      expect(p.az).toBeCloseTo(az, 3)
      expect(p.el).toBeCloseTo(el, 3)
    }
  })

  it('finds sunrise and sunset in Paris on 21 June (05:47 / 21:58 CEST)', () => {
    const day = parisMidnight(1782043200)
    const { rise, set } = sunTimes(day, 48.8566, 2.3522)!
    // Published times use the sun's upper limb (−0.83°); ours use the centre at 0°: ~4–5 min later/earlier.
    expect((rise - day) / 60).toBeGreaterThan(5 * 60 + 47)
    expect((rise - day) / 60).toBeLessThan(5 * 60 + 56)
    expect((set - day) / 60).toBeLessThan(21 * 60 + 58)
    expect((set - day) / 60).toBeGreaterThan(21 * 60 + 49)
  })
})

describe('horizons', () => {
  const meta: HorizonMeta = { az0: 45, naz: 271, angleStep: 0.3, points: 3 }
  // Buildings at 20° everywhere; trees up to 40° from the south-west (215°–235°) for point 0 only.
  const hb = new Uint8Array(3 * 271).fill(20 / 0.3)
  const h = hb.slice()
  for (let az = 215; az <= 235; az++) h[az - 45] = 40 / 0.3
  const terrace = { h, hb, lat: 48.85, lon: 2.35 } as unknown as Terrace

  it('counts the points above the obstacles', () => {
    expect(exposure(terrace, meta, 180, 30)).toEqual({ sun: 1, trees: 0 })
    expect(exposure(terrace, meta, 180, 10)).toEqual({ sun: 0, trees: 0 })
    const e = exposure(terrace, meta, 225, 30)
    expect(e.sun).toBeCloseTo(2 / 3)
    expect(e.trees).toBeCloseTo(1 / 3)
  })

  it('treats azimuths outside the profile as blocked', () => {
    expect(exposure(terrace, meta, 20, 30).sun).toBe(0)
  })
})

describe('clouds', () => {
  it('maps satellite brightness to a cloud index', () => {
    expect(cloudIndex(60, 0.5)).toBe(0) // clear ground at midday
    expect(cloudIndex(125, 0.5)).toBe(1) // overcast
  })

  it('looks for the cloud towards the sun, shifted north by the parallax', () => {
    // Low sun in the south: the line of sight reaches far south; parallax pushes ~1.5×h north.
    const o = cloudOffset(48.85, 2.35, 180, 20, 2)
    const reach = 2 / Math.tan((20 * Math.PI) / 180)
    expect(o.north).toBeCloseTo(-reach + 2 * 1.49, 0)
    expect(Math.abs(o.east)).toBeLessThan(0.3)
  })
})

describe('format', () => {
  it('formats durations', () => {
    expect(duration(45)).toBe('45 min')
    expect(duration(80)).toMatch(/^1 h/)
  })

  it('finds Paris midnight across DST', () => {
    const noon = Date.parse('2026-10-25T11:00:00Z') / 1000 // the day clocks go back
    const d = parisMidnight(noon)
    expect(new Date(d * 1000).toISOString()).toBe('2026-10-24T22:00:00.000Z') // CEST
    expect(new Date(parisMidnight(noon, 1) * 1000).toISOString()).toBe('2026-10-25T23:00:00.000Z') // CET
  })
})
