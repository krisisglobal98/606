# Database connections

DOD uses two kinds of PostgreSQL database. They are never mixed.

| | DOD PostgreSQL (metadata) | External source (e.g. APIMS_REPORT) |
|---|---|---|
| Owner | DOD | Another system |
| DOD access | Read/write (own schema, migrations in `server/src/db/migrations`) | **Read-only** |
| Holds | users, sessions, connection records (secret *name* only), datasets, mappings, query log, audit | `public.aktual_produksi_harian`, `public.budget_produksi_harian`, … |
| Where it runs | One PostgreSQL server, set only by `DOD_DB_*` in `.env` (DOD Minimal: the `dod_application_sit` database; see [Application database server](#application-database-server) and [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md)) | **No**: external, reached over the network |

## Application database server

The app has **one** database server setup: `DOD_DB_*` in `.env`. Every database the app itself uses is on that server. DOD Minimal's database is its own (`dod_application_sit`), so it can share a PostgreSQL server with a full DOD installation (`dor_application`, `dor_upload`, `dod_dashboard_generator`) without touching it.

| Database (DOD Minimal default) | Used for | Set by |
|---|---|---|
| `dod_application_sit` | Users, sessions, menu permissions, data access assignments, connections, datasets, saved reports, logs | `DOD_DB_HOST`, `DOD_DB_PORT`, `DOD_DB_NAME`, `DOD_DB_USER`, `DOD_DB_PASSWORD`, `DOD_DB_SSL` |
| organization master, e.g. `dor_apims_master` (optional) | Organisation sync and Analisis → Data Profil (read-only) | `DOD_DB_MASTER_NAME`, same server and account |
| production budget, e.g. `DO_PIMS_REPORT` (optional) | Analisis → Data Profil: budget per block (read-only) | `DOD_PRODUCTION_DB`, same server and account |

These also take the server from `DOD_DB_*`:


`DOD_DB_HOST`, `DOD_DB_NAME` and `DOD_DB_USER` have no default. When one is empty, the API and the scripts refuse to start instead of falling back to a local database. `DOD_DB_TARGET` and the `DOD_DB_<TARGET>_*` profiles were removed on 2026-10-27, and a `.env` that still has them is refused with a message naming the variables. Data warehouse sources (`DOD_DW_*`) are separate and are described below.

## Configuration (environment, server-side)

All configuration is read from environment variables, loaded from the repository's `.env` (ignored by Git) or from the deployment environment. Changing credentials never needs a code change. `.env.example` contains placeholders only. Every variable with its default: [CONFIGURATION.md](CONFIGURATION.md).

`DOD_DW_CONNECTIONS` is empty by default. It is the **only** way to define a source: DOD Minimal has no page or API to add, change, delete or test connections, and the browser never receives host, database, account or password. A listed prefix must have the fields its type needs (`HOST`, `DATABASE` except Redis, `USERNAME` for PostgreSQL/ClickHouse/MySQL), or the API refuses to start. PostgreSQL/ClickHouse/MySQL without `_PASSWORD` are *not configured* and never dialled; a connection that fails to connect is not retried for 20 s.

### Source connections

`DOD_DW_CONNECTIONS` lists connection prefixes. Each prefix `P` reads `DOD_DW_P_*`:

| Variable | Example | Notes |
|---|---|---|
| `DOD_DW_CONNECTIONS` | `DEV` | Comma-separated, e.g. `DEV,PROD` |
| `DOD_DW_DEV_NAME` | `APIMS REPORT DEV` | Display name |
| `DOD_DW_DEV_ENVIRONMENT` | `development` | |
| `DOD_DW_DEV_TYPE` | `postgresql` | `postgresql` (default) or `clickhouse` (see below) |
| `DOD_DW_DEV_HOST` | host of the APIMS_REPORT DEV database (from the administrator; not recorded in the repository) | |
| `DOD_DW_DEV_PORT` | `5432` | |
| `DOD_DW_DEV_DATABASE` | `APIMS_REPORT` | |
| `DOD_DW_DEV_USERNAME` | the read-only DEV account (from the administrator) | |
| `DOD_DW_DEV_PASSWORD` | *(secret)* | **Server environment only.** Never in Git, images, frontend, API responses or logs |
| `DOD_DW_DEV_SCHEMA` | `public` | Default schema in the explorer |
| `DOD_DW_DEV_SSL_MODE` | `require` | `disable` · `require` (encrypted, certificate not verified) · `verify-full` (needs `DOD_DW_DEV_SSL_ROOT_CERT`, path to the CA bundle) |
| `DOD_DW_DEV_CONNECT_TIMEOUT_MS` | `10000` | |
| `DOD_DW_DEV_COMMAND_TIMEOUT_MS` | `30000` | Default `statement_timeout` of source sessions |

#### ClickHouse sources

A prefix with `TYPE=clickhouse` connects through the ClickHouse HTTP interface (`@clickhouse/client`). The ClickHouse *database* plays the role of the PostgreSQL schema.

| Variable | Example | Notes |
|---|---|---|
| `DOD_DW_CLICKHOUSE_TYPE` | `clickhouse` | Required. Without it the prefix is read as PostgreSQL |
| `DOD_DW_CLICKHOUSE_HOST` | `clickhouse.internal` | Host name or IP address of the ClickHouse server |
| `DOD_DW_CLICKHOUSE_PORT` | `8123` | Default 8123 (http) / 8443 (https) |
| `DOD_DW_CLICKHOUSE_PROTOCOL` | `http` | `http` or `https` (TLS). `SSL_MODE` is ignored |
| `DOD_DW_CLICKHOUSE_DATABASE` | `doreportwarehouse` | Also the default `SCHEMA` |
| `DOD_DW_CLICKHOUSE_USERNAME` / `_PASSWORD` | | Same secret rules as PostgreSQL |
| `DOD_DW_CLICKHOUSE_POOL_MIN` / `_POOL_MAX` / `_POOL_IDLE_MS` | 0 / 8 / 30000 | Per-connection pool, overrides `DOD_DW_POOL_*` (any type). For ClickHouse: maximum open HTTP sockets and the keep-alive idle time (capped at 25 s, below ClickHouse's default 30 s `keep_alive_timeout`) |

Differences from PostgreSQL: row counts come from `system.tables.total_rows` (exact for MergeTree, unknown for views); there are no per-column statistics; "indexes" are the table's sorting key and data-skipping indexes.

At start-up the backend upserts each connection into `dw_connection` with `password_secret = 'DOD_DW_DEV_PASSWORD'` (the variable name). The value is read from the environment only when a pool is opened.

### Pool and limits

| Variable | Default | Meaning |
|---|---|---|
| `DOD_DW_POOL_MIN` / `DOD_DW_POOL_MAX` | 0 / 8 | Connections per source (pooled, reused) |
| `DOD_DW_POOL_IDLE_MS` | 30000 | Idle connections are closed after this |
| `DOD_QUERY_TIMEOUT_MS` | 30000 | Analytics statement timeout |
| `DOD_METADATA_TIMEOUT_MS` | 15000 | Catalog timeout (schemas, tables, columns) |
| `DOD_RESULT_DEFAULT_LIMIT` / `DOD_RESULT_MAX_LIMIT` | 3000 / 20000 | Rows shown in the analysis table / rows fetched from an aggregate |
| `DOD_EXPORT_MAX_ROWS` | 50000 | Reserved for exports |
| `DOD_DISTINCT_VALUES_MAX` | 500 | Values offered in scope/filter pickers |

A query that exceeds its timeout is cancelled by PostgreSQL (`statement_timeout`), returns `SOURCE_TIMEOUT` ("persempit periode atau filter"), and is logged with its duration. When the browser abandons a request (e.g. a filter changed), the backend cancels the running statement with `pg_cancel_backend`.

### DOD metadata database

`DOD_DB_HOST`, `DOD_DB_PORT`, `DOD_DB_NAME`, `DOD_DB_USER`, `DOD_DB_PASSWORD`, `DOD_DB_SSL`, `DOD_DB_POOL_MAX`. `DOD_DB_HOST=/tmp` uses a local Unix socket. Migrations run automatically at start-up.

### API and first administrator

`DOD_API_HOST` (default `127.0.0.1`), `DOD_API_PORT` (8181), `DOD_LOG_LEVEL`, `DOD_SESSION_HOURS`, `DOD_ADMIN_USERNAME`, `DOD_ADMIN_PASSWORD`. The administrator is created only when the user table is empty.

## Read-only guarantees

1. Every source session starts with `default_transaction_read_only=on`, and every statement runs inside `BEGIN READ ONLY` with `SET LOCAL statement_timeout`. PostgreSQL itself rejects writes, **even if the account has write privileges**. This was verified against a superuser session.
2. Only SQL generated by DOD reaches a source; a guard rejects anything that is not a single `SELECT/WITH/SHOW` or that contains `INSERT/UPDATE/DELETE/MERGE/ALTER/DROP/TRUNCATE/CREATE/GRANT/REVOKE/COPY/…` (including `FOR UPDATE` and data-modifying CTEs).
3. DOD never creates tables, indexes or schemas in a source, and stores no DOD metadata there.
4. DOD checks the account's write privileges when it checks a connection on the server (`dataWarehouseService.test`, used by the tests). **Use a dedicated read-only account in production**:

```sql
-- run by the source DBA, not by DOD
CREATE ROLE dor_reader LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE "APIMS_REPORT" TO dor_reader;
GRANT USAGE ON SCHEMA public TO dor_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dor_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dor_reader;
-- PostgreSQL < 15 grants CREATE on public to everyone by default:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

No superuser privilege is needed. `pg_cancel_backend` works on DOD's own sessions without extra rights.

**ClickHouse.** Every statement is sent with `readonly=2` (ClickHouse rejects writes and any attempt to change `readonly`, while DOD can still set `max_execution_time`), `max_execution_time` as the timeout, and `cancel_http_readonly_queries_on_client_close=1`, so an abandoned request also stops the query on the server. Test Connection reads the account's direct grants (`SHOW GRANTS`; privileges inherited through roles are not expanded). Read-only account for production:

```sql
-- run by the ClickHouse administrator, not by DOD
CREATE USER dor_reader IDENTIFIED WITH sha256_password BY '<generated>' SETTINGS readonly = 2;
GRANT SELECT, SHOW ON doreportwarehouse.* TO dor_reader;
```

## Network requirements

- The **DOD server** (not the browser) needs outbound TCP to the source host (`DOD_DW_DEV_HOST`) on port 5432.
- If the RDS instance uses an IP allowlist / security group, add the DOD server's **public egress IP** (or its VPC CIDR when DOD runs in the same VPC). Prefer the RDS internal endpoint when DOD is deployed in the same Alibaba Cloud region/VPC.
- Do not open the source database to the public internet for DOD; only the DOD server needs access.
- Browsers only reach the DOD frontend/API over HTTPS.
- Check from the DOD server (PowerShell): `Test-NetConnection <DOD_DW_DEV_HOST> -Port 5432`.

## Error categories

Failures are mapped to business-readable messages; driver text, host names, stack traces and credentials are never returned.

| Code | Typical cause |
|---|---|
| `SOURCE_NOT_CONFIGURED` | Password secret not set on the server |
| `SOURCE_DNS_FAILURE` | Host name cannot be resolved |
| `SOURCE_NETWORK_FAILURE` | Firewall/allowlist, route, connect timeout |
| `SOURCE_AUTH_FAILED` | Wrong user/password |
| `SOURCE_UNAVAILABLE` | Database down, too many connections, database missing |
| `SOURCE_TIMEOUT` | Statement timeout exceeded (query cancelled) |
| `SOURCE_PERMISSION_DENIED` | No SELECT/USAGE on the object |
| `SOURCE_SCHEMA_UNAVAILABLE` / `SOURCE_TABLE_UNAVAILABLE` | Object missing or renamed |
| `SOURCE_SSL_ERROR` | SSL mode mismatch / certificate |
| `SOURCE_READ_ONLY_VIOLATION` | A write was attempted (blocked) |

## Running

Local: see [SETUP.md](SETUP.md). Windows Server / IIS: see [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md).
