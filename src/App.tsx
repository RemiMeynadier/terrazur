import { useEffect, useMemo, useState } from 'react'
import { fetchCell, fetchIndex } from './api/data'
import { fetchSatellite } from './api/satellite'
import { fetchWeather } from './api/weather'
import { SkyPanel } from './components/SkyPanel'
import { type Pick, Search } from './components/Search'
import { TerraceDetail } from './components/TerraceDetail'
import { STATE_LABEL, sunText } from './lib/labels'
import { DETAIL_ZOOM, type MapTerrace, TerraceMap, type View } from './components/TerraceMap'
import { getLang, type Lang, setLang, t, tList } from './i18n'
import { clock, dayName, duration, parisMidnight } from './lib/format'
import type { HorizonMeta, Terrace } from './lib/horizon'
import { satMotion, type SkyNowcast } from './lib/sky'
import { type Outlook, outlook, STEP, sunny } from './lib/status'
import { sunTimes } from './lib/sun'
import { useAsync, useNow } from './lib/useAsync'

const PARIS = { lat: 48.8566, lon: 2.3522 }
const MAX_LIST = 60

function outlooksFor(visible: Terrace[], meta: HorizonMeta | undefined, sky: SkyNowcast, time: number, dayStart: number) {
  const m = new Map<number, Outlook>()
  if (!meta) return m
  for (const tr of visible) m.set(tr.id, outlook(time, dayStart, dayStart + 86400, tr, meta, sky))
  return m
}

// Shareable links: ?lat=&lon=&z=&id=
function initial() {
  const q = new URLSearchParams(location.search)
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  const ok = q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)
  const id = q.get('id')
  return {
    center: ok ? { lat, lon, zoom: Number(q.get('z')) || 17, key: 0 } : { ...PARIS, zoom: 13, key: 0 },
    selected: id != null && id !== '' ? Number(id) : null,
  }
}

