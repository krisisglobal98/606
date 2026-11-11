# Report Module

**Report** (`/report`, menu id `report`) has one page: **Laporan Operasional** (`/report/operasional`, menu id `report.operasional`). It lists Analysis layouts that users saved.

> DOD Minimal removed **Laporan PDF**: the report editor, Report Template, Blast Report (e-mail through SMTP), Distribution History, Penerima, Pengaturan Report, and the server-side HTML renderer. Old addresses (`/report/reports`, `/report/templates`, `/report/blast`, `/report/history`, `/report/recipients`, `/report/settings`) redirect to `/report/operasional`, and the `/api/report/*` API no longer exists.

## Laporan Operasional

- **Saving.** Analisis → **Simpan Laporan** asks for a name and a category from the master list (both required). It stores the dataset, scope, filters, dimensions, measures and groups, chart, table options and the dataset's calculated measures, in `dor_saved_report`. It stores no result data, and every signed-in user with the Analisis menu may save.
- **Categories.** The left side is a Kategori → Sub-kategori drilldown of the categories that hold reports. A saved report is not a dataset: it appears neither in the dataset drilldown of Analisis nor in a category's dataset count.
- **Viewing.** The page opens without a table (nothing is queried) until a report is chosen from the **Daftar Laporan** sidebar (Kategori → Sub-kategori → reports, with search) or from the recently updated list. The chosen report is shown as Tabel Hasil; the figures are queried from the source. The sidebar and the report header collapse to vertical tabs on the left. Filters open in a modal from the **Filter** tab (the same modal as in Analisis: period, value lists, single values), start as saved, apply on *Terapkan*, and *Kembalikan filter laporan* returns to them. Filter and table changes (subtotal, frozen columns, column order) last while the report is open: they change neither the saved report nor Analisis.
- **Removing.** The creator or an administrator. A deleted category moves the report to *Tanpa kategori*; a deleted dataset leaves it listed as *Dataset dihapus*, and its table is not shown.

## Architecture

```
src/pages/report/Operational/* → src/services/report/savedReportService → apiClient → /api/saved-reports
   server/src/reports/routes.ts → savedReportService.ts → dor_saved_report (migration 012_saved_report.sql)
```

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/saved-reports` | menu *Laporan Operasional* | List |
| `POST /api/saved-reports` | menu *Analisis* | Save from Analisis |
| `DELETE /api/saved-reports/:id` | creator or administrator, menu *Laporan Operasional* | Remove |

Contracts are in `src/types/report.ts` (`SavedLayout`, `SavedReport`).
