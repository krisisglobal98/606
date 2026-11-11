import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import { ApiError } from '@/services/api/apiClient'
import { datasetService as analysisCatalog } from '@/services/dataset/datasetService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { toast } from '@/stores/uiStore'
import { tr } from '@/i18n'

/** Confirmation before a dataset is deleted from DOD (the source tables are not touched). */
export function DeleteDatasetModal({ dataset, onClose, onDeleted }: { dataset: { id: string; name: string; connectionName: string }; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      await dataWarehouseService.deleteDataset(dataset.id)
      analysisCatalog.invalidate()
      toast(tr('Dataset "{0}" dihapus.', dataset.name), 'success')
      onDeleted()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Dataset gagal dihapus.'), 'error')
      setBusy(false)
    }
  }
  return (
    <Modal
      title={tr('Hapus dataset?')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void remove()}>{tr('Hapus dataset')}</Button>
        </>
      }
    >
      <p>
        {tr('Dataset')}{' '}<b>{dataset.name}</b>{' '}{tr('beserta pemetaan semantiknya akan dihapus dari DOD dan tidak lagi tersedia di Analisis. Tabel di sumber')}{' '}<b>{dataset.connectionName}</b>{' '}{tr('tidak diubah. Tindakan ini tidak dapat dibatalkan.')}
      </p>
    </Modal>
  )
}
