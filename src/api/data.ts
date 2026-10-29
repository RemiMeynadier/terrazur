import { decode, type HorizonMeta, type Terrace } from '../lib/horizon'

// Horizons are computed by .github/workflows/horizons.yml and published on
// the `data` branch (too large and too slow to rebuild on every deploy).
const DATA: string = import.meta.env.VITE_DATA_URL ?? 'https://raw.githubusercontent.com/RemiMeynadier/terrazur/data'

export interface IndexEntry {
  id: number
  name: string
  lat: number
  lon: number
  cell: string
}

export interface DataIndex {
  meta: HorizonMeta & { generated: string; tile: number; seat: number }
  terraces: IndexEntry[]
}

export async function fetchIndex(): Promise<DataIndex> {
  const res = await fetch(`${DATA}/index.json`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { terraces, ...meta } = await res.json()
  return {
    meta,
    terraces: terraces.map(([id, name, lat, lon, cell]: [number, string, number, number, string]) => ({ id, name, lat, lon, cell })),
  }
}

const cells = new Map<string, Promise<Terrace[]>>()

export function fetchCell(cell: string): Promise<Terrace[]> {
  let p = cells.get(cell)
  if (!p) {
    p = fetch(`${DATA}/cells/${cell}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((body) => body.terraces.map((t: Terrace & { h: string; hb: string }) => ({ ...t, h: decode(t.h), hb: decode(t.hb) })))
    p.catch(() => cells.delete(cell))
    cells.set(cell, p)
  }
  return p
}
