import { useEffect } from 'react'
import { useUiStore } from '@/stores/uiStore'

/** Mirrors theme + density preferences onto <html> so CSS tokens switch. */
export function ThemeSync() {
  const { theme, density } = useUiStore((s) => s.settings)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.density = density
  }, [theme, density])
  return null
}
