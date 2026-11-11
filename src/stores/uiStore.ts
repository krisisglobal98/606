/** UI preferences (theme, density, landing page, chart type) + toasts. Persisted locally so the theme applies before login. */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings } from '@/types/contracts'
import { DEFAULT_SETTINGS } from '@/stores/defaults'

export interface Toast {
  id: number
  message: string
  tone: 'default' | 'success' | 'error'
}

interface UiState {
  settings: Settings
  toasts: Toast[]
  setSettings: (s: Partial<Settings>) => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

let seq = 0

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      toasts: [],
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      toast: (message, tone = 'default') => {
        const id = ++seq
        set({ toasts: [...get().toasts.slice(-2), { id, message, tone }] })
        setTimeout(() => get().dismissToast(id), 3200)
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    }),
    {
      name: 'dod.ui',
      partialize: (s) => ({ settings: s.settings }),
      // v1: the Dashboard menu was replaced by Executive Summary; a saved landing page on it moves along.
      // v2: Beranda became the first page; the previous default moves to it once.
      // v3: the Peta Kebun menu was removed; a landing page on it moves to Beranda.
      // v4: the Executive Summary menu was removed; a landing page on it moves to Beranda.
      version: 4,
      migrate: (persisted, from) => {
        const p = (persisted ?? {}) as { settings?: Partial<Settings> }
        const settings = { ...DEFAULT_SETTINGS, ...p.settings }
        if (from < 1 && settings.landingPage === '/dashboard') settings.landingPage = '/executive-summary'
        if (from < 2 && settings.landingPage === '/executive-summary') settings.landingPage = '/beranda'
        if (settings.landingPage === '/peta-kebun' || settings.landingPage === '/executive-summary') settings.landingPage = '/beranda'
        return { settings }
      },
    },
  ),
)

export const toast = (message: string, tone?: Toast['tone']) => useUiStore.getState().toast(message, tone)
