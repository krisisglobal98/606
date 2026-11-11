import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { configureApiClient } from '@/services/api/apiClient'
import { authService } from '@/services/auth/authService'
import { resetSessionCaches } from '@/services/session/sessionCaches'
import type { LoginRequest, User } from '@/types/contracts'

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
    { name: 'dod.auth', partialize: (s) => ({ token: s.token, expiresAt: s.expiresAt, user: s.user }) },
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
