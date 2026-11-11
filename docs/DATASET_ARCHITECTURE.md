# Dataset architecture

A DOD dataset over a real source is **metadata, not a copy of data**: a reference to a connection, a schema, 1–4 source tables, and a semantic model. It is stored in DOD PostgreSQL (`dor_dataset`) and never in the source.

```
dor_dataset
├── id (wh-…), name, description, status (draft | active | archived)
├── connection_id ──▶ dw_connection (secret name only, no password)
├── schema_name, source_tables[]
└── semantic (jsonb) ──▶ sources · dimensions · measures · entity · kpi · scopeFields · filterFields · defaultLayout
```

Future configuration (mapping rules, transformations, relationships, calculated fields, business definitions) extends the same `semantic` document; the source schema is never changed.

## Semantic model

| Part | Meaning |
|---|---|
| `sources[]` | `alias`, `table`, `label`, `role` (`actual` / `budget` / `other`), `dateColumn` |
| `dimensions[]` | Business concept → column per source (`null` when absent). Compared as text, so type differences are normalised |
| Time dimensions | `tanggal` (month), `tahun`, `bulan`, `hari` (day, `YYYY-MM-DD`), derived from each source's date column |
| `measures[]` | `sum` (flows), `snapshot` (stock values repeated on daily rows), `ratio` (computed after aggregation) |
| `entity` | Dimensions that identify one physical unit (business unit + afdeling + block); used by snapshot measures and anomaly detection |
| `kpi` | Actual and target measures for the KPI tiles (Achievement and Growth are derived) |
| `scopeFields`, `filterFields`, `defaultLayout` | How the dataset appears in Analisis |

### Actual vs budget mapping (suggested automatically)

| Business concept | Id | Actual (`aktual_produksi_harian`) | Budget (`budget_produksi_harian`) |
|---|---|---|---|
| Business Unit | `bisnis_unit` | `kodebisnisunit` | `kodebisnisunit` |
| Group | `group` | `groupcode` | `groupcode` |
| Region | `region` | `regioncode` | `region_code` |
| Date | (time dims) | `tanggal` | `tanggal` |
| Afdeling | `afdeling` | `afdeling` | `afdeling` |
| Block | `blok` | `blok` | `blokcode` |
| Ownership | `kepemilikan` | `ownershipname` | `statuskepemilikan` |
| Planting year | `tahun_tanam` | `tahuntanam` (int8) | `tahuntanam` (text) |
| Area | `luas` / `budget_luas` | `luas` (snapshot) | `luas` (snapshot) |
| Plant population | `jumlah_pokok` / `budget_jumlah_pokok` | `jmlpkk` (snapshot) | `jmlpkk` (snapshot) |
| Production | `produksi` / `budget_produksi` | `produksi_harian` | `produksi_harian` |
| Bunches | `janjang` / `budget_janjang` | `janjang` | `janjang_harian` |
| Harvest area | `ha_panen` / `budget_ha_panen` | `hapanen` | `hapanen_harian` |
| Harvest labour | `hk_panen` / `budget_hk_panen` | `hkpanen` | `hkpanen_harian` |

Derived ratios: **Achievement** = produksi ÷ budget produksi × 100, **BJR** = produksi ÷ janjang, **Produktivitas Panen** = produksi ÷ ha panen, **Output per HK** = produksi ÷ HK panen. Ratios are computed from aggregated sums, never by averaging daily ratios.

The suggestion comes from a concept dictionary matched against the discovered column names (`server/src/datasets/semantic.ts`). For tables outside the dictionary, text columns become dimensions and numeric columns SUM measures. Every part is editable in the UI before saving; the server re-validates the model against live metadata (tables/columns exist, date columns are dates, measures numeric, ids unique, references resolve). Budget's monthly columns (`*_bulanan`) are not mapped by default because they repeat on every day of the month.

> **Units are assumptions to confirm.** The suggestion labels `produksi_harian` as Kg. Edit the unit in the mapping if the source uses another unit.

## Normalisation

- **Names**: different column names for one concept are mapped per source.
- **Types**: every dimension expression is text (`col` when already text, `col::text` otherwise), so `tahuntanam` int8 `2010` and text `'2010'` join. Text columns stay unwrapped, which keeps their indexes usable for filters.
- **Grain**: snapshot measures take `MAX` per entity within each group, then `SUM` across entities, so a month does not count the same block area 30 times.

