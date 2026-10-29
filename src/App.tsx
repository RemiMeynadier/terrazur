import { useEffect, useMemo, useState } from 'react'
import { fetchCell, fetchIndex } from './api/data'
import { fetchSatellite } from './api/satellite'
import { fetchWeather } from './api/weather'
import { Results } from './components/Results'
import { Sky } from './components/Sky'
import { WhereInput } from './components/WhereInput'
import { getLang, type Lang, setLang, t, tList } from './i18n'
import { flush } from './lib/feedback'
import { parisMidnight } from './lib/format'
import { centreOf, contains, type Place } from './lib/places'
import { satMotion, type SkyNowcast } from './lib/sky'
import { STEP } from './lib/status'
import { useAsync, useNow } from './lib/useAsync'

const PARIS = { lat: 48.8566, lon: 2.3522 }

type When = { kind: 'now' } | { kind: 'in'; minutes: number } | { kind: 'at'; day: number; minutes: number }

// Shareable links: ?q=<quartier> | ?arr=<n> | ?rue=<street>
function initialWhere(): Place | null {
  const p = new URLSearchParams(location.search)
  if (p.get('q')) return { kind: 'quartier', id: Number(p.get('q')) }
  if (p.get('arr')) return { kind: 'arr', n: Number(p.get('arr')) }
  if (p.get('rue')) return { kind: 'street', name: p.get('rue')! }
  return null
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(getLang)
  const now = Math.floor(useNow(60_000) / 1000)
  const [where, setWhere] = useState<Place | null>(initialWhere)
  const [when, setWhen] = useState<When>({ kind: 'now' })
  const [locating, setLocating] = useState<'idle' | 'busy' | 'denied'>('idle')

  const toggleLang = () => {
    const next = lang === 'en' ? 'fr' : 'en'
    setLang(next)
    setLangState(next)
  }
  useEffect(() => {
    document.documentElement.lang = lang
    const q = new URLSearchParams({ lang })
    if (where?.kind === 'quartier') q.set('q', String(where.id))
    if (where?.kind === 'arr') q.set('arr', String(where.n))
    if (where?.kind === 'street') q.set('rue', where.name)
    history.replaceState(null, '', `${location.pathname}?${q}`)
  }, [lang, where])
  useEffect(() => void flush(), [])

  const index = useAsync('index', fetchIndex)

  const entries = useMemo(
    () => (index.value && where ? index.value.terraces.filter((e) => contains(index.value!, e, where)) : []),
    [index.value, where],
  )
  const cellIds = [...new Set(entries.map((e) => e.cell))].sort()
  const cells = useAsync(cellIds.length ? `cells|${cellIds.join(',')}` : null, () => Promise.all(cellIds.map(fetchCell)).then((c) => c.flat()))
  const terraces = useMemo(() => {
    const ids = new Set(entries.map((e) => e.id))
    return (cells.value ?? []).filter((tr) => ids.has(tr.id))
  }, [cells.value, entries])

  // Sky around the chosen place (rounded so that nearby choices share it).
  const centre = where?.kind === 'here' ? where : centreOf(entries, PARIS)
  const snap = (v: number, step: number) => Math.round(v / step) * step
  const wLat = snap(centre.lat, 0.02)
  const wLon = snap(centre.lon, 0.03)
  const weather = useAsync(where ? `w|${wLat},${wLon}|${Math.floor(now / 900)}` : null, () => fetchWeather(wLat, wLon))
  const sLat = snap(centre.lat, 0.1)
  const sLon = snap(centre.lon, 0.1)
  const sat = useAsync(where ? `s|${sLat},${sLon}|${Math.floor(now / 300)}` : null, () => fetchSatellite(sLat, sLon))
  const sky: SkyNowcast = useMemo(
    () => ({ sat: sat.value, motion: sat.value ? satMotion(sat.value) : null, weather: weather.value }),
    [sat.value, weather.value],
  )

  const time =
    when.kind === 'now' ? now : when.kind === 'in' ? now + when.minutes * 60 : parisMidnight(now, when.day) + when.minutes * 60
  const time5 = Math.floor(time / STEP) * STEP

  const locate = () => {
    setLocating('busy')
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLocating('idle')
        setWhere({ kind: 'here', lat: p.coords.latitude, lon: p.coords.longitude })
      },
      () => setLocating('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="page">
      <header className="top">
        <span className="brand">Terrazur</span>
        <button type="button" className="lang" onClick={toggleLang} aria-label={t('switchLang')}>
          {lang === 'fr' ? 'EN' : 'FR'}
        </button>
      </header>
      <p className="tagline">{t('tagline')}</p>

      <section className="step">
        <h2><span className="n">1</span>{t('where')}</h2>
        {index.value && (
          <WhereInput
            index={index.value}
            where={where}
            lang={lang}
            onPick={setWhere}
            onLocate={locate}
            locating={locating === 'busy'}
          />
        )}
        {locating === 'denied' && <p className="note">{t('geoDenied')}</p>}
        {index.error && <p className="note">{t('error', { msg: index.error })}</p>}
      </section>

      {where && (
        <section className="step">
          <h2><span className="n">2</span>{t('when')}</h2>
          <div className="choices">
            <button type="button" aria-pressed={when.kind === 'now'} onClick={() => setWhen({ kind: 'now' })}>{t('now')}</button>
            {[60, 120].map((m) => (
              <button key={m} type="button" aria-pressed={when.kind === 'in' && when.minutes === m} onClick={() => setWhen({ kind: 'in', minutes: m })}>
                {t('inHours', { n: m / 60 })}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={when.kind === 'at'}
              onClick={() => setWhen({ kind: 'at', day: 0, minutes: Math.min(21 * 60, Math.ceil((now - parisMidnight(now)) / 1800) * 30 + 180) })}
            >
              {t('otherTime')}
            </button>
          </div>
          {when.kind === 'at' && (
            <div className="choices sub">
              <button type="button" aria-pressed={when.day === 0} onClick={() => setWhen({ ...when, day: 0 })}>{t('today')}</button>
              <button type="button" aria-pressed={when.day === 1} onClick={() => setWhen({ ...when, day: 1 })}>{t('tomorrow')}</button>
              <input
                type="time"
                step={300}
                value={`${String(Math.floor(when.minutes / 60)).padStart(2, '0')}:${String(when.minutes % 60).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (Number.isFinite(h) && Number.isFinite(m)) setWhen({ ...when, minutes: h * 60 + m })
                }}
                aria-label={t('time')}
              />
            </div>
          )}
        </section>
      )}

      {where && (
        <section className="step">
          <h2><span className="n">3</span>{t('skyTitle')}</h2>
          <Sky sky={sky} lat={centre.lat} lon={centre.lon} points={entries} time={time5} now={now} satError={sat.error} />
        </section>
      )}

      {where && index.value && (
        <section className="step">
          <h2><span className="n">4</span>{t('terraces')}</h2>
          <Results
            terraces={terraces}
            loading={cells.loading && !cells.value}
            meta={index.value.meta}
            sky={sky}
            time={time5}
            now={now}
            user={where.kind === 'here' ? where : null}
          />
        </section>
      )}

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
          <a href="https://open-meteo.com/">Open-Meteo</a>
        </p>
      </footer>
    </div>
  )
}
