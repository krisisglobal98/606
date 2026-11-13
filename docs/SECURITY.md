# Security

Principle: **the DOD server connects to source databases; the browser never does, and never receives credentials or whole tables.**

## Secrets

| Secret | Where it lives | Never in |
|---|---|---|
| Source DB password (`DOD_DW_<P>_PASSWORD`) | Server environment (`.env` locally, deployment secrets in production) | Git, release packages, frontend bundle, `VITE_*` variables, API responses, browser storage, DOD's metadata DB, logs, error messages, docs |
| DOD metadata DB password (`DOD_DB_PASSWORD`) | Server environment | same |
| Initial admin password (`DOD_ADMIN_PASSWORD`) | Server environment; stored only as a scrypt hash | same |
| User session token | Issued by the DOD API; the DB stores only its SHA-256 hash; the browser keeps it to call the API | logs (redacted) |

- `.env` is git-ignored (`.env`, `.env.*`, `*.pem`); `.env.example` and `deploy/windows/dod.env.example` have placeholders only (no hosts, accounts or passwords).
- Vite exposes only `VITE_*` variables to the bundle. `vite.config.ts` reads only `DOD_API_HOST/PORT` (proxy target) and nothing else.
- A connection record stores the **name** of the secret (`DOD_DW_DEV_PASSWORD`); the API reports only `secretConfigured: true/false`.
- Release packages (`scripts/package-release.mjs`) exclude `.env*`; the server reads its configuration at runtime (`config\dod.env`), not at build time.
- Configuration errors name the variable, never its value.

## Read-only source access

