/**
 * Global "something is loading" state for the loading bar and the small loading message. Every API
 * call (apiClient.request) and every page-level loading fallback registers here; the indicator only
 * appears when work takes long enough to notice (see LoadingIndicator).
 */
import { create } from 'zustand'
import { tr } from '@/i18n'

export const DEFAULT_LOADING_LABEL = tr('Memuat data…')

interface LoadingState {
  /** Labels of the running tasks, oldest first; the newest one is shown. */
  tasks: { id: number; label: string }[]
}

let seq = 0

export const useLoadingStore = create<LoadingState>(() => ({ tasks: [] }))

/** Registers a running task; call the returned function when it ends (idempotent). */
export function beginLoading(label: string = DEFAULT_LOADING_LABEL): () => void {
  const id = ++seq
  useLoadingStore.setState((s) => ({ tasks: [...s.tasks, { id, label }] }))
  let done = false
  return () => {
    if (done) return
    done = true
    useLoadingStore.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
  }
}
