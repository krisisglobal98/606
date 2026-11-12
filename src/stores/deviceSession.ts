/**
 * One device, one signed-in user. The session is kept in localStorage (AUTH_KEY), which every tab of the browser
 * shares, while each tab also holds it in memory. These pure rules keep the tabs in step (wired in
 * app/auth/deviceSessionSync.ts) and stop a second user from signing in next to the first one:
 *
 * - another tab signs out                      → this tab signs out too;
 * - another tab signs in as a DIFFERENT user   → this tab reloads as that user (nothing of the previous user stays);
 * - the same user signs in again in the browser, or this tab was signed out → this tab takes over that session;
 * - signing in as user B while user A is signed in on this device is refused: A must sign out first.
 *
 * Other browsers on the same device do not share this storage: the server enforces the same rule by client address
 * (server/src/auth/authService.ts, DEVICE_IN_USE). "Sign that account out and sign in" (takeOver) ends A's sessions
 * on this browser and on the device, then signs B in.
 *
 * The Analisis workspace (sessionStorage, per tab) belongs to the user who built it: it starts over for another user.
 */
export const AUTH_KEY = 'dod.auth'
export const WORKSPACE_OWNER_KEY = 'dod.analysis.owner'

export interface StoredSession {
  token: string
  expiresAt: string
  user: { id: string; username: string; name: string }
}

/** The signed-in session in the stored value, or null (absent, unreadable, signed out or expired). */
export function readStoredSession(raw: string | null, now = Date.now()): StoredSession | null {
  if (!raw) return null
  try {
    const s = (JSON.parse(raw) as { state?: Partial<StoredSession> }).state
    if (!s?.token || !s.expiresAt || !s.user?.id) return null
    if (!(new Date(s.expiresAt).getTime() > now)) return null
    return { token: s.token, expiresAt: s.expiresAt, user: { id: s.user.id, username: s.user.username ?? '', name: s.user.name ?? '' } }
  } catch {
    return null
  }
}

export type SessionChange = 'none' | 'adopt' | 'signed-out' | 'switched'

/** What this tab does when the stored session changes in another tab. */
export function sessionChange(current: { token: string | null; userId: string | null }, next: StoredSession | null): SessionChange {
  if (!next) return current.token ? 'signed-out' : 'none'
  if (!current.token || !current.userId) return 'adopt'
  if (next.user.id !== current.userId) return 'switched'
  return next.token === current.token ? 'none' : 'adopt'
}

/** The user already signed in on this device when `username` tries to sign in, or null when that is allowed. */
export function deviceHolder(stored: StoredSession | null, username: string): StoredSession['user'] | null {
  if (!stored) return null
  return stored.user.username.trim().toLowerCase() === username.trim().toLowerCase() ? null : stored.user
}

export const deviceInUseMessage = (holder: { name: string; username: string }) =>
  `Perangkat ini sedang dipakai oleh ${holder.name || holder.username} (${holder.username}). Keluarkan akun tersebut dari perangkat ini sebelum masuk dengan akun lain.`
