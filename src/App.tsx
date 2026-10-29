import { useEffect, useMemo, useState } from 'react'
import { fetchCell, fetchIndex, fetchLinks } from './api/data'
import { fetchSatellite } from './api/satellite'
import { fetchWeather, rainBetween } from './api/weather'
import { type Focus, type Pin, TerraceMap, type View } from './components/TerraceMap'
import { TerraceSheet } from './components/TerraceSheet'
import { getLang, type Lang, setLang, t, tList } from './i18n'
import { flush } from './lib/feedback'
import { clearAround, satMotion, type SkyNowcast } from './lib/sky'
import { STEP, statusAt, sunny } from './lib/status'
import { sunPosition } from './lib/sun'
import { useAsync, useNow } from './lib/useAsync'
import { icon } from './lib/weatherIcon'

const VIEW_KEY = 'tz.view'
const DETAIL_ZOOM = 15 // from here on, each terrace's sun is computed
const MAX_CELLS = 40
const HOURS = [0, 1, 2, 3, 4]

// Where the map opens: the last place seen, else central Paris.
function startFocus(): Focus {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom)) return { ...v, key: 'start' }
  } catch {
    // No storage: default view.
  }
  return { lat: 48.8545, lon: 2.3445, zoom: 16, key: 'start' }
}

// Shareable link to one terrace: ?v=<id>
const linkedTerrace = () => Number(new URLSearchParams(location.search).get('v')) || null

