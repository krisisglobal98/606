/* eslint-disable react-refresh/only-export-components -- menu helpers next to their guard component */
/**
 * Menu permissions per role (Settings → Hak Akses Menu). The server sends the menus the user's role may open
 * with the session (`user.menus`) and checks the module APIs against the same list, so hiding a menu here is
 * convenience, not the protection. Menu ids are the ones of server/src/access/menus.ts.
 */
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { Card } from '@/components/common/Card'
import { EmptyState } from '@/components/common/StateView'
import { useAuthStore } from '@/stores/authStore'
import { canOpen, allowedLanding, firstAllowed } from './menus'
import { tr } from '@/i18n'

export * from './menus'

export function useCanOpen(): (id: string) => boolean {
  const user = useAuthStore((s) => s.user)
  return (id: string) => canOpen(user, id)
}

/** Renders the page only when its menu is allowed; otherwise explains why and links to an allowed page. */
export function RequireMenu({ id, children }: { id: string; children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (canOpen(user, id)) return children
  const home = allowedLanding(user, '/beranda')
  return (
    <Card>
      <EmptyState
        title={tr('Menu tidak tersedia untuk peran Anda')}
        message={tr('Administrator mengatur menu yang dapat dibuka setiap peran di Settings → Hak Akses Menu. Hubungi administrator bila Anda memerlukan menu ini.')}
        action={<Link className="btn btn--sm" to={home}>{tr('Buka halaman yang tersedia')}</Link>}
      />
    </Card>
  )
}

/** Index route of a module: its first allowed sub-page. */
export function IndexRedirect({ items }: { items: { id: string; path: string }[] }) {
  const user = useAuthStore((s) => s.user)
  const to = firstAllowed(user, items)
  return to ? <Navigate to={to} replace /> : <RequireMenu id={items[0]!.id}>{null}</RequireMenu>
}
