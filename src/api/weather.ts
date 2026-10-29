// Open-Meteo: 15-minute direct sunlight (AROME in France) and cloud layers.

export interface Weather {
  time: number[] // unix s, end of each 15-minute interval
  dni: (number | null)[] // direct normal irradiance, W/m², mean over the interval
  temp: (number | null)[]
  precip: (number | null)[] // mm in the interval
  hourly: { time: number[]; low: number[]; mid: number[]; high: number[]; wind: number[] }
}

export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    minutely_15: 'direct_normal_irradiance,temperature_2m,precipitation',
    past_minutely_15: '8',
    forecast_minutely_15: String(4 * 24 * 3),
    hourly: 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m',
    past_days: '1',
    forecast_days: '3',
    timeformat: 'unixtime',
    timezone: 'Europe/Paris',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
  const body = await res.json()
  if (!res.ok || body.error) throw new Error(body?.reason ?? `HTTP ${res.status}`)
  const m = body.minutely_15
  const h = body.hourly
  return {
    time: m.time,
    dni: m.direct_normal_irradiance,
    temp: m.temperature_2m,
    precip: m.precipitation,
    hourly: { time: h.time, low: h.cloud_cover_low, mid: h.cloud_cover_mid, high: h.cloud_cover_high, wind: h.wind_speed_10m },
  }
}

// WMO: "sunshine" means direct normal irradiance ≥ 120 W/m².
export const SUNSHINE_DNI = 120

// Chance the sun is out according to the model, from the interval's mean DNI.
export function modelClear(w: Weather, t: number): number | null {
  const i = w.time.findIndex((end) => end > t)
  const dni = i >= 0 ? w.dni[i] : null
  if (dni == null) return null
  return Math.max(0, Math.min(1, (dni - 30) / (SUNSHINE_DNI + 60 - 30)))
}

// Typical height (km) of the clouds that matter at time t: the lowest layer with real cover.
export function cloudHeight(w: Weather, t: number): number {
  const h = w.hourly
  let i = h.time.findIndex((x) => x > t) - 1
  if (i < 0) i = 0
  if (h.low[i] >= 20) return 1.5
  if (h.mid[i] >= 20) return 4.5
  if (h.high[i] >= 20) return 9
  return 2
}

// Rain (mm) over [from, to), from the 15-minute intervals.
export function rainBetween(w: Weather, from: number, to: number): number {
  let sum = 0
  w.time.forEach((end, i) => {
    if (end > from && end - 900 < to) sum += w.precip[i] ?? 0
  })
  return sum
}
