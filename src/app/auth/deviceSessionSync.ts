/**
 * Keeps every tab of this browser on the same signed-in user (rules: stores/deviceSession.ts), and gives the
 * Analisis workspace of this tab to the user who built it.
 */
import { useAnalysisStore } from '@/stores/analysisStore'
import { useAuthStore } from '@/stores/authStore'
import { AUTH_KEY, readStoredSession, sessionChange, WORKSPACE_OWNER_KEY } from '@/stores/deviceSession'

/** The Analisis workspace of this tab starts over when it was built by another user. */
function bindWorkspace(userId: string | null) {
  if (!userId) return
  try {
    const owner = sessionStorage.getItem(WORKSPACE_OWNER_KEY)
    if (owner && owner !== userId) useAnalysisStore.setState(useAnalysisStore.getInitialState(), true)
    sessionStorage.setItem(WORKSPACE_OWNER_KEY, userId)
  } catch {
    // Storage unavailable (private mode quota, blocked): nothing is kept across reloads anyway.
  }
}

bindWorkspace(useAuthStore.getState().user?.id ?? null)
useAuthStore.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) bindWorkspace(s.user?.id ?? null)
})

// `storage` fires in the OTHER tabs when one tab writes the session (sign in, sign out, expiry clean-up).
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage || (e.key !== AUTH_KEY && e.key !== null)) return
  const cur = useAuthStore.getState()
  switch (sessionChange({ token: cur.token, userId: cur.user?.id ?? null }, readStoredSession(e.key === null ? null : e.newValue))) {
    case 'adopt':
      void useAuthStore.persist.rehydrate()
      break
    case 'signed-out':
    case 'switched':
      // A full reload: nothing of the previous session (page state, caches in memory) survives in this tab.
      window.location.reload()
      break
  }
})
