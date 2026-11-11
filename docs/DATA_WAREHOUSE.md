# Data Warehouse (real source integration)

DOD reads external databases through its own backend. The browser never connects to a database and never receives a whole table: it gets metadata to build datasets, and aggregated analytics results.

```
Browser ──HTTPS──▶ DOD API (server/) ──▶ DOD PostgreSQL        users, sessions, connection registry, datasets, query log, audit
                                     └─▶ Source connections of .env ──read-only──▶ e.g. DO_PIMS_REPORT, APIMS_REPORT
```

## Connections: only in `.env`

DOD Minimal takes source connections **only from the server environment**: `DOD_DW_CONNECTIONS` lists the prefixes, and each prefix `P` reads `DOD_DW_P_*` (see [CONFIGURATION.md](CONFIGURATION.md#sumber-data-warehouse-hanya-dari-env)). The connection id is the prefix in lower case with `-` (`POSTGRES_SQL` → `postgres-sql`); datasets refer to that id. Restart DOD API after a change.

- There is **no page and no API** to add, change, delete or test a connection, and none to preview, profile or count a table.
- The browser gets each connection's **id, name, type, environment, default schema and status** only: never host, port, database, account, password, or the name of the password variable.
- PostgreSQL, ClickHouse and MySQL need `DOD_DW_P_PASSWORD`. Without it the connection is *not configured*, and DOD never dials it.
- A connection that fails to connect is not retried for 20 seconds; the same error is returned at once. Every page load would otherwise turn into a storm of failing connection attempts, and PostgreSQL would answer "too many clients" (53300) to everyone, including other applications.
- Check a connection on the server (e.g. `psql` with the same account, or `GET /api/health/datawarehouse` as admin, which runs `SELECT 1` per connection and returns its status only).

On start, the API registers every `.env` connection in `dw_connection` (secret **name** only, never the value). Migration `019_connections_from_env.sql` turned the connections earlier added in the UI into environment connections (prefix from the name) and dropped their stored passwords.

## What is connected

| Area | Source |
|---|---|
| Login, sessions | **Real** (DOD API, `dor_user` / `dor_session`) |
| Data → Set Data: datasets over real tables (ids `wh-…`), semantic mapping, categories | **Real**, persisted in DOD PostgreSQL |
| Analisis on a real dataset (Field List, scope, filters, KPI, chart, table) | **Real**, aggregated in the source database |
| Report, Analisis → Data Profil | **Real** (DOD API) |

There is no mock API and no silent fallback. If a dataset's source is unreachable (or its password is missing in `.env`), Analisis shows **Data Source Unavailable** and offers to switch dataset; it never shows sample numbers in its place.

## UI

- **`/data/dataset/new`**: dataset wizard. Choose a connection (by name) and schema, pick 1–4 tables (estimated row counts), get a suggested semantic mapping (editable), then save.
- **`/data/dataset/wh-…`**: dataset detail. Shows the sources (connection name, schema, tables), fields and mapping (editable by admin/analyst), and *Buka di Analisis*.

## Metadata discovery

All metadata comes from the source's catalogs at request time (cached 60 s on the server). Nothing is hard-coded per table, so new tables appear automatically.

| Item | PostgreSQL catalog |
|---|---|
| Schemas | `pg_namespace` (+ `has_schema_privilege USAGE`) |
| Tables, views, size, comment | `pg_class`, `pg_total_relation_size`, `obj_description` |
| Estimated rows | `pg_class.reltuples` (planner statistics; never `COUNT(*)`) |
| Columns, types, nullable, ordinal, default | `pg_attribute`, `format_type`, `pg_attrdef` |
| Distinct / null fraction / common values / range | `pg_stats` (from ANALYZE; no table scan) |

## Analytics path

`Analisis → query definition (dataset, dimensions, measures, filters, period) → POST /api/dw/analytics/query → SQL builder → GROUP BY / GROUPING SETS in the source → ≤ a few thousand rows → JSON → ECharts`. See [DATASET_ARCHITECTURE.md](DATASET_ARCHITECTURE.md). Each result carries an `execution` block (source rows, result rows, queries, duration) that the page shows under the KPIs.

## API (DOD backend)

| Method & path | Role / menu | Purpose |
|---|---|---|
| `GET /api/health`, `/api/health/database` | public | Process and DOD DB |
| `GET /api/health/datawarehouse` | admin | `SELECT 1` per `.env` connection (status only) |
| `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` | – | Sessions |
| `GET /api/dw/connections` | admin, analyst · *Set Data* | Connections of `.env`: id, name, type, environment, default schema, status |
| `GET /api/dw/connections/:id/schemas`, `…/schemas/:s/tables`, `…/tables/:t/columns` | admin, analyst · *Set Data* | Metadata to build and edit datasets |
| `GET/POST /api/dw/datasets`, `GET/PATCH/DELETE /api/dw/datasets/:id`, `POST /api/dw/datasets/suggest` | read: any · write: admin, analyst | Datasets & mapping |
| `GET /api/dw/datasets/:id/values?field=` | any | Distinct values for scope/filter (≤ 500, cached 10 min) |
| `GET /api/dw/catalog`, `POST /api/dw/analytics/query`, `POST /api/dw/analytics/grid` | any | Analysis catalog and queries |
| `GET /api/dw/query-log` | admin | Recent query metrics |

## Backend structure (`server/src`)

| Module | Responsibility |
|---|---|
| `http/routes.ts` | Controllers (Auth, Health, DataWarehouse, Dataset, Analytics): validate, check role, call a service |
| `config/config.ts` | Reads `DOD_DW_CONNECTIONS` / `DOD_DW_<P>_*` (required fields per type) |
| `dw/dataWarehouseService.ts` | Registering `.env` connections, the browser's connection list, server-side connection check, health |
| `dw/metadata.ts` | Shared metadata types; `MetadataService` routes each connection to its catalog reader |
| `dw/postgresMetadataService.ts`, `dw/clickhouseMetadataService.ts`, … | Catalog discovery per database type, privileges, server info |
| `dw/sourceQueryService.ts` | Implements `QueryEngine` for live sources |
| `dw/sql.ts` | Identifier quoting, typed parameters and the PostgreSQL/ClickHouse `SqlDialect` |
| `dw/sourceRegistry.ts` | pg pools / ClickHouse HTTP clients, read-only sessions, timeouts, cancellation, connect backoff, SQL guard |
| `datasets/` | Semantic model, suggestion, validation, persistence |
| `analytics/` | SQL builder and AnalyticsService |
| `container.ts` | Composition root (constructor dependency injection) |

## Next stage: extraction

Analytics query the sources directly, through the `QueryEngine` interface (`dw/queryEngine.ts`), so the engine can change without frontend changes.
