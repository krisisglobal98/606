import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadStatus } from '@/components/charts/ChartContainer'
import { tr } from '@/i18n'

interface Settled<T> {
  /** Request this state belongs to; status is "loading" while it differs from the current request. */
  key: string | null
  data: T | null
  error: string | null
}

/**
 * Fetches through a service whenever `key` changes, cancelling the previous request.
 * Keeps the last successful data while refetching so the UI does not flash.
 */
export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string, debounceMs = 0) {
  const [state, setState] = useState<Settled<T>>({ key: null, data: null, error: null })
  const [nonce, setNonce] = useState(0)
  const fetchRef = useRef(fetcher)
  useEffect(() => {
    fetchRef.current = fetcher
  })
  const requestKey = `${key}#${nonce}`

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetchRef
        .current(ctrl.signal)
        .then((data) => setState({ key: requestKey, data, error: null }))
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return
          setState((s) => ({ ...s, key: requestKey, error: e instanceof Error ? e.message : tr('Terjadi kesalahan.') }))
        })
    }, debounceMs)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [requestKey, debounceMs])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const status: LoadStatus = state.key !== requestKey ? 'loading' : state.error ? 'error' : 'success'
  return { status, data: state.data, error: state.error, reload }
}
