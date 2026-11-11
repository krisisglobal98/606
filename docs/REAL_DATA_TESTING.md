# Real data testing

How to test DOD against a real source, and reference measurements taken during development.

> The figures under *Reference results* were measured in October 2026 on a development laptop against a local synthetic copy of APIMS_REPORT (`apims_local_test`: same tables, columns, types and indexes as DEV; 3,088,349 actual and 1,314,000 budget rows of generated data, read through a `SELECT`-only role). They are a baseline, not a result of this installation. The synthetic budget covers half of the blocks, so its achievement figures are meaningless.

## Steps against a real source

1. In `.env` (never committed) set `DOD_DW_CONNECTIONS=DEV` and fill `DOD_DW_DEV_HOST`, `DOD_DW_DEV_DATABASE`, `DOD_DW_DEV_USERNAME`, `DOD_DW_DEV_PASSWORD` (a read-only account). Connections exist only in `.env`; there is no connection page.
2. Start DOD (`.\scripts\run.ps1`; [SETUP.md](SETUP.md)).
3. Check the connection on the server: `GET /api/health/datawarehouse` as admin shows `up` for `dev` (or connect with `psql` using the same account).
4. **Data → Set Data → Buat dataset** → connection *APIMS REPORT DEV*, schema `public`: the table list shows `aktual_produksi_harian` and `budget_produksi_harian` (and any other table, discovered automatically).
5. Select both tables → *Susun pemetaan* → check units (Kg?) → name it **Production Performance** → *Simpan*. Verify persistence: `SELECT id, name, source_tables FROM dor_dataset;` in DOD PostgreSQL.
6. **Buka di Analisis**: Field List shows the dimensions (Kode Bisnis Unit, Group, Region, Tanggal, Afdeling, Blok, Tahun Tanam, Kepemilikan) and measures (Luas, Jumlah Pokok, Produksi, Janjang, Ha Panen, HK Panen, budget counterparts, Achievement, BJR, …). Set period 2026, dimensions Region + Tanggal, measure Produksi; check KPI, chart, table, filters.
7. Volume test: `cd server && DOD_PERF_DATASET=<wh-id> DOD_PERF_PASSWORD=<DOD login> npm run perf`.
8. Compare one figure with a direct SQL run by a DBA, e.g. `SELECT regioncode, date_trunc('month', tanggal), sum(produksi_harian) FROM public.aktual_produksi_harian WHERE tanggal >= '2026-01-01' AND tanggal < '2027-01-01' GROUP BY 1, 2;`.

## Reference results (synthetic copy, October 2026)

Machine: development laptop (Apple Silicon), PostgreSQL 14, DOD API on the same machine.

### Volume scenarios (`npm run perf`, Region × Month, SUM produksi + budget + achievement)

| Target | Window | Source rows (actual+budget) | Server time | HTTP total | Payload to client | JSON parse | Result rows |
|---|---|---|---|---|---|---|---|
| 10,000 | 2026-10-02 → 2026-10-03 | 14,897 | 30 ms | 33 ms | 5.9 KB | 0.1 ms | 8 |
| 100,000 | 2026-09-14 → 2026-10-03 | 137,673 | 201 ms | 204 ms | 6.7 KB | 0.1 ms | 12 |
| 500,000 | 2026-06-23 → 2026-10-03 | 686,435 | 747 ms | 752 ms | 9.0 KB | 0.1 ms | 24 |
| 1,000,000 | 2026-03-10 → 2026-10-03 | 1,379,244 | 1,233 ms | 1,238 ms | 11.6 KB | 0.1 ms | 36 |
| 3,000,000 | 2025-01-18 → 2026-10-03 | 4,127,759 | 4,502 ms | 4,507 ms | 22.6 KB | 0.4 ms | 92 |

Server time includes the four parallel queries (main rollup, KPI with last-year window and drivers, anomaly scan). The payload grows with the number of *groups* (regions × months), not with source rows: 280× more source rows → 4× more bytes.

### Browser (Analisis, real dataset, 2025-01-01 → 2026-10-03)

| Measure | Value |
|---|---|
| Source rows aggregated | 4,242,149 |
| Result rows rendered | 28 (Region × Business Unit) |
| Time from filter change to rendered KPI/chart/table | 3.7 s |
| Bytes received from `/api/dw/analytics/query` | 21.9 KB in total for the scenario |
| Raw source rows received by the browser | **0** |

### Data Warehouse UI (October 2026, before the connection page was removed from DOD Minimal)

| Check | Result |
|---|---|
| Test Connection | Connected, 1–23 ms, PostgreSQL 14.20, schema `public` with 2 objects, read-only session, read-only account |
| Discovery | both tables, 14 / 25 columns with types and nullability, 4 + 4 indexes, estimated rows from `reltuples` |
| Preview | 100 rows per page from ±3,088,349; page 2 = rows 101–200; filter `regioncode = RIAU` + `tanggal ≥ 2026-09-01` + sort by `tanggal` (index); largest response 12 KB |
| Deep paging | capped at page 1,001 for page size 100 (`DOD_PREVIEW_MAX_OFFSET`) |
| Profile | 10,000-row block sample (TABLESAMPLE SYSTEM 0.42 %) |
| Exact count | 3,088,349 rows in 350 ms (explicit action only) |
| Dataset wizard | mapping suggested as in [DATASET_ARCHITECTURE.md](DATASET_ARCHITECTURE.md); saved to `dor_dataset`; opened in Analisis |
| Console errors | none |

### Failure handling (verified)

| Scenario | Result shown |
|---|---|
| Password not set | *Password belum diset di server (variabel DOD_DW_DEV_PASSWORD)* |
| Unknown host | `SOURCE_DNS_FAILURE` |
| Unroutable host / timeout on connect | `SOURCE_NETWORK_FAILURE` |
| Account without SELECT | `SOURCE_PERMISSION_DENIED` |
| Statement over timeout | `SOURCE_TIMEOUT` (query cancelled) |
| Missing table | `SOURCE_TABLE_UNAVAILABLE` |
| Write attempts | `SOURCE_READ_ONLY_VIOLATION`; PostgreSQL also rejects writes in DOD sessions |
| Real dataset unreachable in Analisis | *Data Source Unavailable*, no sample data shown |

## Performance metrics

Every source query is recorded in `dor_query_log` (start, end, duration, rows, connection, dataset, user, kind, status, error code), without SQL text:

```sql
SELECT kind, count(*), round(avg(duration_ms)) AS avg_ms, max(duration_ms) AS max_ms, sum(rows_returned) AS rows
FROM dor_query_log WHERE started_at > now() - interval '1 day' GROUP BY kind ORDER BY avg_ms DESC;
```

Admins can also read the latest entries through `GET /api/dw/query-log`.
