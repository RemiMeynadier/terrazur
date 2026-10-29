import { useState } from 'react'
import { t, type TKey } from '../i18n'
import { type Answer, answeredRecently, record, stats, verdict } from '../lib/feedback'
import { duration, parisMidnight, prettyName } from '../lib/format'
import type { HorizonMeta, Terrace } from '../lib/horizon'
import { STATE_LABEL, sunText } from '../lib/labels'
import { distanceM } from '../lib/places'
import { type SkyNowcast, skyAt } from '../lib/sky'
import { type Outlook, outlook, sunny } from '../lib/status'
import { sunTimes } from '../lib/sun'
import { DayStrip, SkyPlot } from './TerraceCharts'

interface Props {
  terrace: Terrace
  meta: HorizonMeta & { generated: string }
  sky: SkyNowcast
  time: number
  now: number
  user: { lat: number; lon: number } | null
  onClose: () => void
}

// The terrace picked on the map: its name and sun at a glance; tap the name
// for the on-site check, the day strip and the "why".
export function TerraceSheet({ terrace, meta, sky, time, now, user, onClose }: Props) {
  const [open, setOpen] = useState(false)
  const dayStart = parisMidnight(time)
  const o = outlook(time, dayStart, dayStart + 86400, terrace, meta, sky)
  const sunset = sunTimes(dayStart, terrace.lat, terrace.lon)?.set ?? null
  const dist = user ? distanceM(user, terrace) : null
  const line = [
    sunText(o, sunset),
    sunny(o.now) && o.until != null && o.minutes > (o.until - time) / 60 + 5 ? t('totalToday', { d: duration(o.minutes) }) : null,
    dist != null ? `${Math.round(dist / 10) * 10} m` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const maps = `https://www.google.com/maps/search/?api=1&query=${terrace.lat},${terrace.lon}`
  return (
    <section className={`sheet${open ? ' open' : ''}`} aria-label={prettyName(terrace.name || terrace.addr)}>
      <div className="sheet-head">
        <button type="button" className="item" onClick={() => setOpen(!open)} aria-expanded={open}>
          <i className={`dot st-${o.now.state}`} aria-hidden="true" />
          <span className="name">{prettyName(terrace.name || terrace.addr)}</span>
          <span className="line">{line}</span>
        </button>
        <button type="button" className="close" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      {open && (
        <div className="more">
          {Math.abs(time - now) <= 900 ? (
            <Check terrace={terrace} o={o} meta={meta} sky={sky} now={now} user={user} />
          ) : (
            <p className="note">{t('checkOnlyNow')}</p>
          )}
          <p className="note">
            {t(STATE_LABEL[o.now.state])} · {prettyName(terrace.addr)} · <a href={maps} target="_blank" rel="noreferrer">{t('directions')}</a>
          </p>
          <DayStrip outlook={o} dayStart={dayStart} time={time} now={now} />
          <details>
            <summary>{t('why')}</summary>
            <SkyPlot terrace={terrace} meta={meta} dayStart={dayStart} time={time} />
            <p className="note">{t('skyPlotHelp')}</p>
          </details>
        </div>
      )}
    </section>
  )
}

const ANSWERS: [Answer, string, TKey][] = [
  ['sun', '☀️', 'aSun'],
  ['partial', '🌤️', 'aPartial'],
  ['shade', '🌑', 'aShade'],
  ['cloud', '☁️', 'aCloud'],
]

const PREDICTED: Record<string, string> = { sun: '☀️', partial: '🌤️', trees: '🌳', shade: '🌑', cloud: '☁️', night: '🌙' }

// "You're there? Sun or not?" A quick game that also scores the model.
function Check({ terrace, o, meta, sky, now, user }: { terrace: Terrace; o: Outlook; meta: HorizonMeta & { generated: string }; sky: SkyNowcast; now: number; user: { lat: number; lon: number } | null }) {
  const [given, setGiven] = useState<Answer | null>(() => answeredRecently(terrace.id, now))
  if (given) {
    const v = verdict(given, o.now.state)
    const st = stats()
    return (
      <div className={`check done v-${v}`}>
        <p className="verdict">
          <span className="pop" aria-hidden="true">{v === 'right' ? '🎯' : v === 'close' ? '👌' : '🙈'}</span>
          {t(v === 'right' ? 'vRight' : v === 'close' ? 'vClose' : 'vWrong', { p: PREDICTED[o.now.state] ?? '' })}
        </p>
        <p className="note">
          {t('myScore', { n: st.checks, r: st.right })}{' '}
          <button type="button" className="link" onClick={() => setGiven(null)}>
            {t('changeAnswer')}
          </button>
        </p>
      </div>
    )
  }
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
      <div className="answers">
        {ANSWERS.map(([a, emoji, k]) => (
          <button key={a} type="button" onClick={() => answer(a)}>
            <span className="emoji" aria-hidden="true">{emoji}</span>
            <span>{t(k)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