## Query architecture

Users never send SQL. The Analysis page sends a structured query:

```json
{ "datasetId": "wh-…", "dimensions": ["region", "tanggal"], "measures": ["produksi", "budget_produksi", "achievement"],
  "scope": { "region": ["RIAU"] }, "filter": { "dateFrom": "2026-01-01", "dateTo": "2026-09-30", "fields": { "bisnis_unit": null } }, "chartBy": "trend" }
```

`SqlBuilder` (`server/src/analytics/sqlBuilder.ts`) turns it into one statement per need. Column names come only from the validated model and are quoted; all values are bind parameters.

```sql
WITH actual_r AS (            -- rows in the window + filters, normalised dimension expressions
  SELECT "regioncode" AS d0, to_char(date_trunc('month', "tanggal"), 'YYYY-MM-01') AS d1, "tanggal" AS dt,
         "produksi_harian"::float8 AS "c_produksi"
  FROM "public"."aktual_produksi_harian"
  WHERE ("tanggal" >= $1::date AND "tanggal" < $2::date + 1) AND "regioncode" = ANY($3::text[])),
actual_a AS (                 -- rollup with subtotals
  SELECT d0, d1, GROUPING(d0, d1) AS g, SUM("c_produksi") AS "m_produksi__cur", COUNT(*) AS "n_actual__cur"
  FROM actual_r GROUP BY GROUPING SETS ((), (d0), (d0, d1))),
budget_r AS (… "region_code" AS d0 … FROM "public"."budget_produksi_harian" …),
budget_a AS (…)
SELECT COALESCE(actual.d0, budget.d0) AS d0, …, actual."m_produksi__cur", budget."m_budget_produksi__cur"
FROM actual_a actual FULL JOIN budget_a budget
  ON actual.g = budget.g AND COALESCE(actual.d0, chr(1)) = COALESCE(budget.d0, chr(1)) AND …
ORDER BY g DESC, d0 NULLS FIRST, d1 NULLS FIRST LIMIT 20001
```

Per analysis request the backend runs (in parallel, on pooled connections):

| Query | Purpose | Result size |
|---|---|---|
| `analytics.main` | Table rows with subtotals and grand total (GROUPING SETS) | ≤ `DOD_RESULT_MAX_LIMIT` rows; table shows ≤ 3,000 |
| `analytics.chart` | Chart series when the chart dimension differs from the first row dimension | ≤ 1,000 |

The response follows the `AnalyticsResult` contract (rows, grand total, chart, period). The KPI tiles are computed in the browser from the pivot table's grand total; Auto Insights and Explain This Number were removed from DOD Minimal, and with them the `analytics.kpi` and `analytics.anomaly` queries. It adds `execution` (engine, source, duration, query count, source rows, result rows).

## Query engines

`QueryEngine` (`server/src/dw/queryEngine.ts`) receives a statement from a dialect-specific builder and returns rows. PostgreSQL is the only engine today. Another engine would add a builder for its dialect and an engine implementation; controllers, contracts and the frontend stay unchanged.

## Frontend boundary

- `src/services/warehouse/dataWarehouseService.ts`: connections (`getConnections`, `getConnection`, `createConnection`, `updateConnection`, `deleteConnection`, `testConnection`, `testDraft`, `getPrivileges`, `getHealth`), metadata (`getSchemas`, `getTables`, `getTableMetadata`, `getTableColumns`, `getTableIndexes`), bounded data (`getTablePreview`, `getTableProfile`, `countRows`), datasets (`suggestDataset`, `createDataset`, `listDatasets`, `getDataset`, `updateDataset`, `deleteDataset`, `getFieldValues`) and categories (`getCategories`, `createCategory`, `updateCategory`, `deleteCategory`).
- `src/services/dataset/datasetService.ts`: the Analysis catalog (`/api/dw/catalog`), datasets from the DOD API only; a backend failure is reported, never replaced by sample data.
- `src/services/analytics/analyticsService.ts`: sends the structured query to `/api/dw/analytics/query` (and the grid to `/api/dw/analytics/grid`). No database logic lives in React components.
