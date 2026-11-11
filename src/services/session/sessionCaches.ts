/**
 * Browser caches whose content depends on WHO is signed in (catalog with access status and coverage, filter values
 * of the user's scope). Each registers a reset here; the auth store calls `resetSessionCaches()` whenever the token
 * or the user changes (login, logout, expired session), so nothing of one user is shown to the next one in this tab.
 */
const resets = new Set<() => void>()

export function onSessionReset(reset: () => void) {
  resets.add(reset)
}

export function resetSessionCaches() {
  for (const r of resets) r()
}
