// Solar position, NOAA algorithm (accuracy ~0.01° for 1900–2100), with
// atmospheric refraction. Same code as scripts/sun.py.

const rad = Math.PI / 180

export interface SunPosition {
  az: number // degrees clockwise from north
  el: number // apparent elevation, degrees
}

export function sunPosition(unixSeconds: number, lat: number, lon: number): SunPosition {
  const jd = unixSeconds / 86400 + 2440587.5
  const T = (jd - 2451545) / 36525
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const Mr = M * rad
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad)
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * rad)
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad))
  const y = Math.tan((eps * rad) / 2) ** 2
  const L0r = L0 * rad
  const eot =
    (4 / rad) *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr))
  const minutes = (((unixSeconds % 86400) + 86400) % 86400) / 60
  const tst = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440
  const ha = (tst / 4 - 180) * rad
  const latr = lat * rad
  const cz = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha)
  let el = 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / rad
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) / rad + 180
  if (el > -1) el += 1.02 / Math.tan((el + 10.3 / (el + 5.11)) * rad) / 60 // Bennett
  return { az: ((az % 360) + 360) % 360, el }
}

// Sunrise and sunset (unix seconds) of the day containing `dayStart`, found by bisection.
export function sunTimes(dayStart: number, lat: number, lon: number): { rise: number; set: number } | null {
  // Apparent centre above the horizon (refraction included).
  const up = (t: number) => sunPosition(t, lat, lon).el > 0
  const noonGuess = dayStart + 43200 - lon * 240
  if (!up(noonGuess)) return null
  const edge = (a: number, b: number) => {
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2
      if (up(m) === up(a)) a = m
      else b = m
    }
    return Math.round((a + b) / 2)
  }
  return { rise: edge(noonGuess - 43200, noonGuess), set: edge(noonGuess, noonGuess + 43200) }
}
