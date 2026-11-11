import { useEffect, useState } from 'react'
import { CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { DEFAULT_LOADING_LABEL, useLoadingStore } from '@/stores/loadingStore'
import { useUiStore } from '@/stores/uiStore'

/** Waits shorter than this show nothing, so fast responses do not flicker. */
const SHOW_AFTER_MS = 250

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts)
  return (
    <>
      <LoadingBar />
      <div className="toasts" role="status" aria-live="polite">
        <LoadingToast />
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.tone === 'success' ? <CheckCircle2 size={15} /> : t.tone === 'error' ? <XCircle size={15} /> : <Info size={15} />}
            {t.message}
          </div>
        ))}
      </div>
    </>
  )
}

/** True while something has been loading for longer than SHOW_AFTER_MS. */
function useSlowLoading() {
  const busy = useLoadingStore((s) => s.tasks.length > 0)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!busy) {
      // Hide on the next frame, not synchronously, so back-to-back requests read as one.
      const t = setTimeout(() => setShown(false), 120)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [busy])
  return shown
}

/** Thin indeterminate bar at the very top of the window. */
function LoadingBar() {
  const shown = useSlowLoading()
  return <div className={`loading-bar${shown ? ' is-on' : ''}`} aria-hidden="true" />
}

/** Small dark message at the bottom, like the toasts; it never covers the page or takes clicks. */
function LoadingToast() {
  const shown = useSlowLoading()
  const current = useLoadingStore((s) => s.tasks.at(-1)?.label)
  const count = useLoadingStore((s) => s.tasks.length)
  // Keep the last text during the short fade-out after the work ends.
  const [label, setLabel] = useState(DEFAULT_LOADING_LABEL)
  if (current && current !== label) setLabel(current)
  if (!shown) return null
  return (
    // Page regions announce their own loading state; this visual cue stays out of the live region.
    <div className="toast toast--loading" aria-hidden="true">
      <Loader2 size={15} className="spin" aria-hidden />
      <span>{label}</span>
      {count > 1 && <span className="toast__count">{count}</span>}
    </div>
  )
}
