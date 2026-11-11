interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hideLabel?: boolean
}

export function Switch({ checked, onChange, label, hideLabel }: SwitchProps) {
  return (
    <label className="switch-label">
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={hideLabel ? label : undefined} onClick={() => onChange(!checked)} />
      {!hideLabel && <span onClick={() => onChange(!checked)}>{label}</span>}
    </label>
  )
}
