import { request, requestJson } from '@/services/api/apiClient'
import { AuthSessionSchema, UserSchema, type AuthSession, type LoginRequest, type User } from '@/types/contracts'

export const authService = {
  login: (body: LoginRequest): Promise<AuthSession> =>
    request('/auth/login', { method: 'POST', body, schema: AuthSessionSchema, public: true }),
  me: (): Promise<User> => request('/auth/me', { schema: UserSchema, silent: true }),
  changePassword: (body: { currentPassword: string; newPassword: string }): Promise<{ otherSessionsEnded: number }> =>
    requestJson('/auth/password', { method: 'POST', body, silent: true }),
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST', public: true }).then(() => undefined),
}
