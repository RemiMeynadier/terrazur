import { useEffect, useState } from 'react'

// Runs `fn` whenever `key` changes (null = idle). Results are tagged with
// the key they belong to, so stale responses never show and "loading" is
// derived rather than stored. Keys of the form "group|version" keep showing
// the previous version of the same group while the next one loads (periodic
// refreshes without flicker).
export function useAsync<T>(key: string | null, fn: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; value: T | null; error: string | null } | null>(null)

  useEffect(() => {
    if (key == null) return
    let cancelled = false
    fn().then(
      (value) => !cancelled && setState({ key, value, error: null }),
      (e) => !cancelled && setState({ key, value: null, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      cancelled = true
    }
    // `fn` is recreated every render; `key` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const group = (k: string) => k.split('|')[0]
  const current = key != null && state?.key === key ? state : null
  const previous = key != null && state && group(state.key) === group(key) ? state : null
  return {
    value: current?.value ?? previous?.value ?? null,
    error: current?.error ?? null,
    loading: key != null && !current,
  }
}

// Current time, ticking every `ms`.
export function useNow(ms: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
