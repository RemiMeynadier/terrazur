// Weather symbol from the chance of sun and the rain (mm over the period).
export function icon(clear: number, rain: number, day: boolean): string {
  if (!day) return '🌙'
  if (rain >= 0.5) return '🌧️'
  if (rain >= 0.1) return clear >= 0.4 ? '🌦️' : '🌧️'
  if (clear >= 0.8) return '☀️'
  if (clear >= 0.6) return '🌤️'
  if (clear >= 0.4) return '⛅'
  if (clear >= 0.2) return '🌥️'
  return '☁️'
}
