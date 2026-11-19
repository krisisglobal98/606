/**
 * Minimal .xlsx writer (no dependency): one sheet, header rows with merged cells, numbers kept as numbers with the
 * column's decimals, text as inline strings. The file is a ZIP (stored, no compression) of the SpreadsheetML parts.
 * Pure: builds the bytes; the caller downloads them.
 */

export type XCell = { v: string | number | null; bold?: boolean; header?: boolean; decimals?: number; colSpan?: number; rowSpan?: number } | null

// Control characters are not allowed in XML text: removed on purpose.
// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
/** Column letters of a 0-based index: 0 → A, 26 → AA. */
export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)))

const MAX_DEC = 6
/** Style ids: 0 normal, 1 header, 2 bold text, then per decimals d: 3 + d (normal) and 3 + MAX_DEC + 1 + d (bold). */
const styleOf = (c: Exclude<XCell, null>) => {
  if (c.header) return 1
  if (typeof c.v !== 'number') return c.bold ? 2 : 0
  const d = Math.max(0, Math.min(MAX_DEC, c.decimals ?? 0))
  return (c.bold ? 3 + MAX_DEC + 1 : 3) + d
}

function stylesXml() {
  const fmts = Array.from({ length: MAX_DEC + 1 }, (_, d) => `<numFmt numFmtId="${164 + d}" formatCode="${d ? `#,##0.${'0'.repeat(d)}` : '#,##0'}"/>`).join('')
  const num = (bold: boolean) => Array.from({ length: MAX_DEC + 1 }, (_, d) => `<xf numFmtId="${164 + d}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" applyNumberFormat="1"${bold ? ' applyFont="1"' : ''}/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${MAX_DEC + 1}">${fmts}</numFmts><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB0BCC8"/></left><right style="thin"><color rgb="FFB0BCC8"/></right><top style="thin"><color rgb="FFB0BCC8"/></top><bottom style="thin"><color rgb="FFB0BCC8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${3 + 2 * (MAX_DEC + 1)}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>${num(false)}${num(true)}</cellXfs></styleSheet>`
}

/** Sheet XML of a grid of cells (null = covered by a merge or empty). */
export function sheetXml(rows: XCell[][], opts: { widths?: number[]; freezeRows?: number; freezeCols?: number } = {}): string {
  const merges: string[] = []
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          if (!c) return ''
          const ref = `${colName(i)}${r + 1}`
          if ((c.colSpan ?? 1) > 1 || (c.rowSpan ?? 1) > 1) merges.push(`${ref}:${colName(i + (c.colSpan ?? 1) - 1)}${r + (c.rowSpan ?? 1)}`)
          const s = styleOf(c)
          if (c.v == null || c.v === '') return `<c r="${ref}" s="${s}"/>`
          if (typeof c.v === 'number') return Number.isFinite(c.v) ? `<c r="${ref}" s="${s}"><v>${c.v}</v></c>` : `<c r="${ref}" s="${s}"/>`
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const fr = opts.freezeRows ?? 0
  const fc = opts.freezeCols ?? 0
  const pane = fr || fc ? `<sheetViews><sheetView workbookViewId="0"><pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${colName(fc)}${fr + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : ''
  const cols = opts.widths?.length ? `<cols>${opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.min(60, w))}" customWidth="1"/>`).join('')}</cols>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`
}

/* ---------------- ZIP (stored) ---------------- */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.data)
    const crc = crc32(data)
    // Local header: version 20, flag bit 11 (UTF-8 names), method 0 (stored), fixed date 1980-01-01.
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)])
    parts.push(local, name, data)
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name)
    offset += local.length + name.length + data.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)])
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const b of all) {
    out.set(b, p)
    p += b.length
  }
  return out
}

/** The .xlsx bytes of one sheet. */
export function workbook(sheetName: string, sheet: string): Uint8Array {
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: stylesXml() },
  ])
}
