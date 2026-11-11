import { Navigate, Outlet, useLocation } from 'react-router'
import { isSessionValid, useAuthStore } from '@/stores/authStore'

export function ProtectedRoute() {
  const valid = useAuthStore(isSessionValid)
  const location = useLocation()
  if (!valid) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function LandingRedirect({ to }: { to: string }) {
  const valid = useAuthStore(isSessionValid)
  return <Navigate to={valid ? to : '/login'} replace />
}
