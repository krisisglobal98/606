import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ApiError, configureApiClient } from '@/services/api/apiClient'
import { authService } from '@/services/auth/authService'
import { resetSessionCaches } from '@/services/session/sessionCaches'
import type { LoginRequest, User } from '@/types/contracts'
import { AUTH_KEY, deviceHolder, deviceInUseMessage, readStoredSession } from './deviceSession'

interface AuthState {
  token: string | null
  expiresAt: string | null
  user: User | null
  login: (req: LoginRequest) => Promise<User>
  logout: () => Promise<void>
  /** Reloads the signed-in user (role, menu permissions) from the server. */
  refresh: () => Promise<void>
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      expiresAt: null,
      user: null,
      login: async (req) => {
        // One device, one user: another user signed in on this browser (e.g. in another tab) must sign out first;
        // with takeOver they are signed out here. The server checks the other browsers of the device.
        const holder = deviceHolder(readStoredSession(localStorage.getItem(AUTH_KEY)), req.username)
        if (holder && !req.takeOver) throw new ApiError(409, 'DEVICE_IN_USE', deviceInUseMessage(holder))
        if (holder) {
          await useAuthStore.persist.rehydrate()
          await get().logout()
        }
        const s = await authService.login(req)
        set({ token: s.token, expiresAt: s.expiresAt, user: s.user })
        return s.user
      },
      logout: async () => {
        try {
          if (get().token) await authService.logout()
        } finally {
          get().clear()
        }
      },
      refresh: async () => {
        if (!get().token) return
        const user = await authService.me()
        if (get().token) set({ user })
      },
      clear: () => set({ token: null, expiresAt: null, user: null }),
    }),
    { name: AUTH_KEY, partialize: (s) => ({ token: s.token, expiresAt: s.expiresAt, user: s.user }) },
  ),
)

// Caches of what the signed-in user may see are dropped on every change of session or user.
useAuthStore.subscribe((s, prev) => {
  if (s.token !== prev.token || s.user?.id !== prev.user?.id) resetSessionCaches()
})

export const isSessionValid = (s: Pick<AuthState, 'token' | 'expiresAt'>) =>
  !!s.token && !!s.expiresAt && new Date(s.expiresAt).getTime() > Date.now()

configureApiClient({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => useAuthStore.getState().clear(),
})