export default function App() {
  const [init] = useState(initial)
  const [lang, setLangState] = useState<Lang>(getLang)
  const nowMs = useNow(60_000)
  const now = Math.floor(nowMs / 1000)
  const [view, setView] = useState<View | null>(null)
  const [center, setCenter] = useState(init.center)
  const [selected, setSelected] = useState<number | null>(init.selected)
  const [day, setDay] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null) // seconds since the day's midnight; null = now
  const [onlySunny, setOnlySunny] = useState(false)
  const [geoError, setGeoError] = useState(false)

  const toggleLang = () => {
    const next = lang === 'en' ? 'fr' : 'en'
    setLang(next)
    setLangState(next)
  }
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  useEffect(() => {
    if (!view) return
    const q = new URLSearchParams({ lat: view.lat.toFixed(5), lon: view.lon.toFixed(5), z: String(view.zoom), lang })
    if (selected != null) q.set('id', String(selected))
    history.replaceState(null, '', `${location.pathname}?${q}`)
  }, [view, selected, lang])

  const index = useAsync('index', fetchIndex)
  const meta = index.value?.meta

  // Cells to load: those of the terraces in view, once zoomed in.
  const detailed = view != null && view.zoom >= DETAIL_ZOOM
  const cellIds = useMemo(() => {
    if (!detailed || !index.value || !view) return []
    const ids = new Set<string>()
    for (const e of index.value.terraces) {
      if (e.lat >= view.south && e.lat <= view.north && e.lon >= view.west && e.lon <= view.east) ids.add(e.cell)
    }
    return [...ids].sort()
  }, [detailed, index.value, view])
  const cells = useAsync(cellIds.length ? `cells|${cellIds.join(',')}` : null, () =>
    Promise.all(cellIds.map(fetchCell)).then((c) => c.flat()),
  )

  // Weather and satellite around the view centre.
  // Rounded so that panning the map does not refetch: AROME's grid is 1.3 km,
  // the satellite window ±65 km.
  const at = view ?? PARIS
  const snap = (v: number, step: number) => Math.round(v / step) * step
  const wLat = snap(at.lat, 0.02)
  const wLon = snap(at.lon, 0.03)
  const weather = useAsync(`w|${wLat},${wLon}|${Math.floor(now / 900)}`, () => fetchWeather(wLat, wLon))
  const sLat = snap(at.lat, 0.1)
  const sLon = snap(at.lon, 0.1)
  const sat = useAsync(`s|${sLat},${sLon}|${Math.floor(now / 300)}`, () => fetchSatellite(sLat, sLon))
  const sky: SkyNowcast = useMemo(
    () => ({ sat: sat.value, motion: sat.value ? satMotion(sat.value) : null, weather: weather.value }),
    [sat.value, weather.value],
  )

  // The chosen day and time.
  const dayStart = useMemo(() => parisMidnight(now, day), [now, day])
  const times = sunTimes(dayStart, at.lat, at.lon)
  const defaultTime = day === 0 ? now : times ? Math.max(times.rise, Math.min(times.set, dayStart + 13 * 3600)) : dayStart + 13 * 3600
  const time = chosen != null ? dayStart + chosen : defaultTime
  const time5 = Math.floor(time / STEP) * STEP

  const visible = useMemo(() => {
    if (!cells.value || !view || !detailed) return []
    return cells.value.filter((tr) => tr.lat >= view.south && tr.lat <= view.north && tr.lon >= view.west && tr.lon <= view.east)
  }, [cells.value, view, detailed])

  const indexValue = index.value
  const outlooks = useMemo(() => outlooksFor(visible, indexValue?.meta, sky, time5, dayStart), [visible, indexValue, sky, time5, dayStart])

  const mapTerraces: MapTerrace[] = useMemo(
    () => visible.map((tr) => ({ id: tr.id, lat: tr.lat, lon: tr.lon, name: tr.name, state: outlooks.get(tr.id)?.now.state ?? 'shade' })),
    [visible, outlooks],
  )

  const ranked = useMemo(() => {
    const score = (tr: Terrace) => {
      const o = outlooks.get(tr.id)!
      if (sunny(o.now)) return 1e6 + o.minutes
      if (o.from != null) return 1e5 - (o.from - time5) / 60
      return 0
    }
    const list = visible.filter((tr) => !onlySunny || sunny(outlooks.get(tr.id)!.now))
    return list.sort((a, b) => score(b) - score(a)).slice(0, MAX_LIST)
  }, [visible, outlooks, onlySunny, time5])
  const sunnyCount = visible.filter((tr) => sunny(outlooks.get(tr.id)!.now)).length

  const selectedTerrace = cells.value?.find((tr) => tr.id === selected) ?? null

  const onPick = (p: Pick) => {
    if (p.kind === 'address') setCenter({ lat: p.lat, lon: p.lon, zoom: 17, key: Date.now() })
    else {
      setCenter({ lat: p.entry.lat, lon: p.entry.lon, zoom: 18, key: Date.now() })
      setSelected(p.entry.id)
    }
  }
  const locate = () => {
    setGeoError(false)
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lon: pos.coords.longitude, zoom: 17, key: Date.now() }),
      () => setGeoError(true),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const sliderMin = times ? Math.ceil((times.rise - dayStart) / STEP) * STEP : 6 * 3600
  const sliderMax = times ? Math.floor((times.set - dayStart) / STEP) * STEP : 21 * 3600

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">☀</span>
          <span>Terrazur</span>
        </div>
        <Search index={index.value?.terraces ?? []} onPick={onPick} onLocate={locate} />
        <button type="button" className="lang" onClick={toggleLang} title={t('switchLang')} aria-label={t('switchLang')}>
          <span className={lang === 'fr' ? 'on' : ''}>FR</span>
          <span className={lang === 'en' ? 'on' : ''}>EN</span>
        </button>
      </header>
      <p className="tagline muted">{t('tagline')}</p>
      {geoError && <p className="notice error">{t('geoDenied')}</p>}
      {index.error && <p className="notice error">{t('error', { msg: index.error })}</p>}

      {day === 0 && (
        <section className="panel">
          <h2>{t('skyTitle')}</h2>
          <SkyPanel sky={sky} lat={at.lat} lon={at.lon} now={now} satError={sat.error} />
        </section>
      )}

      <section className="panel explore">
        <div className="timebar">
          <div className="segmented" role="group" aria-label={t('time')}>
            {[0, 1, 2].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                onClick={() => {
                  setDay(d)
                  setChosen(null)
                }}
              >
                {d === 0 ? t('today') : d === 1 ? t('tomorrow') : dayName(parisMidnight(now, d) + 43200).split(' ')[0]}
              </button>
            ))}
          </div>
          <label className="slider">
            <span>
              <strong>{clock(time)}</strong>
              <span className="muted"> · {dayName(dayStart + 43200)}</span>
            </span>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={STEP}
              value={Math.max(sliderMin, Math.min(sliderMax, time - dayStart))}
              onChange={(e) => setChosen(Number(e.target.value))}
              aria-label={t('time')}
            />
          </label>
          {(chosen != null || day !== 0) && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDay(0)
                setChosen(null)
              }}
            >
              {t('backToNow')}
            </button>
          )}
        </div>

        <div className="explore-grid">
          <TerraceMap
            index={index.value?.terraces ?? []}
            terraces={mapTerraces}
            selected={selected}
            center={center}
            onSelect={setSelected}
            onView={setView}
          />
          <div className="side">
            {selectedTerrace && meta && outlooks.get(selectedTerrace.id) ? (
              <TerraceDetail
                terrace={selectedTerrace}
                meta={meta}
                outlook={outlooks.get(selectedTerrace.id)!}
                dayStart={dayStart}
                time={time}
                now={now}
                sunset={times?.set ?? null}
                onClose={() => setSelected(null)}
              />
            ) : (
              <>
                <div className="list-head">
                  <strong>
                    {detailed ? `${t('sunnyNow', { n: sunnyCount })} · ${t('inView', { n: visible.length })}` : ''}
                  </strong>
                  {detailed && (
                    <div className="segmented" role="group">
                      <button type="button" aria-pressed={!onlySunny} onClick={() => setOnlySunny(false)}>{t('showAll')}</button>
                      <button type="button" aria-pressed={onlySunny} onClick={() => setOnlySunny(true)}>{t('onlySunny')}</button>
                    </div>
                  )}
                </div>
                {index.loading && <p className="muted">{t('loading')}</p>}
                {!detailed && index.value && <p className="muted">{t('zoomIn')}</p>}
                {detailed && cells.loading && !cells.value && <p className="muted">{t('loading')}</p>}
                {detailed && cells.value && !visible.length && <p className="muted">{t('noneInView')}</p>}
                <ul className="tlist">
                  {ranked.map((tr) => {
                    const o = outlooks.get(tr.id)!
                    return (
                      <li key={tr.id}>
                        <button type="button" onClick={() => setSelected(tr.id)}>
                          <i className={`swatch st-${o.now.state}`} />
                          <span className="tl-name">{tr.name || tr.addr}</span>
                          <span className="tl-sub muted small">
                            {t(STATE_LABEL[o.now.state])} · {sunText(o, times?.set ?? null)}
                            {sunny(o.now) && o.minutes > 0 ? ` (${duration(o.minutes)})` : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
        <p className="muted small">{t('forecastNote')}</p>
      </section>

      <section className="panel method">
        <details>
          <summary>{t('method')}</summary>
          <ul>
            {tList('methodItems').map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {meta && <p className="muted small">LiDAR · {meta.generated.slice(0, 10)}</p>}
        </details>
      </section>

      <footer className="foot muted small">
        {t('data')}: <a href="https://opendata.paris.fr/explore/dataset/terrasses-autorisations/" target="_blank" rel="noreferrer">Ville de Paris</a> ·{' '}
        <a href="https://geoservices.ign.fr/lidarhd" target="_blank" rel="noreferrer">IGN LiDAR HD</a>, BD TOPO ·{' '}
        <a href="https://view.eumetsat.int/" target="_blank" rel="noreferrer">EUMETSAT</a> ·{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (Météo-France AROME) ·{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </footer>
    </div>
  )
}
