import { useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import type { Engine } from '@/semantic/measureEngine'
import { DEFAULT_RULES, useGridPrefs, type FormatRule, type RuleOp, type RuleStyle } from '@/stores/gridPrefsStore'
import g from './PivotGrid.module.css'
import { tr } from '@/i18n'

const STYLE_LABEL: Record<RuleStyle, string> = {
  positive: tr('Latar hijau (baik)'),
  warning: tr('Latar kuning (perhatian)'),
  negative: tr('Latar merah (buruk)'),
  'text-positive': tr('Teks hijau'),
  'text-negative': tr('Teks merah'),
}
const OPS: RuleOp[] = ['<', '<=', '>', '>=', '=']

/**
 * Conditional-format rules for Tabel Hasil. Rules are checked top to bottom; the first match styles the
 * cell. They apply to raw, derived and calculated measures alike, by column or by group of columns.
 */
export function FormatRulesModal({ columns, onClose }: { engine: Engine; columns: { key: string; label: string }[]; onClose: () => void }) {
  const saved = useGridPrefs((st) => st.rules)
  const setRules = useGridPrefs((st) => st.setRules)
  const [rules, setDraft] = useState<FormatRule[]>(saved)
  const targets = [
    { key: '*%', label: tr('Semua rasio % dataset (mis. Achievement)') },
    { key: '*growth', label: tr('Semua kolom Growth') },
    ...columns,
  ]
  const patch = (i: number, p: Partial<FormatRule>) => setDraft(rules.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <Modal
      title={tr('Aturan Format Kondisi')}
      onClose={onClose}
      footer={
        <>
          <Button icon={<RotateCcw size={13} aria-hidden />} onClick={() => setDraft(DEFAULT_RULES)}>
            {tr('Aturan bawaan')}
          </Button>
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setRules(rules.filter((r) => Number.isFinite(r.value)))
              onClose()
            }}
          >
            {tr('Simpan')}
          </Button>
        </>
      }
    >
      <p className="t-meta" style={{ marginBottom: 10 }}>{tr('Aturan diperiksa dari atas ke bawah; aturan pertama yang cocok mewarnai sel.')}</p>
      <div className={g.rules}>
        {rules.map((r, i) => (
          <div key={r.id} className={g.rule}>
            <select className="select select--sm" value={r.target} onChange={(e) => patch(i, { target: e.target.value })} aria-label={tr('Kolom')}>
              {targets.map((tg) => (
                <option key={tg.key} value={tg.key}>
                  {tg.label}
                </option>
              ))}
              {!targets.some((tg) => tg.key === r.target) && <option value={r.target}>{tr('(kolom tidak tampil)')}</option>}
            </select>
            <select className="select select--sm" value={r.op} onChange={(e) => patch(i, { op: e.target.value as RuleOp })} aria-label={tr('Operator')} style={{ width: 64 }}>
              {OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <input className="input" type="number" value={Number.isFinite(r.value) ? r.value : ''} onChange={(e) => patch(i, { value: e.target.valueAsNumber })} aria-label={tr('Nilai')} style={{ width: 90, height: 30 }} />
            <select className="select select--sm" value={r.style} onChange={(e) => patch(i, { style: e.target.value as RuleStyle })} aria-label={tr('Gaya')}>
              {(Object.keys(STYLE_LABEL) as RuleStyle[]).map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" onClick={() => setDraft(rules.filter((_, j) => j !== i))} aria-label={tr('Hapus aturan')}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!rules.length && <p className="t-meta">{tr('Belum ada aturan.')}</p>}
      </div>
      <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden />} style={{ marginTop: 8 }} onClick={() => setDraft([...rules, { id: `r${Date.now().toString(36)}`, target: columns[0]?.key ?? '*%', op: '<', value: 0, style: 'text-negative' }])}>
        {tr('Tambah aturan')}
      </Button>
    </Modal>
  )
}
