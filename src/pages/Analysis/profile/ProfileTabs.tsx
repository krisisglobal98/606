import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { formatNumber } from '@/utils/format'
import s from '../Analysis.module.css'

import { periodLabel } from './util'
import { tr } from '@/i18n'

/** Tabs of one profile (Profil Blok, Kartu Kendaraan): a tablist; arrow keys move between tabs. */
export function ProfileTabs<T extends string>({ tabs, value, onChange, label, panelId }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string; panelId: string }) {
  const base = useId()
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const i = tabs.findIndex((t) => t.id === value)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[j]!.id)
    document.getElementById(`${base}-${tabs[j]!.id}`)?.focus()
  }
  return (
    <div className={s.ptabs} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} id={`${base}-${t.id}`} type="button" role="tab" aria-selected={t.id === value} aria-controls={panelId} tabIndex={t.id === value ? 0 : -1} className={s.ptab} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Month of the operational tabs; only months that have data are offered. */
export function PeriodSelect({ periods, value, onChange }: { periods: string[]; value: string | null; onChange: (p: string) => void }) {
  if (!periods.length || !value) return null
  return (
    <label className={s.periodSel}>
      <span>{tr('Periode')}</span>
      <select className="select select--sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {periods.map((p) => (
          <option key={p} value={p}>
            {periodLabel(p)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Header line of an operational tab: title, source note and the period picker. */
export function OpsHead({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.opsHead}>
      <div>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      {children}
    </div>
  )
}

/** Share bar with its percentage, for table cells. */
export function ShareBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className={s.shareBar}>
      <span className={s.shareTrack}>
        <i style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
      </span>
      <b>{formatNumber(pct, 1)}%</b>
    </span>
  )
}

/** Ring chart of shares (largest first); the total sits in the middle. */
export function Donut({ items, center, sub, label }: { items: { label: string; value: number; color: string }[]; center: string; sub: string; label: string }) {
  const total = items.reduce((a, b) => a + b.value, 0)
  const R = 70
  const C = 2 * Math.PI * R
  let off = 0
  return (
    <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={label} className={s.donut}>
      <circle cx="90" cy="90" r={R} fill="none" stroke="var(--line)" strokeWidth="22" />
      {total > 0 &&
        items.map((it) => {
          const len = (it.value / total) * C
          const el = (
            <circle key={it.label} cx="90" cy="90" r={R} fill="none" stroke={it.color} strokeWidth="22" strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)">
              <title>
                {it.label}: {formatNumber((it.value / total) * 100, 1)}%
              </title>
            </circle>
          )
          off += len
          return el
        })}
      <text x="90" y="84" textAnchor="middle" className={s.donutSub}>
        {sub}
      </text>
      <text x="90" y="104" textAnchor="middle" className={s.donutMain}>
        {center}
      </text>
    </svg>
  )
}
