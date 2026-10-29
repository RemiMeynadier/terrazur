import { useState } from 'react'
import type { DataIndex } from '../api/data'
import { type Lang, t } from '../i18n'
import { type Place, placeLabel, suggest, suggestionKey } from '../lib/places'

interface Props {
  index: DataIndex
  where: Place | null
  lang: Lang
  onPick: (p: Place) => void
  onLocate: () => void
  locating: boolean
}

// One field for a street, a quartier or an arrondissement; suggestions listed
// right under it (no floating menu), plus "Around me".
export function WhereInput({ index, where, lang, onPick, onLocate, locating }: Props) {
  const fr = lang === 'fr'
  const [text, setText] = useState<string | null>(null) // null: show the chosen place
  const value = text ?? (where ? placeLabel(index, where, fr) : '')
  const list = text ? suggest(index, text, fr) : []

  return (
    <div className="where">
      <div className="choices">
        <input
          type="search"
          value={value}
          placeholder={t('wherePh')}
          aria-label={t('where')}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && list[0]) {
              onPick(list[0].place)
              setText(null)
            }
          }}
        />
        <button type="button" aria-pressed={where?.kind === 'here'} onClick={onLocate}>
          {locating ? t('locating') : t('aroundMe')}
        </button>
      </div>
      {list.length > 0 && (
        <ul className="suggest">
          {list.map((s) => (
            <li key={suggestionKey(s.place)}>
              <button
                type="button"
                onClick={() => {
                  onPick(s.place)
                  setText(null)
                }}
              >
                {s.label}
                {s.hint && <span className="soft"> · {s.place.kind === 'street' ? t('nTerraces', { n: s.hint }) : s.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {text && text.trim().length >= 2 && !list.length && <p className="note">{t('noMatch')}</p>}
    </div>
  )
}
