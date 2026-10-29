import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { IndexEntry } from '../api/data'
import { t } from '../i18n'
import type { State } from '../lib/status'

export interface MapTerrace {
  id: number
  lat: number
  lon: number
  name: string
  state: State
}

export interface View {
  south: number
  west: number
  north: number
  east: number
  zoom: number
  lat: number
  lon: number
}

// Below this zoom the map only shows where terraces are; above it, their sun.
export const DETAIL_ZOOM = 15

interface Props {
  index: IndexEntry[]
  terraces: MapTerrace[]
  selected: number | null
  center: { lat: number; lon: number; zoom?: number; key: number }
  onSelect: (id: number) => void
  onView: (v: View) => void
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function TerraceMap({ index, terraces, selected, center, onSelect, onView }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const dots = useRef<L.LayerGroup | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const callbacks = useRef({ onSelect, onView })
  useEffect(() => {
    callbacks.current = { onSelect, onView }
  })

  useEffect(() => {
    const m = L.map(el.current!, { preferCanvas: true, zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 19,
      className: 'osm-tiles',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    dots.current = L.layerGroup().addTo(m)
    marks.current = L.layerGroup().addTo(m)
    const report = () => {
      const b = m.getBounds()
      const c = m.getCenter()
      callbacks.current.onView({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(), zoom: m.getZoom(), lat: c.lat, lon: c.lng })
    }
    m.on('moveend', report)
    map.current = m
    m.setView([48.8566, 2.3522], 13)
    report()
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    map.current?.setView([center.lat, center.lon], center.zoom ?? Math.max(DETAIL_ZOOM + 1, map.current.getZoom()))
  }, [center])

  // Zoomed out: every terrace as a small neutral dot.
  useEffect(() => {
    const g = dots.current
    if (!g) return
    g.clearLayers()
    const color = css('--muted')
    for (const e of index) {
      L.circleMarker([e.lat, e.lon], { radius: 2, stroke: false, fillColor: color, fillOpacity: 0.55, interactive: false }).addTo(g)
    }
  }, [index])

  // Zoomed in: coloured by their sun.
  useEffect(() => {
    const g = marks.current
    if (!g) return
    g.clearLayers()
    const surface = css('--surface')
    for (const tr of terraces) {
      const isSel = tr.id === selected
      const marker = L.circleMarker([tr.lat, tr.lon], {
        radius: isSel ? 9 : 6.5,
        color: isSel ? css('--ink') : surface,
        weight: isSel ? 3 : 1.5,
        fillColor: css(`--st-${tr.state}`),
        fillOpacity: 1,
      })
      marker.bindTooltip(tr.name, { direction: 'top', offset: [0, -6] })
      marker.on('click', () => callbacks.current.onSelect(tr.id))
      marker.addTo(g)
    }
  }, [terraces, selected])

  return <div className="map" ref={el} role="region" aria-label={t('inView', { n: terraces.length })} />
}
