/**
 * One status vocabulary for the whole application. Every status renders an icon + a label;
 * the tone only reinforces it (never colour alone).
 */
import type { ReactNode } from 'react'
import { Ban, Check, Circle, CircleDashed, CircleSlash, Clock, Lock, Minus, Pause, TriangleAlert, X } from 'lucide-react'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface StatusMeta {
  label: string
  tone: Tone
  icon: ReactNode
}

const I = { size: 12, strokeWidth: 2.6, 'aria-hidden': true } as const
export const ICON = {
  check: <Check {...I} />,
  x: <X {...I} />,
  warn: <TriangleAlert {...I} />,
  pending: <Circle {...I} />,
  waiting: <Clock {...I} />,
  blocked: <Lock {...I} />,
  skipped: <Minus {...I} />,
  paused: <Pause {...I} />,
  off: <CircleSlash {...I} />,
  dashed: <CircleDashed {...I} />,
  ban: <Ban {...I} />,
  live: <span className="pulse-dot" aria-hidden />,
}
