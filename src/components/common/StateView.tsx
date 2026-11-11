import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react'
import { beginLoading } from '@/stores/loadingStore'
import { Button } from './Button'
import { tr } from '@/i18n'

export function LoadingState({ label = tr('Memuat data…'), height }: { label?: string; height?: number }) {
  // Page-level waits (lazy pages, Suspense) also drive the global loading indicator.
  useEffect(() => beginLoading(label), [label])
  return (
    <div className="state" style={{ minHeight: height }} role="status" aria-live="polite">
      <Loader2 size={22} className="spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, message, action, height }: { title: string; message?: ReactNode; action?: ReactNode; height?: number }) {
  return (
    <div className="state" style={{ minHeight: height }}>
      <Inbox size={26} aria-hidden />
      <b>{title}</b>
      {message && <p>{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry, height, title = tr('Data gagal dimuat'), action }: { message: string; onRetry?: () => void; height?: number; title?: string; action?: ReactNode }) {
  return (
    <div className="state state--error" style={{ minHeight: height }} role="alert">
      <AlertTriangle size={24} aria-hidden />
      <b>{title}</b>
      <p>{message}</p>
      {(onRetry || action) && (
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {onRetry && (
            <Button size="sm" icon={<RotateCw size={14} />} onClick={onRetry}>
              {tr('Coba lagi')}
            </Button>
          )}
          {action}
        </span>
      )}
    </div>
  )
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} aria-hidden />
}
