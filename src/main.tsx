import '@/config/zod'
import '@/app/legacyStorage'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import '@fontsource-variable/plus-jakarta-sans'
import './styles/tokens.css'
import './styles/global.css'
import './styles/data.css'
import { router } from '@/app/router'
import { ThemeSync } from '@/app/ThemeSync'
import { Toaster } from '@/components/common/Toaster'
import { LoadingState } from '@/components/common/StateView'
import '@/stores/authStore'
import { tr } from '@/i18n'

function bootstrap() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeSync />
      <Suspense fallback={<LoadingState label={tr('Memuat Daily Operation Discovery…')} height={400} />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster />
    </StrictMode>,
  )
}

bootstrap()

// DOD Minimal has no service worker (the offline app shell existed for the removed GIS maps). A browser that still
// has the earlier one for this address drops it and its caches, so it always loads the current build.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .then(() => ('caches' in window ? caches.keys() : []))
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dod-shell')).map((k) => caches.delete(k))))
    .catch(() => undefined)
}
