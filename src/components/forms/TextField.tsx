import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  icon?: ReactNode
  action?: ReactNode
  required?: boolean
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, error, icon, action, required, id, ...rest }, ref) {
  const auto = useId()
  const inputId = id ?? auto
  const errId = `${inputId}-err`
  return (
    <div className="field">
      <label htmlFor={inputId} className="t-label">
        {label}
        {required && <span className="req"> *</span>}
      </label>
      <div className={icon || action ? 'input-wrap' : undefined}>
        {icon}
        <input ref={ref} id={inputId} className="input" aria-invalid={!!error} aria-describedby={error ? errId : undefined} {...rest} />
        {action && <span className="input-action">{action}</span>}
      </div>
      {error && (
        <span id={errId} className="field-error">
          <AlertCircle size={13} aria-hidden />
          {error}
        </span>
      )}
    </div>
  )
})
