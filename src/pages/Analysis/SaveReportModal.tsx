import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import { CategorySelect } from '@/components/warehouse/CategorySelect'
import { ApiError } from '@/services/api/apiClient'
import { savedReportService } from '@/services/report/savedReportService'
import { selectSavedLayout, useAnalysisStore } from '@/stores/analysisStore'
import { selectCalc, useGridPrefs } from '@/stores/gridPrefsStore'
import { toast } from '@/stores/uiStore'
import { tr } from '@/i18n'

/**
 * Simpan Laporan: stores the current Analysis layout under a name and a master category. When the workspace was opened
 * from a saved report (Laporan → Ubah di Analisis), the changes can be saved to that report (same id, links keep
 * working) or as a new report.
 */
export function SaveReportModal({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const editing = useAnalysisStore((st) => (st.editing && st.editing.datasetId === datasetId ? st.editing : null))
  const [mode, setMode] = useState<'update' | 'new'>(editing ? 'update' : 'new')
  const [name, setName] = useState(editing?.name ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = name.trim().length >= 2 && !!categoryId
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const layout = selectSavedLayout(useAnalysisStore.getState(), selectCalc(datasetId)(useGridPrefs.getState()))
      if (editing && mode === 'update') {
        await savedReportService.update(editing.id, { name: name.trim(), categoryId: categoryId!, layout })
        useAnalysisStore.setState({ editing: { ...editing, name: name.trim(), categoryId } })
        toast(tr('Perubahan disimpan ke laporan "{0}".', name.trim()))
      } else {
        const r = await savedReportService.create({ name: name.trim(), categoryId: categoryId!, datasetId, layout })
        // Further changes go to the new report.
        useAnalysisStore.setState({ editing: { id: r.id, name: r.name, categoryId: r.categoryId, datasetId } })
        toast(tr('Laporan disimpan ke Report → Laporan Operasional.'))
      }
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('Laporan gagal disimpan.'))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={tr('Simpan Laporan')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>{editing && mode === 'update' ? tr('Simpan perubahan') : tr('Simpan')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {editing && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="t-label">{tr('Simpan sebagai')}</legend>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" name="save-mode" checked={mode === 'update'} onChange={() => setMode('update')} />
              {tr('Perubahan pada laporan "{0}"', editing.name)}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" name="save-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
              {tr('Laporan baru')}
            </label>
          </fieldset>
        )}
        <label className="field">
          <span className="t-label">{tr('Nama laporan')}{' '}<span style={{ color: 'var(--danger)' }}>*</span></span>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={tr('mis. Produksi per Kebun')} autoFocus />
        </label>
        <div className="field">
          <label className="t-label" htmlFor="save-report-category">{tr('Kategori')}{' '}<span style={{ color: 'var(--danger)' }}>*</span></label>
          <CategorySelect id="save-report-category" value={categoryId} onChange={setCategoryId} emptyLabel={tr('Pilih kategori')} />
        </div>
        <p className="t-meta">{tr('Yang disimpan: dataset, filter, dimensi, measure, grafik, dan pengaturan tabel. Angkanya dibaca ulang dari sumber saat laporan dibuka.')}</p>
        {error && <div className="callout callout--danger" role="alert"><span>{error}</span></div>}
      </div>
    </Modal>
  )
}