const within = (p: { lat: number; lon: number }, v: View, pad: number) => {
  const dLat = (v.north - v.south) * pad
  const dLon = (v.east - v.west) * pad
  return p.lat >= v.south - dLat && p.lat <= v.north + dLat && p.lon >= v.west - dLon && p.lon <= v.east + dLon
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(getLang)
  const now = Math.floor(useNow(60_000) / 1000)
  const [hours, setHours] = useState(0)
  const [view, setView] = useState<View | null>(null)
  const [selected, setSelected] = useState<number | null>(linkedTerrace)
  const [start] = useState(startFocus)
  const [jump, setJump] = useState<Focus | null>(null)
  const [user, setUser] = useState<{ lat: number; lon: number } | null>(null)
  const [locating, setLocating] = useState<'idle' | 'busy' | 'denied'>('idle')

  const toggleLang = () => {
    const next = lang === 'en' ? 'fr' : 'en'
    setLang(next)
    setLangState(next)
  }
  useEffect(() => void flush(), [])

  const index = useAsync('index', fetchIndex)
  const links = useAsync('links', fetchLinks)
  const linked = useMemo(() => {
    const id = linkedTerrace()
    return id ? (index.value?.terraces.find((e) => e.id === id) ?? null) : null
  }, [index.value])
  const focus = jump ?? (linked ? { lat: linked.lat, lon: linked.lon, zoom: 18, key: `v${linked.id}` } : start)

  useEffect(() => {
    document.documentElement.lang = lang
    const q = new URLSearchParams({ lang })
    if (selected) q.set('v', String(selected))
    history.replaceState(null, '', `${location.pathname}?${q}`)
  }, [lang, selected])

  const onView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: v.lat, lon: v.lon, zoom: v.zoom }))
    } catch {
      // Not remembered, that's all.
    }
  }

  // Terraces around the view; their horizons come by 500 m cells, nearest first.
  const inView = useMemo(() => (index.value && view ? index.value.terraces.filter((e) => within(e, view, 0.15)) : []), [index.value, view])
  const detailed = view != null && view.zoom >= DETAIL_ZOOM
  const cellIds = useMemo(() => {
    if (!view) return []
    const d = new Map<string, number>()
    if (detailed) for (const e of inView) d.set(e.cell, Math.min(d.get(e.cell) ?? Infinity, Math.hypot(e.lat - view.lat, (e.lon - view.lon) * 0.66)))
    const ids = [...d].sort((a, b) => a[1] - b[1]).slice(0, MAX_CELLS).map(([c]) => c)
    const sel = selected != null ? index.value?.terraces.find((e) => e.id === selected) : null
    if (sel && !ids.includes(sel.cell)) ids.push(sel.cell)
    return ids.sort()
  }, [view, detailed, inView, selected, index.value])
  const cells = useAsync(cellIds.length ? `cells|${cellIds.join(',')}` : null, () => Promise.all(cellIds.map(fetchCell)).then((c) => c.flat()))

  // The sky around the map's centre (rounded so that small moves share it).
  const snap = (v: number, step: number) => Math.round(v / step) * step
  const centre = view ?? start
  const wLat = snap(centre.lat, 0.02)
  const wLon = snap(centre.lon, 0.03)
  const weather = useAsync(`w|${wLat},${wLon}|${Math.floor(now / 900)}`, () => fetchWeather(wLat, wLon))
  const sLat = snap(centre.lat, 0.1)
  const sLon = snap(centre.lon, 0.1)
  const sat = useAsync(`s|${sLat},${sLon}|${Math.floor(now / 300)}`, () => fetchSatellite(sLat, sLon))
  const sky: SkyNowcast = useMemo(
    () => ({ sat: sat.value, motion: sat.value ? satMotion(sat.value) : null, weather: weather.value }),
    [sat.value, weather.value],
  )

  const time = Math.floor((now + hours * 3600) / STEP) * STEP

  const pins: Pin[] = useMemo(() => {
    if (!index.value) return []
    const status = new Map<number, Pin>()
    if (detailed && view) {
      for (const tr of cells.value ?? []) {
        if (!within(tr, view, 0.15)) continue
        const s = statusAt(time, tr, index.value.meta, sky)
        status.set(tr.id, { id: tr.id, lat: tr.lat, lon: tr.lon, state: s.state, sunny: sunny(s) })
      }
    }
    return inView.map((e) => status.get(e.id) ?? { id: e.id, lat: e.lat, lon: e.lon, state: null, sunny: false })
  }, [index.value, detailed, view, cells.value, inView, time, sky])

  const terrace = selected != null ? (cells.value ?? []).find((tr) => tr.id === selected) : undefined

  const locate = () => {
    setLocating('busy')
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLocating('idle')
        const here = { lat: p.coords.latitude, lon: p.coords.longitude }
        setUser(here)
        setJump({ ...here, zoom: 17, key: `me${Date.now()}` })
      },
      () => setLocating('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Weather symbol for each time button, at the map's centre.
  const symbol = (h: number) => {
    const tt = now + h * 3600
    const day = sunPosition(tt, centre.lat, centre.lon).el > 0
    const rain = sky.weather ? rainBetween(sky.weather, tt - 450, tt + 450) : 0
    return sky.weather || sky.sat ? icon(clearAround(sky, tt, centre.lat, centre.lon), rain, day) : '·'
  }

  const sunnyCount = pins.filter((p) => p.sunny).length
  const hint = !index.value
    ? index.error
      ? t('error', { msg: index.error })
      : t('loading')
    : !detailed
      ? t('zoomIn')
      : cells.loading && !cells.value
        ? t('loading')
        : locating === 'denied'
          ? t('geoDenied')
          : null

  return (
    <div className="app">
      <header className="bar">
        <div className="top">
          <span className="brand">Terrazur</span>
          <button type="button" className="lang" onClick={toggleLang} aria-label={t('switchLang')}>
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>
        </div>
        <div className="hours-pick" role="group" aria-label={t('when')}>
          {HOURS.map((h) => (
            <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>
              <span className="i" aria-hidden="true">{symbol(h)}</span>
              <span>{h === 0 ? t('now') : `+${h} h`}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="stage">
        <TerraceMap pins={pins} zoom={view?.zoom ?? start.zoom} selected={selected} user={user} focus={focus} onView={onView} onPick={setSelected} />
        {hint ? (
          <p className="map-hint">{hint}</p>
        ) : (
          detailed && <p className="map-hint">{t('sunnyNow', { n: sunnyCount })}</p>
        )}
        <button type="button" className="locate" onClick={locate} aria-label={t('aroundMe')} title={t('aroundMe')}>
          {locating === 'busy' ? '…' : '◎'}
        </button>
        {terrace && index.value && (
          <TerraceSheet
            key={terrace.id}
            terrace={terrace}
            meta={index.value.meta}
            sky={sky}
            time={time}
            now={now}
            user={user}
            link={links.value?.[terrace.id] ?? null}
            onClose={() => setSelected(null)}
          />
        )}
      </main>

      <footer className="foot">
        <details>
          <summary>{t('method')}</summary>
          <ul>
            {tList('methodItems').map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        <p>
          {t('data')} : <a href="https://opendata.paris.fr/explore/dataset/terrasses-autorisations/">Ville de Paris</a> ·{' '}
          <a href="https://geoservices.ign.fr/lidarhd">IGN LiDAR HD</a> · <a href="https://view.eumetsat.int/">EUMETSAT</a> ·{' '}
          <a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        </p>
      </footer>
    </div>
  )
}
