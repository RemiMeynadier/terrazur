import type { Field } from '../lib/nowcast'
import { sunPosition } from '../lib/sun'

// EUMETSAT MTG-I FCI visible channel (0.6 µm, 500 m), a new image every 10 min.
const WMS = 'https://view.eumetsat.int/geoserver/wms'
const CAPS = 'https://view.eumetsat.int/geoserver/mtg_fd/vis06_hrfi/ows?service=WMS&version=1.3.0&request=GetCapabilities'
const LAYER = 'mtg_fd:vis06_hrfi'

export const SAT_SIZE = 320
export const SAT_HALF_LAT = 0.6 // degrees: ±67 km
export const SAT_HALF_LON = 0.9 // ±66 km at Paris
const FRAMES = 4 // the last 30 minutes

export interface SatFrame extends Field {
  image: HTMLCanvasElement
}

export interface Satellite {
  frames: SatFrame[] // oldest first
  lat: number // centre
  lon: number
  kmPerPx: number
}

async function latestTime(): Promise<number> {
  const xml = await (await fetch(CAPS)).text()
  const m = xml.match(/<Dimension name="time"[^>]*default="([^"]+)"/)
  if (!m) throw new Error('no satellite time')
  return Date.parse(m[1]) / 1000
}

// Calibrated against Open-Meteo's satellite DNI around Paris (October 2026):
// once the image is normalised by the square root of the sun's height, clear
// ground reads ~0.26–0.33 and overcast ~0.6–0.7.
const CLEAR = 0.36
const OVERCAST = 0.6

export function cloudIndex(gray: number, cosZenith: number): number {
  const v = gray / 255 / Math.sqrt(Math.max(0.05, cosZenith))
  return Math.max(0, Math.min(1, (v - CLEAR) / (OVERCAST - CLEAR)))
}

async function frame(time: number, lat: number, lon: number): Promise<SatFrame> {
  const bbox = [lat - SAT_HALF_LAT, lon - SAT_HALF_LON, lat + SAT_HALF_LAT, lon + SAT_HALF_LON].join(',')
  const iso = new Date(time * 1000).toISOString().replace('.000', '')
  const url = `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${LAYER}&styles=&crs=EPSG:4326&bbox=${bbox}&width=${SAT_SIZE}&height=${SAT_SIZE}&format=image/png&time=${iso}`
  const res = await fetch(url)
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`satellite HTTP ${res.status}`)
  const bitmap = await createImageBitmap(await res.blob())
  const image = document.createElement('canvas')
  image.width = image.height = SAT_SIZE
  const ctx = image.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, SAT_SIZE, SAT_SIZE)
  const { data } = ctx.getImageData(0, 0, SAT_SIZE, SAT_SIZE)
  const cosZ = Math.sin((Math.max(0, sunPosition(time, lat, lon).el) * Math.PI) / 180)
  const rate = new Float32Array(SAT_SIZE * SAT_SIZE)
  for (let i = 0; i < rate.length; i++) rate[i] = cloudIndex(data[i * 4], cosZ)
  return { time, size: SAT_SIZE, rate, image }
}

export async function fetchSatellite(lat: number, lon: number): Promise<Satellite> {
  const last = await latestTime()
  const times = Array.from({ length: FRAMES }, (_, k) => last - (FRAMES - 1 - k) * 600)
  // A missing image should not cost the whole nowcast: retry once, then do without it.
  const results = await Promise.allSettled(times.map((t) => frame(t, lat, lon).catch(() => frame(t, lat, lon))))
  const frames = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (!frames.length || frames[frames.length - 1].time !== last) {
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    throw failed?.reason ?? new Error('no satellite image')
  }
  return { frames, lat, lon, kmPerPx: (2 * SAT_HALF_LAT * 111.2) / SAT_SIZE }
}
