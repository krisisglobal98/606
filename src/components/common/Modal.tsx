import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { tr } from '@/i18n'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** `lg`: a wider box (forms with many controls). */
  size?: 'md' | 'lg'
  /** Shown under the title. */
  subtitle?: ReactNode
}

export function Modal({ title, onClose, children, footer, size = 'md', subtitle }: ModalProps) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box${size === 'lg' ? ' modal-box--lg' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="modal-head">
          <span className="modal-title">
            <b className="t-section">{title}</b>
            {subtitle && <small className="t-meta">{subtitle}</small>}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Tutup')}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
