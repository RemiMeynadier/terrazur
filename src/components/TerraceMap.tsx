import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { State } from '../lib/status'

export interface Pin {
  id: number
  lat: number
  lon: number
  state: State | null // null: not computed (zoomed out, or still loading)
  sunny: boolean
}

export interface View {
  lat: number
  lon: number
  zoom: number
  south: number
  west: number
  north: number
  east: number
}

export interface Focus {
  lat: number
  lon: number
  zoom: number
  key: string // a new key moves the map
}

interface Props {
  pins: Pin[]
  zoom: number
  selected: number | null
  user: { lat: number; lon: number } | null
  focus: Focus
  onView: (v: View) => void
  onPick: (id: number | null) => void
}

// Grey OpenStreetMap with one dot per terrace, coloured by its sun.
// Leaflet is driven imperatively; React only hands it the pins.
export function TerraceMap({ pins, zoom, selected, user, focus, onView, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const handlers = useRef({ onView, onPick })
  useEffect(() => {
    handlers.current = { onView, onPick }
  })

  useEffect(() => {
    const m = L.map(box.current!, {
      zoomControl: false,
      renderer: L.canvas({ padding: 0.3, tolerance: 8 }), // finger-sized hit area around small dots
      minZoom: 12,
      maxZoom: 19,
    }).setView([focus.lat, focus.lon], focus.zoom)
    m.attributionControl.setPrefix(false)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    const emit = () => {
      const b = m.getBounds()
      const c = m.getCenter()
      handlers.current.onView({ lat: c.lat, lon: c.lng, zoom: m.getZoom(), south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
    }
    m.on('moveend', emit)
    m.on('click', () => handlers.current.onPick(null))
    emit()
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
    // Created once; later moves come through `focus.key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (m && focus.key !== 'start') m.setView([focus.lat, focus.lon], focus.zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.key])

  useEffect(() => {
    const g = layer.current
    if (!g) return
    g.clearLayers()
    const css = getComputedStyle(document.documentElement)
    const v = (name: string) => css.getPropertyValue(name).trim()
    const page = v('--page')
    const r = zoom >= 18 ? 8 : zoom >= 17 ? 6.5 : zoom >= 15 ? 5 : 2.5
    // Sunny dots last, so they stay on top.
    const order = (p: Pin) => (p.id === selected ? 3 : p.sunny ? 2 : p.state ? 1 : 0)
    for (const p of [...pins].sort((a, b) => order(a) - order(b))) {
      const sel = p.id === selected
      L.circleMarker([p.lat, p.lon], {
        radius: sel ? r + 3 : r,
        color: sel ? v('--ink') : p.sunny ? page : v('--muted'),
        weight: sel ? 2.5 : r > 3 ? 1 : 0.5,
        fillColor: p.state ? v(`--st-${p.state}`) : v('--muted'),
        fillOpacity: p.state ? 1 : 0.55,
        bubblingMouseEvents: false,
      })
        .on('click', () => handlers.current.onPick(p.id))
        .addTo(g)
    }
    if (user) {
      L.circleMarker([user.lat, user.lon], { radius: 7, color: page, weight: 3, fillColor: '#2f7de1', fillOpacity: 1, interactive: false }).addTo(g)
    }
  }, [pins, zoom, selected, user])

  return <div ref={box} className="map" />
}
