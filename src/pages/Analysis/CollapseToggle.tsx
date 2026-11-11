import { ChevronUp, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { EdgeTab } from '@/components/common/EdgeTab'
import { useAnalysisStore, type Panel } from '@/stores/analysisStore'
import { tr } from '@/i18n'

/** Close control in the header of an open card; the card collapses toward its edge. */
export function CollapseToggle({ panel, label, controls, direction = 'vertical' }: { panel: Panel; label: string; controls: string; direction?: 'vertical' | 'left' | 'right' }) {
  const toggle = useAnalysisStore((st) => st.togglePanel)
  const text = tr('Ciutkan {0}', label)
  return (
    <button type="button" className="icon-btn" onClick={() => toggle(panel)} aria-expanded aria-controls={controls} aria-label={text} title={text}>
      {direction === 'left' ? <PanelLeftClose size={16} /> : direction === 'right' ? <PanelRightClose size={16} /> : <ChevronUp size={16} />}
    </button>
  )
}

/**
 * Collapsed form of an Analisis card (shared EdgeTab): a narrow vertical card docked at the screen edge, showing the
 * card's title. Opening it puts the full card back in its original place in the page.
 */
export function PanelTab({ panel, label, side }: { panel: Panel; label: string; side: 'left' | 'right' }) {
  const toggle = useAnalysisStore((st) => st.togglePanel)
  return (
    <EdgeTab
      label={label}
      icon={side === 'left' ? <PanelLeftOpen size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
      onClick={() => toggle(panel)}
      controls={`panel-${panel}`}
      title={tr('Tampilkan {0}', label)}
    />
  )
}
