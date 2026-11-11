import type { StatusMeta } from './status'

export function StatusBadge({ meta, label, plain }: { meta: StatusMeta; label?: string; plain?: boolean }) {
  return (
    <span className={`status status--${meta.tone}${plain ? ' status--plain' : ''}`}>
      {meta.icon}
      {label ?? meta.label}
    </span>
  )
}
