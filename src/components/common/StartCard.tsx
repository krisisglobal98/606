import type { ReactNode } from 'react'
import s from './StartCard.module.css'

/**
 * The body of a page before anything is chosen (Analisis, Laporan Operasional): an icon, a title and what to do,
 * followed by the page's own choices (`children`; a direct `<p>` child is the explanation).
 */
export function StartCard({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <section className={`card ${s.start}`} aria-labelledby={id}>
      <span className={s.icon} aria-hidden>
        {icon}
      </span>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  )
}
