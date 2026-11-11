import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  padded?: boolean
  as?: 'section' | 'div' | 'aside'
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card({ title, subtitle, actions, padded = true, as: Tag = 'section', className, children, ...rest }, ref) {
  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={['card', padded && 'card-pad', className].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="t-section">{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  )
})
