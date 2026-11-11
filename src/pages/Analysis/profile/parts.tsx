import type { ReactNode } from 'react'
import { Skeleton } from '@/components/common/StateView'
import { formatDate } from '@/utils/format'
import s from '../Analysis.module.css'
import { tr } from '@/i18n'

/** Labelled values in two columns; empty values read "–". */
export function Facts({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section className={s.facts} aria-label={title}>
      <h3>{title}</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v === null || v === undefined || v === '' ? <span className={s.factNone}>–</span> : v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function Tile({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: 'warning' | 'danger' }) {
  return (
    <div className={`${s.ptile}${tone ? ` ${s[`ptile_${tone}`]}` : ''}`}>
      <small>{label}</small>
      <b>
        {value ?? tr('–')}
        {unit && value !== null && value !== undefined && <em> {unit}</em>}
      </b>
      {sub && <span>{sub}</span>}
    </div>
  )
}

export function Meta({ remark, validFrom, updatedAt }: { remark: string | null; validFrom: string | null; updatedAt: string | null }) {
  if (!remark && !validFrom && !updatedAt) return null
  return (
    <p className={s.profileMeta}>
      {remark && <span>{tr('Catatan:')}{' '}{remark}</span>}
      {validFrom && <span>{tr('Berlaku sejak')}{' '}{formatDate(validFrom)}</span>}
      {updatedAt && <span>{tr('Diperbarui')}{' '}{formatDate(updatedAt)}</span>}
    </p>
  )
}

export function ProfileSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden>
      <Skeleton h={44} />
      <div className={s.ptiles}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} h={72} />
        ))}
      </div>
      <Skeleton h={180} />
    </div>
  )
}
