import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { type Answer, answeredRecently, record } from '../lib/feedback'
import { duration, parisMidnight, prettyName } from '../lib/format'
import type { HorizonMeta, Terrace } from '../lib/horizon'
import { STATE_LABEL, sunText } from '../lib/labels'
import { type SkyNowcast, skyAt } from '../lib/sky'
import { type Outlook, outlook, sunny } from '../lib/status'
import { sunTimes } from '../lib/sun'
import { distanceM } from '../lib/places'
import { DayStrip, SkyPlot } from './TerraceCharts'

interface Props {
  terraces: Terrace[]
  loading: boolean
  meta: HorizonMeta & { generated: string }
  sky: SkyNowcast
  time: number
  now: number
  user: { lat: number; lon: number } | null
}

interface Item {
  terrace: Terrace
  o: Outlook
  dist: number | null
}

const SOON = 90 * 60


export function Results({ terraces, loading, meta, sky, time, now, user }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const dayStart = parisMidnight(time)

  const items = useMemo(() => {
    // One line per establishment: its sunniest terrace. The same café often has several
    // terraces, sometimes filed under neighbouring street numbers: same name within 40 m.
    const groups: Item[] = []
    for (const terrace of terraces) {
      const o = outlook(time, dayStart, dayStart + 86400, terrace, meta, sky)
      const item = { terrace, o, dist: user ? distanceM(user, terrace) : null }
      const same = groups.findIndex((g) => g.terrace.name === terrace.name && distanceM(g.terrace, terrace) < 40)
      const rank = (x: Outlook) => (sunny(x.now) ? 1e6 : 0) + x.minutes
      if (same < 0) groups.push(item)
      else if (rank(o) > rank(groups[same].o)) groups[same] = item
    }
    return groups
  }, [terraces, meta, sky, time, dayStart, user])

  if (loading) return <p className="note">{t('loading')}</p>
  if (!terraces.length) return <p className="note">{t('noneHere')}</p>

  const sunnyNow = items.filter((i) => sunny(i.o.now)).sort((a, b) => b.o.minutes - a.o.minutes || (a.dist ?? 0) - (b.dist ?? 0))
  const soon = items
    .filter((i) => !sunny(i.o.now) && i.o.from != null && i.o.from - time <= SOON)
    .sort((a, b) => a.o.from! - b.o.from!)
  const shown = more ? sunnyNow : sunnyNow.slice(0, 10)

  const row = (i: Item) => (
    <Row key={i.terrace.id} item={i} open={open === i.terrace.id} onToggle={() => setOpen(open === i.terrace.id ? null : i.terrace.id)} {...{ meta, sky, time, now, dayStart, user }} />
  )

  return (
    <>
      {sunnyNow.length > 0 ? (
        <>
          <p className="count">{t('nSunny', { n: sunnyNow.length, total: items.length })}</p>
          <ul className="items">{shown.map(row)}</ul>
          {sunnyNow.length > shown.length && (
            <button type="button" className="link" onClick={() => setMore(true)}>
              {t('showMore', { n: sunnyNow.length - shown.length })}
            </button>
          )}
        </>
      ) : (
        <p className="note">{t('noneSunny')}</p>
      )}
      {soon.length > 0 && (
        <>
          <h3>{t('soon')}</h3>
          <ul className="items">{soon.slice(0, 6).map(row)}</ul>
        </>
      )}
    </>
  )
}

interface RowProps {
  item: Item
  open: boolean
  onToggle: () => void
  meta: HorizonMeta & { generated: string }
  sky: SkyNowcast
  time: number
  now: number
  dayStart: number
  user: { lat: number; lon: number } | null
}

function Row({ item, open, onToggle, meta, sky, time, now, dayStart, user }: RowProps) {
  const { terrace, o, dist } = item
  const sunset = sunTimes(dayStart, terrace.lat, terrace.lon)?.set ?? null
  const line = [
    sunText(o, sunset),
    sunny(o.now) && o.until != null && o.minutes > (o.until - time) / 60 + 5 ? t('totalToday', { d: duration(o.minutes) }) : null,
    dist != null ? `${Math.round(dist / 10) * 10} m` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const maps = `https://www.google.com/maps/search/?api=1&query=${terrace.lat},${terrace.lon}`
  return (
    <li className={open ? 'open' : ''}>
      <button type="button" className="item" onClick={onToggle} aria-expanded={open}>
        <i className={`dot st-${o.now.state}`} aria-hidden="true" />
        <span className="name">{prettyName(terrace.name || terrace.addr)}</span>
        <span className="line">{line}</span>
      </button>
      {open && (
        <div className="more">
          <p className="note">
            {t(STATE_LABEL[o.now.state])} · {prettyName(terrace.addr)} · <a href={maps} target="_blank" rel="noreferrer">{t('directions')}</a>
          </p>
          <DayStrip outlook={o} dayStart={dayStart} time={time} now={now} />
          {Math.abs(time - now) <= 900 && <Check terrace={terrace} o={o} meta={meta} sky={sky} now={now} user={user} />}
          <details>
            <summary>{t('why')}</summary>
            <SkyPlot terrace={terrace} meta={meta} dayStart={dayStart} time={time} />
            <p className="note">{t('skyPlotHelp')}</p>
          </details>
        </div>
      )}
    </li>
  )
}

const ANSWERS: [Answer, 'aSun' | 'aPartial' | 'aShade' | 'aCloud'][] = [
  ['sun', 'aSun'],
  ['partial', 'aPartial'],
  ['shade', 'aShade'],
  ['cloud', 'aCloud'],
]

// "You're there? Is it in the sun?" Scores the model.
function Check({ terrace, o, meta, sky, now, user }: { terrace: Terrace; o: Outlook; meta: HorizonMeta & { generated: string }; sky: SkyNowcast; now: number; user: { lat: number; lon: number } | null }) {
  const [given, setGiven] = useState<Answer | null>(() => answeredRecently(terrace.id, now))
  if (given) return <p className="check done">{t('thanks')}</p>
  const answer = (a: Answer) => {
    const s = skyAt(sky, now, terrace.lat, terrace.lon)
    record({
      terrace: terrace.id,
      name: terrace.name,
      at: now,
      answer: a,
      predicted: o.now.state,
      share: o.now.share,
      clear: s.clear,
      sat: s.sat,
      model: s.model,
      user,
      data: meta.generated,
    })
    setGiven(a)
  }
  return (
    <div className="check">
      <p>{t('checkQ')}</p>
      <div className="choices">
        {ANSWERS.map(([a, k]) => (
          <button key={a} type="button" onClick={() => answer(a)}>
            {t(k)}
          </button>
        ))}
      </div>
    </div>
  )
}
