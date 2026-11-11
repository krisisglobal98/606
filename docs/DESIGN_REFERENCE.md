# Design reference → Daily Operation Discovery (DOD)

Reference: `analisis-produksi-pivot.html`, a single-file pivot/analysis workspace. It was read in full before any code was written. This note records what was taken from it and how the implementation compares.

## 1. What the reference establishes

| Area | Reference | DOD token / component |
|---|---|---|
| Canvas | `#F3F6FA` cool grey page; white cards; 1px `#E1E8F1` hairline borders; 8px radius; **no card shadows**. Only menus and toasts are elevated. | `--bg`, `--surface`, `--line`, `--radius`, `--shadow-pop`; `.card` |
| Accent | The green of the DOD logo (`docs/brand/DOD-logo.png`): `#0B7A3B` (light) / `#3FB562` with dark ink (dark) for action, selection and active tab; pale green `#E5F3E8` / `#EDF5EC` for selected rows and chips; the logo's yellow `#F5B800` as `--accent`. Light stays white, dark stays near-black. | `--primary`, `--primary-soft`, `--chip`, `--accent` |
| Type | Plus Jakarta Sans, dense 13px base, 15px/700 section titles, 11.5px muted meta, tabular numbers | `--fs-*`, `.t-section`, `.t-meta`, `.num` |
| Navigation | Segmented pill tabs in a white bordered box; active tab is solid primary green | `.seg` (top nav, period picker, chart type) |
| Secondary tabs | Underline tabs with a pale-green active background | `.utabs` |
| Buttons | 36px, 6px radius, border-only default; primary solid; outline green; hover turns the border green | `Button` (`default / primary / outline / ghost`, `sm / lg`, icon-only) |
| Layout | 3 columns: **Pengaturan Data** (left, ~214px) · workspace · **Field List** (right, ~214px); 12px gaps | `Analysis.module.css` `.ws` (236 / fluid / 248px) |
| Layout zone | Dashed primary-green border card ("Layout (Drag & Drop)") with drop zones holding chips (grip, label, ×) | `LayoutZones`, `FieldChip` |
| Field list | Search box, collapsible Dimensi/Measure groups, grip-handle items; used fields highlighted in the primary green | `FieldList`, `FieldItem` |
| Pivot table | One column per row-dimension, `+/−` square toggles, label shown once per expanded group, subtotal rows `#EEF4FB`, grand total `#E2ECF8`, header `#DCE8F6`, conditional green/amber/red tinted cells | `ResultTable` (same algorithm as the reference `genRows`) |
| Switches | 30×18 pill switches for Subtotal / Grand Total; "Format Kondisi" as a toggle button | `Switch`, `Button active` |
| KPI | Bordered tile, muted label, 18px bold value | `KpiTile` (20px value plus delta line) |
| Feedback | Dark toast bottom-centre; modal with scrim | `Toaster`, `Modal` |
| Responsive | ≤1200px: left and right panels stack beside main; ≤860px: single column | Same breakpoints |

## 2. What was intentionally *not* carried over
- Code structure: the reference is one global `S` object with `innerHTML` re-rendering. DOD uses React components, typed contracts and three small stores.
- Items the brief removed from Analisis: Period, Version, Estate/Division/Block filters, Apply and Reset. Pengaturan Data applies immediately, and its dataset section is collapsed by default.
- The reference's Columns zone (month pivot across columns). Phase 1 asks for Dimensions and Measures only; measures form the columns.
- The Blast/Setup module, the Tren/Perbandingan/… tabs and the drill-down tabs are future modules and out of scope.

## 3. Additions, kept in the reference's language
- **Login**: one card on the reference canvas, using the same inputs, primary button and alert tint.
- **Dark mode and compact density**: the same token names with different values, so every component follows automatically.
- Chart colours: slot 1 is the brand green. Slots 2–4 are orange, violet and amber (distinct from the green and from each other). Targets are always the grey dashed reference series. Charts never use a dual axis; measures with a different unit are listed in a note and shown in the table.

## 4. Reference vs implementation review (performed after build)
Screenshots were compared at 1440×900, 1280×800, 1920×1080, 820 and 390 widths.

| Check | Result |
|---|---|
| 3-column workspace proportions, 12px rhythm | Match. Side columns are ~20px wider to fit Indonesian labels, and are sticky so the Field List stays visible. |
| Top tabs, buttons, chips, switches, table colours | Match the reference values. |
| Pivot table behaviour (toggle, subtotal, grand total, conditional format) | Match. |
| Drift found and fixed | (1) "Target 100%" chart label collided with a bar label: removed, the subtitle explains the line. (2) Perusahaan select truncated: widened. (3) Theme preview made the Settings form look unchanged, so it never saved: appearance now saves immediately. (4) Empty KPIs said "vs tahun lalu" beside a dash: now "Tidak ada data". |
| Remaining, deliberate | Login has a faint grid backdrop (the reference has no login screen). The insight marker is an icon instead of a plain dot, for accessibility. |
