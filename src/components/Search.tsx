import { useEffect, useState } from 'react'
import type { IndexEntry } from '../api/data'
import { type Address, searchAddress } from '../api/geocode'
import { t } from '../i18n'

export type Pick = { kind: 'address'; lat: number; lon: number } | { kind: 'terrace'; entry: IndexEntry }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Search({ index, onPick, onLocate }: { index: IndexEntry[]; onPick: (p: Pick) => void; onLocate: () => void }) {
  const [q, setQ] = useState('')
  const [addresses, setAddresses] = useState<{ q: string; list: Address[] }>({ q: '', list: [] })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (q.trim().length < 3) return
    const id = setTimeout(() => {
      searchAddress(q).then((list) => setAddresses({ q, list }), () => setAddresses({ q, list: [] }))
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const query = norm(q.trim())
  const terraces = query.length >= 2 ? index.filter((e) => norm(e.name).includes(query)).slice(0, 6) : []
  const addrs = addresses.q === q ? addresses.list : []
  const pick = (p: Pick, label: string) => {
    setQ(label)
    setOpen(false)
    onPick(p)
  }

  return (
    <div className="search">
      <input
        type="search"
        value={q}
        placeholder={t('search')}
        aria-label={t('search')}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <button type="button" className="locate" onClick={onLocate} title={t('myLocation')} aria-label={t('myLocation')}>
        📍<span className="label"> {t('myLocation')}</span>
      </button>
      {open && (terraces.length > 0 || addrs.length > 0) && (
        <ul className="results" role="listbox">
          {terraces.map((e) => (
            <li key={`t${e.id}`}>
              <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick({ kind: 'terrace', entry: e }, e.name)}>
                ☕ {e.name}
              </button>
            </li>
          ))}
          {addrs.map((a) => (
            <li key={a.label}>
              <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick({ kind: 'address', lat: a.lat, lon: a.lon }, a.label)}>
                📍 {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