See [DATABASE_CONNECTION.md](DATABASE_CONNECTION.md#read-only-guarantees): read-only sessions (`default_transaction_read_only=on`, `BEGIN READ ONLY`), a SQL guard that blocks anything but a single read statement, no DDL/DML ever issued, no DOD objects in the source. Test Connection warns when the account itself can write; production should use a dedicated `SELECT`-only role.

## Query safety

- Normal users never send SQL. Analytics uses a structured model (dataset, dimensions, measures, filters, period); preview uses structured filters.
- Identifiers come from discovered metadata or the validated semantic model, and are quoted; every value is a bind parameter.
- Limits: statement timeouts, preview page/offset caps, result-row caps, distinct-value caps, sample-based profiles. Exact counts only on explicit request.
- No SQL console exists. If one is added later it must be a separate, admin-only permission, outside the Analytics flow.

## Authentication and roles

- Login is always real: users in `dor_user` (scrypt), sessions in `dor_session` (random 32-byte tokens; only their SHA-256 is stored; `DOD_SESSION_HOURS` expiry; logout deletes the session). Login timing does not reveal whether a user exists. There are no demo credentials.
- Every user can change their own password (user menu → **Ubah password**, `POST /api/auth/password`). The current password is required, and the new one must be at least 8 characters and differ from it. Wrong current passwords count as failed logins for the login throttle. After the change, the user's other sessions end and the current one stays. The change is written to `dor_audit` without the password. An administrator still resets a forgotten password in Settings → Pengguna.
- Login throttle (`server/src/auth/loginLimiter.ts`): failed sign-ins are counted per client IP + username (`DOD_LOGIN_MAX_ATTEMPTS`, default 5) and per client IP (`DOD_LOGIN_MAX_ATTEMPTS_PER_IP`, default 20) in a `DOD_LOGIN_WINDOW_MINUTES` window (default 15). Over the limit the API answers `429 TOO_MANY_ATTEMPTS` with `Retry-After`, even for the right password; the counter ends with the window and a successful sign-in clears it, so nothing is locked permanently. An attempt is counted before the password check, so parallel requests cannot exceed the limit; a failure that is not a wrong password is refunded. Usernames are kept only as a hash. At most `DOD_LOGIN_MAX_TRACKED` counters (default 10,000) are stored: when full, expired and then the oldest non-blocking counters are dropped, an active block is never evicted, and if every counter is a block a new identity is refused until one expires. Limits: counters live in the API process (reset on restart, not shared between processes or instances; several instances each enforce their own limits), and clients behind one NAT address share the per-IP limit.
- The browser keeps the session token in `localStorage` (`dod.auth`) and sends it as `Authorization: Bearer`. Because it is readable by page scripts, the main defence is preventing script injection: the SPA is served with a strict Content-Security-Policy (below). Moving to an `HttpOnly` cookie is a planned change, not done yet: it needs CSRF protection for every state-changing route and same-site deployment of the SPA and API, introduced together with a transition period in which both the cookie and the Bearer header are accepted.
- One device, one signed-in user, enforced twice:
  - **Server (every browser on the device).** A session stores the client address it was opened from (`dor_session.client_ip`, migration 022; the address is `clientIp()`, so behind IIS/Vite it is the visitor's, through `DOD_TRUSTED_PROXIES`). While user A holds a valid session from an address, user B signing in from it is refused with `409 DEVICE_IN_USE` ("Perangkat ini sedang dipakai oleh …"). The check runs only after B's password is proven, so A's name is never shown without valid credentials, and it does not count as a failed sign-in. B may choose **Keluarkan akun tersebut dan masuk** (`takeOver: true`): A's sessions from that address end (audited as `auth.device_takeover`) and B signs in. A's open pages notice at their next request, or when their window is focused or shown again (checked at most every 15 s), and return to the login page. The same user may sign in from several browsers of the device. Check and session insert are one transaction under a per-address advisory lock, so two users signing in at once from one device cannot both succeed. Sessions opened before migration 022 have no address and hold no device.
  - **Browser (tabs).** Every tab follows the stored session (`src/stores/deviceSession.ts`, wired in `src/app/auth/deviceSessionSync.ts`): signing out in one tab signs out the others, another user signing in reloads the others as that user, a tab on the login form takes over a session started in another tab, and the Analisis workspace of a tab (`sessionStorage`, owner in `dod.analysis.owner`) starts over when the user changes.
  - **Limit:** "device" means client address. Clients sharing one address (NAT, a terminal server, one proxy without `X-Forwarded-For`) count as one device: there, one user at a time. The same account may still be signed in on other devices.
- Input guard (`server/src/http/server.ts`, `hasNul`): a request whose body, query string or path holds U+0000, or whose JSON is nested deeper than 64 levels, is refused with `400 INVALID_CHARACTER` before any handler (PostgreSQL text cannot hold U+0000; it used to surface as a 500/503 database error).
- Every `/api/dw/*` call needs a session. Source connections exist only in the server's `.env`: there is no API to add, change, delete or test one, and none returns host, database, account or password. Roles: viewer (catalog, analytics); analyst/admin additionally list connections (id, name, type, status), read schemas/tables/columns, and create and edit datasets; admin reads the query log in Settings › Log Query (menu `settings.querylog`, admin only: who, dataset, time, duration, rows, status and error code, filterable by period, status, kind, user, dataset and minimum duration; SQL text and parameter values are never stored, so never shown). Table preview, profile and exact count were removed.
- `/api/health` and `/api/health/database` are public liveness checks without detail. `/api/health/datawarehouse` returns only the overall status to anonymous callers; the per-source list (names, status, error code) needs a session.

## Browser hardening (SPA)

The SPA is served with `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`, plus `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and `X-Frame-Options: SAMEORIGIN` (`public/web.config` for IIS, and `vite preview` via `vite.config.ts`, which reads the policy from `public/web.config`; `tests/csp.test.ts` checks it). The Vite dev server sends no CSP, because hot reload needs inline scripts. No inline or eval'd script is needed: the theme bootstrap is `public/theme-init.js` and Zod runs `jitless` (`src/config/zod.ts`). `style-src 'unsafe-inline'` remains for generated report HTML shown in a `srcdoc` frame. Images and frames come only from this origin (images also `data:`/`blob:`), and the browser calls no third-party API.

## Logging

Logged: connection attempts and results, every source query (kind, status, duration, rows, error code, connection, dataset, user) into the log stream and `dor_query_log`, dataset changes and connection tests into `dor_audit`.

Not logged: passwords, connection strings, tokens, `Authorization`/`Cookie` headers (pino redaction as a safety net), SQL text or parameter values, driver error messages (only error codes).

## Errors shown to users

Business-readable categories only (`SOURCE_NETWORK_FAILURE`, `SOURCE_TIMEOUT`, …). Unknown failures return a generic message; details stay in server logs. No stack traces, host names from driver errors, or connection strings reach the client.

## Network

- Expose only the DOD frontend/API, over HTTPS (terminate TLS at the reverse proxy). Bind the API to `127.0.0.1` (or a private interface only the proxy can reach) and list that proxy in `DOD_TRUSTED_PROXIES` (next section).

## Client address behind a reverse proxy

The login throttle needs the real client address. Fastify follows `X-Forwarded-For` **only** through the addresses in `DOD_TRUSTED_PROXIES` (IP or CIDR, at most /8 IPv4 or /16 IPv6, or `loopback`), hop by hop from the right, and uses the first address that is not a trusted proxy. Other forwarding headers (`Forwarded`, `X-Real-IP`) are ignored; a forwarded value that is not an IP falls back to the TCP peer. `DOD_API_TRUST_PROXY` is gone: `true` (trust every hop, which let clients forge their address) is refused at start, `false` is ignored.

| Mode | `DOD_TRUSTED_PROXIES` | Requirement on the proxy |
|---|---|---|
| Native (Mac/Linux/Windows, no proxy; Vite dev/preview) | empty | none: `X-Forwarded-For` is ignored, the TCP peer is the client |
| IIS (ARR) on the same server | `127.0.0.1` (the address ARR connects from; administrator to confirm) | ARR must add the client to `X-Forwarded-For` (*Preserve client IP*; it appends, so a forged value stays to the left and is ignored). ARR adds the client's port by default (`10.1.2.3:50789`); the API drops it (`clientIp.ts`), so the server-wide ARR setting `includePortInXForwardedFor` (shared with other sites) need not change. The API must listen on `127.0.0.1`, so only local processes can act as the proxy |
| Another proxy / load balancer chain | every proxy hop's address | each hop appends or overwrites the header; an untrusted hop ends the chain |

Not verified on a real IIS deployment yet; the behaviour above is covered by `server/test/proxy.test.ts` (simulated requests on the real server). Deployment checks: `docs/DEPLOYMENT_WINDOWS.md` §5 #10–#10d.
- The source database should accept connections only from the DOD server's IP (allowlist/security group), not from the internet at large.

## Verification performed

| Check | Result |
|---|---|
| Password values in repository files | none (`.env` git-ignored; `.env.example` placeholders) |
| Secret values / DEV host / DB user in production bundle (`dist/`) | none |
| Secrets in API responses (connections, catalog, test, errors) | none |
| Secrets in backend logs during tests | none; `Authorization` header never logged |
| Writes through a read-only DOD session (even as superuser) | rejected by PostgreSQL (`cannot execute INSERT/DROP TABLE in a read-only transaction`) |
| Data-modifying SQL through the guard (`DELETE`, `; DROP`, `WITH … UPDATE`, `FOR UPDATE`) | blocked (`SOURCE_READ_ONLY_VIOLATION`) |
| Browser access to the source DB | none: the browser only calls `/api/*` on the DOD origin |

To repeat the bundle check after a build: `grep -rl "<secret value>" dist` must return nothing.
