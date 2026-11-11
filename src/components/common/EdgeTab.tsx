import type { ReactNode } from 'react'
import { tr } from '@/i18n'

interface EdgeTabProps {
  label: string
  icon: ReactNode
  onClick?: () => void
  /** Tooltip; defaults to the label. */
  title?: string
  /** A count shown under the icon (e.g. active filters); hidden when 0. */
  badge?: number
  /** Highlighted (something is active behind the tab). */
  on?: boolean
  /** Why the tab cannot open yet: the tab is shown muted and disabled, with this reason. */
  waiting?: string
  /** The collapsed card it opens (collapse tabs). */
  controls?: string
  /** Opens a dialog instead of a card. */
  dialog?: boolean
}

/**
 * A vertical tab docked at a screen edge (Analisis, Laporan Operasional): the collapsed form of a card, an opener
 * (Filter), or a card that cannot open yet. Global classes `edge-tab*` (styles/global.css), so a page's own responsive
 * rules can turn the tabs into a horizontal row.
 */
export function EdgeTab({ label, icon, onClick, title, badge, on, waiting, controls, dialog }: EdgeTabProps) {
  const cls = ['card', 'edge-tab', on && 'edge-tab--on', waiting && 'edge-tab--waiting'].filter(Boolean).join(' ')
  return (
    <div className={cls} title={waiting ? `${label} · ${waiting}` : undefined}>
      <button
        type="button"
        className="edge-tab__btn"
        onClick={onClick}
        disabled={!!waiting}
        aria-label={waiting ? `${label} (${waiting})` : undefined}
        aria-controls={controls}
        aria-expanded={controls ? false : undefined}
        aria-haspopup={dialog ? 'dialog' : undefined}
        title={waiting ? undefined : (title ?? label)}
      >
        {icon}
        {!!badge && <span className="edge-tab__badge" aria-label={tr('{0} aktif', badge)}>{badge}</span>}
        <span className="edge-tab__text">{label}</span>
      </button>
    </div>
  )
}
