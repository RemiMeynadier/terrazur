// On-site checks ("is this terrace in the sun right now?"), to score the
// model and improve it. Each answer is kept with what the model predicted.
// Answers wait in an outbox on the phone and are sent to FEEDBACK_URL once
// one is configured (any endpoint accepting a JSON POST, e.g. a Google Apps
// Script web app); until then they stay on the device.

export type Answer = 'sun' | 'partial' | 'shade' | 'cloud'

export interface Report {
  uid: string
  terrace: number
  name: string
  at: number // unix s, when the user answered
  answer: Answer
  predicted: string // model state at that time
  share: number // share of the terrace in the sun's geometry
  clear: number // chance the sun is out
  sat: number | null
  model: number | null
  user: { lat: number; lon: number } | null // when the user shared their position
  data: string // horizons build date
}

const KEY = 'tz.feedback'
const DONE = 'tz.feedback.done'
const URL: string = import.meta.env.VITE_FEEDBACK_URL ?? ''

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the answer is lost, nothing else to do.
  }
}

// Terraces already answered recently (one answer per terrace per hour).
export function answeredRecently(terrace: number, now: number): Answer | null {
  const done = read<Record<string, [Answer, number]>>(DONE, {})
  const hit = done[terrace]
  return hit && now - hit[1] < 3600 ? hit[0] : null
}

export function record(r: Omit<Report, 'uid'>) {
  const report: Report = { uid: crypto.randomUUID(), ...r }
  write(KEY, [...read<Report[]>(KEY, []), report])
  const done = read<Record<string, [Answer, number]>>(DONE, {})
  done[r.terrace] = [r.answer, r.at]
  write(DONE, done)
  void flush()
}

export async function flush() {
  if (!URL) return
  const pending = read<Report[]>(KEY, [])
  if (!pending.length) return
  try {
    // text/plain keeps it a "simple" request (no CORS preflight), which Apps Script needs.
    await fetch(URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(pending), keepalive: true })
    const sent = new Set(pending.map((p) => p.uid))
    write(KEY, read<Report[]>(KEY, []).filter((p) => !sent.has(p.uid)))
  } catch {
    // Offline: retried on the next answer or visit.
  }
}
