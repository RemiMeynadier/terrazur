import type { DataIndex, IndexEntry } from '../api/data'
import { prettyName } from './format'

// What the user can type in "Where?": a street, a quartier, an arrondissement.
export type Place =
  | { kind: 'street'; name: string }
  | { kind: 'quartier'; id: number }
  | { kind: 'arr'; n: number }
  | { kind: 'here'; lat: number; lon: number }

export interface Suggestion {
  place: Place
  label: string
  hint: string
}

export const AROUND_M = 450

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// "35 BIS RUE DE LA GRANGE AUX BELLES" → "RUE DE LA GRANGE AUX BELLES"
export const streetOf = (addr: string) => addr.replace(/^\s*\d+\s*(BIS|TER|QUATER|[A-Z])?\b[\s,]*/i, '').trim()

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const k = 111_320
  return Math.hypot((a.lat - b.lat) * k, (a.lon - b.lon) * k * Math.cos((a.lat * Math.PI) / 180))
}

export function contains(index: DataIndex, e: IndexEntry, p: Place): boolean {
  switch (p.kind) {
    case 'street':
      return streetOf(e.addr) === p.name
    case 'quartier':
      return e.quartier === p.id
    case 'arr':
      return index.quartiers.find((q) => q.id === e.quartier)?.arr === p.n
    case 'here':
      return distanceM(e, p) <= AROUND_M
  }
}

// Streets with terraces, and how many, built once per index.
const streets = new WeakMap<DataIndex, [string, string, number][]>()
function streetList(index: DataIndex) {
  let list = streets.get(index)
  if (!list) {
    const count = new Map<string, number>()
    for (const e of index.terraces) {
      const s = streetOf(e.addr)
      if (s) count.set(s, (count.get(s) ?? 0) + 1)
    }
    list = [...count].map(([name, n]) => [name, norm(name), n] as [string, string, number]).sort((a, b) => b[2] - a[2])
    streets.set(index, list)
  }
  return list
}

const ordinal = (n: number, fr: boolean) => (fr ? (n === 1 ? '1er' : `${n}e`) : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)

export function arrLabel(n: number, fr: boolean) {
  return fr ? `${ordinal(n, true)} arrondissement` : `${ordinal(n, false)} arrondissement`
}

export function suggest(index: DataIndex, query: string, fr: boolean, max = 8): Suggestion[] {
  const q = norm(query)
  if (!q) return []
  const out: Suggestion[] = []
  // "5", "5e", "5eme", "75005", "paris 5"
  const m = q.match(/^(?:paris\s*)?(?:750?)?(\d{1,2})\s*(?:e|er|eme|ème|th|st|nd|rd)?(?:\s*arr.*)?$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) {
    const n = Number(m[1])
    out.push({ place: { kind: 'arr', n }, label: arrLabel(n, fr), hint: '' })
  }
  for (const qt of index.quartiers) {
    if (norm(qt.name).includes(q)) out.push({ place: { kind: 'quartier', id: qt.id }, label: qt.name, hint: arrLabel(qt.arr, fr) })
  }
  if (q.length >= 3) {
    for (const [name, key, n] of streetList(index)) {
      if (out.length >= max) break
      if (key.includes(q)) out.push({ place: { kind: 'street', name }, label: prettyName(name), hint: String(n) })
    }
  }
  return out.slice(0, max)
}

export function placeLabel(index: DataIndex, p: Place, fr: boolean): string {
  switch (p.kind) {
    case 'street':
      return prettyName(p.name)
    case 'quartier':
      return index.quartiers.find((q) => q.id === p.id)?.name ?? ''
    case 'arr':
      return arrLabel(p.n, fr)
    case 'here':
      return ''
  }
}

// Where to look at the sky from: the middle of the place's terraces.
export function centreOf(entries: { lat: number; lon: number }[], fallback: { lat: number; lon: number }) {
  if (!entries.length) return fallback
  const lat = entries.reduce((a, e) => a + e.lat, 0) / entries.length
  const lon = entries.reduce((a, e) => a + e.lon, 0) / entries.length
  return { lat, lon }
}
