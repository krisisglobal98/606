import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Database, SlidersHorizontal } from 'lucide-react'
import { useAnalysisStore } from '@/stores/analysisStore'
import type { Dataset } from '@/types/contracts'
import { formatNumber } from '@/utils/format'
import { CollapseToggle } from './CollapseToggle'
import { DatasetBrowser } from './DatasetBrowser'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

interface Props {
  datasets: Dataset[]
  dataset: Dataset
  sourceRows: number | null
}

/**
 * "Pengaturan Data": the dataset (applies immediately). The value lists that limit the data (formerly here) are in
 * the filter modal with the other filters. The title stays in place; the body scrolls inside the card.
 */
export function DataSettingsPanel({ datasets, dataset, sourceRows }: Props) {
  const [dwOpen, setDwOpen] = useState(false)
  const setDataset = useAnalysisStore((st) => st.setDataset)

  return (
    <section className={`card ${s.pd} ${s.sideCard}`} aria-labelledby="pd-title">
      <h2 id="pd-title" className={s.pdHead}>
        <SlidersHorizontal size={16} aria-hidden />
        {tr('Pengaturan Data')}
        <span className={s.headToggle}>
          <CollapseToggle panel="settings" label={tr('Pengaturan Data')} controls="panel-settings" direction="left" />
        </span>
      </h2>

      <div className={s.sideBody}>
        <div className={s.pdGroup}>
          <h3>{tr('Dataset')}</h3>
          <button type="button" className={s.dwToggle} aria-expanded={dwOpen} aria-controls="dw-list" onClick={() => setDwOpen((o) => !o)}>
            <Database size={15} aria-hidden />
            <b>
              {dataset.label}
              {dataset.category && <small className={s.dwCat}>{[dataset.category.name, dataset.category.sub].filter(Boolean).join(' › ')}</small>}
            </b>
            <small>{dwOpen ? tr('Tutup') : tr('Ganti')}</small>
            {dwOpen ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          </button>
          {dwOpen && <DatasetBrowser datasets={datasets} current={dataset} onPick={setDataset} />}
          <p className={s.dwSource}>
            <span className="badge badge--success">{tr('Data nyata')}</span> {dataset.source?.connectionName} · {dataset.source?.environment}
          </p>
        </div>
      </div>

      <p className={s.pdFoot} aria-live="polite">
        <CheckCircle2 size={13} aria-hidden />
        <span>
          {tr('Perubahan langsung diterapkan')}{sourceRows != null ? tr(' · {0} baris sumber', formatNumber(sourceRows)) : tr('')}
          {tr(' · diagregasi di database sumber')}.
        </span>
      </p>
    </section>
  )
}
