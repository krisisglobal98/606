import type { ReactNode } from 'react'

/** Title row for each Data page (the module h1 "Data" sits above the lifecycle nav). */
/** Without a title and description it is just the action row, aligned right. */
export function PageHeader({ title, description, actions }: { title?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header style={{ display: 'flex', justifyContent: title ? 'space-between' : 'flex-end', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
      {title && (
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</h2>
          {description && <p style={{ color: 'var(--muted)', marginTop: 2, maxWidth: 760 }}>{description}</p>}
        </div>
      )}
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </header>
  )
}
