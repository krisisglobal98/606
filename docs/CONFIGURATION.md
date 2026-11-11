# Konfigurasi (`.env`)

Semua konfigurasi dibaca dari environment, dimuat dari `.env` di root repository (`node --env-file-if-exists=../.env` dari `server/`) atau dari environment server/service. `.env` diabaikan Git; `.env.example` hanya berisi placeholder. Mengganti nilai tidak pernah butuh perubahan kode; restart DOD API setelah mengubahnya.

- Hanya `VITE_*` yang masuk bundle browser. Jangan pernah menaruh password di variabel `VITE_`.
- Semua variabel lain (`DOD_*`) hanya dibaca backend dan skrip di `server/`.
- Skema dan validasinya: `server/src/config/config.ts`. Nilai yang tidak valid menghentikan API saat start dengan pesan yang menyebut **nama** variabel, tidak pernah nilainya.
- Nilai bawaan DOD Minimal sengaja berbeda dari instalasi DOD lengkap yang mungkin berjalan di server yang sama (port 8080/8090, database `dor_application`). Variabel modul yang sudah dihapus (`DOD_GIS_*` selain `DOD_GIS_PRODUCTION_DB`, `DOD_GEOSERVER_*`, `DOD_UPLOAD_*`, `DOD_DASHGEN_*`, `DOD_PUBLISH_*`, `WEBPWADH*_*`) diabaikan bila masih ada di `.env`.

## Frontend (masuk ke bundle)

| Variabel | Bawaan | Arti |
|---|---|---|
| `VITE_APP_NAME` | `Daily Operation Discovery` | Nama aplikasi di judul |
| `VITE_APP_ENV` | `development` | Label lingkungan |
| `VITE_API_BASE_URL` | `/api` | Alamat API dari sisi browser |

`vite.config.ts` hanya membaca `DOD_API_HOST` / `DOD_API_PORT` (tujuan proxy `/api` saat dev/preview); keduanya tidak masuk bundle. Port Vite tetap: dev **5180** (lokal saja), preview **8100** (port publik; `run.ps1 preview -LanHost` membukanya ke jaringan) (`strictPort`; ganti dengan `--port` / `run.ps1 -Port`). Port publik server ini: 8088–8188; DOD Minimal memakai 8100 (web) dan 8101 (halaman publish).

## DOD API

| Variabel | Bawaan | Arti |
|---|---|---|
| `NODE_ENV` | `development` | `production` di server (log JSON tanpa pretty print) |
| `DOD_API_HOST` | `127.0.0.1` | Alamat listen. Di production tetap `127.0.0.1` (hanya reverse proxy yang mengakses) |
| `DOD_API_PORT` | `8181` | Port API |
| `DOD_API_CORS_ORIGIN` | kosong | Origin lain yang boleh memanggil API (biasanya tidak perlu: frontend dan API satu origin) |
| `DOD_TRUSTED_PROXIES` | kosong | Proxy yang `X-Forwarded-For`-nya diikuti (IP/CIDR maks. /8 IPv4 atau /16 IPv6, atau `loopback`). Kosong = tanpa proxy. IIS di server yang sama atau `vite preview` yang dibuka ke jaringan (proxy-nya meneruskan IP pengunjung): `127.0.0.1`. `DOD_API_TRUST_PROXY=true` ditolak |
| `DOD_LOG_LEVEL` | `info` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` |
| `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` / `DOD_ADMIN_NAME` | `admin` / – / `Administrator DOD` | Administrator pertama, dibuat hanya saat tabel user kosong (password min. 8 karakter) |
| `DOD_SESSION_HOURS` | `8` | Masa berlaku sesi |
| `DOD_LOGIN_MAX_ATTEMPTS` / `_PER_IP` / `DOD_LOGIN_WINDOW_MINUTES` / `DOD_LOGIN_MAX_TRACKED` | 5 / 20 / 15 / 10000 | Pembatas login ([SECURITY.md](SECURITY.md#authentication-and-roles)) |

## Database aplikasi (wajib)

| Variabel | Bawaan | Arti |
|---|---|---|
| `DOD_DB_HOST` | – (wajib) | Host PostgreSQL (atau folder socket Unix) |
| `DOD_DB_PORT` | `5432` | |
| `DOD_DB_NAME` | – (wajib) | Database aplikasi, mis. `dod_application_sit` |
| `DOD_DB_USER` / `DOD_DB_PASSWORD` | – (user wajib) | Akun pemilik database aplikasi |
| `DOD_DB_SSL` | `false` | `true` = TLS (sertifikat tidak diverifikasi) |
| `DOD_DB_POOL_MAX` | `5` | Koneksi maksimum ke database aplikasi |
| `DOD_DB_MASTER_NAME` | kosong | Nama database master organisasi PIMS (`dor_apims_master`): dipakai Data Profil ([DATA_PROFILE.md](DATA_PROFILE.md)) dan sebagai nama bawaan `DOD_ORG_DB_NAME` |

## Akses data (level akses dan filtering laporan)

Rincian: [DATA_ACCESS.md](DATA_ACCESS.md). Semua bawaan bersifat fail-closed: tanpa konfigurasi, tidak ada pengguna berlevel yang mendapat data laporan.

| Variabel | Bawaan | Arti |
|---|---|---|
| `DOD_ORG_DB_USER` / `DOD_ORG_DB_PASSWORD` | `DOD_DB_USER` / `DOD_DB_PASSWORD` | Akun pembaca master organisasi. Bawaannya akun DOD yang sudah ada (`dodmin`), yang di `dor_apims_master` hanya diberi SELECT oleh pemilik database ([sql/dor_apims_master](sql/dor_apims_master/)). Tidak boleh `postgres` |
| `DOD_ORG_DB_HOST` / `_PORT` / `_NAME` / `_SSL` | `DOD_DB_HOST` / `DOD_DB_PORT` / `DOD_DB_MASTER_NAME` / `DOD_DB_SSL` | Lokasi master |
| `DOD_ORG_CACHE_SECONDS` | `300` | Masa berlaku tetap snapshot organisasi (0–300) |
| `DOD_ORG_REGION_SOURCE` | kosong | `ms_region` atau `so_region`; kosong = level Region tidak bisa dipakai |
| `DOD_ORG_WILAYAH_NODE_IDS` | kosong | Id `ms_so_node` wilayah Direktur yang disetujui (koma) |
| `DOD_ORG_GMK_HEADER_IDS` | kosong | Id `ms_gmk_header` yang disetujui (koma) |
| `DOD_DATA_UNRESTRICTED_USERS` | kosong | Username pemegang hak khusus `unrestricted_data` (audit grant/revoke saat start) |
| `DOD_DATA_ACCESS_MANAGERS` | kosong | Username pengelola akses data (mengubah assignment pengguna lain) |

Profil lama `DOD_DB_TARGET` / `DOD_DB_<TARGET>_*` ditolak saat start: hanya ada satu set `DOD_DB_*`. Membuat database dan role lokal: `scripts/setup-local-db.ps1` ([SETUP.md](SETUP.md#3-database-lokal)).

## Secret dan file lokal

| Variabel | Bawaan | Arti |
|---|---|---|

## Sumber data warehouse (hanya dari .env)

Koneksi sumber **hanya** diatur di sini: DOD Minimal tidak punya halaman atau API untuk menambah, mengubah, menghapus, atau menguji koneksi, dan browser hanya menerima id, nama, jenis, dan status koneksi (tidak pernah host, database, akun, atau password). Koneksi didaftarkan ulang setiap API start; restart DOD API setelah mengubahnya. Id koneksi = prefix huruf kecil dengan `-` (`POSTGRES_SQL` → `postgres-sql`); dataset merujuk id itu, jadi jangan mengganti prefix koneksi yang sudah dipakai dataset.

| Variabel | Bawaan | Arti |
|---|---|---|
| `DOD_DW_CONNECTIONS` | kosong | Prefix dipisah koma, mis. `DEV,PROD`. Setiap prefix `P` membaca `DOD_DW_P_*`. Field wajib per jenis (bila kurang, API berhenti dengan pesan): `HOST`, `DATABASE` (kecuali Redis), `USERNAME` (PostgreSQL, ClickHouse, MySQL). Prefix yang sama sekali tidak punya variabel `DOD_DW_P_*` dilewati dengan peringatan di log, tanpa menghentikan API |
| `DOD_DW_P_NAME`, `_ENVIRONMENT` | prefix / `development` | Nama tampilan, label lingkungan |
| `DOD_DW_P_TYPE` | `postgresql` | `postgresql` · `clickhouse` · `mysql` · `mongodb` · `redis` |
| `DOD_DW_P_HOST`, `_PORT`, `_DATABASE`, `_USERNAME`, `_PASSWORD` | port per jenis | Alamat dan akun baca-saja. PostgreSQL/ClickHouse/MySQL tanpa `_PASSWORD` = *belum dikonfigurasi* dan tidak pernah disambungkan |
| `DOD_DW_P_SCHEMA` | `public` (ClickHouse: database) | Schema awal saat membuat dataset |
| `DOD_DW_P_SSL_MODE` / `_SSL_ROOT_CERT` | `require` | `disable` · `require` · `verify-full` (butuh file CA) |
| `DOD_DW_P_PROTOCOL` | `http` | ClickHouse saja: `http` / `https` |
| `DOD_DW_P_AUTH_SOURCE` | `admin` | MongoDB saja |
| `DOD_DW_P_CONNECT_TIMEOUT_MS` / `_COMMAND_TIMEOUT_MS` | 10000 / 30000 | |
| `DOD_DW_POOL_MIN` / `_MAX` / `_IDLE_MS` | 0 / 8 / 30000 | Pool per sumber (prefix bisa menimpa dengan `DOD_DW_P_POOL_*`) |

Rincian dan jaminan baca-saja: [DATABASE_CONNECTION.md](DATABASE_CONNECTION.md).

## Batas keamanan query

| Variabel | Bawaan | Arti |
|---|---|---|
| `DOD_QUERY_TIMEOUT_MS` | 30000 | Batas waktu query analitik |
| `DOD_METADATA_TIMEOUT_MS` | 15000 | Katalog sumber (schema, tabel, kolom) |
| `DOD_RESULT_DEFAULT_LIMIT` / `_MAX_LIMIT` | 3000 / 20000 | Baris hasil analitik |
| `DOD_EXPORT_MAX_ROWS` | 50000 | Ekspor |
| `DOD_DISTINCT_VALUES_MAX` | 500 | Pilihan nilai di filter |
| `DOD_RESULT_CACHE_SECONDS` | 300 | Umur cache hasil Analisis/laporan (0 = mati); per versi dataset dan cakupan akses, hak akses tetap dicek tiap request |

## Budget produksi (opsional)

| Variabel | Bawaan | Arti |
|---|---|---|
| `DOD_PRODUCTION_DB` | kosong | Database di server dan akun yang sama (mis. `DO_PIMS_REPORT`), dibaca read-only: budget produksi per blok di Analisis → Data Profil → Profil Blok, tab Produksi (`data_budget.budget_produksi_harian`). Kosong = kolom budget kosong. Nama lama `DOD_GIS_PRODUCTION_DB` masih dibaca |

## Skrip dan test (tidak dibaca API)

| Variabel | Bawaan | Dipakai oleh |
|---|---|---|
| `DOD_PERF_DATASET`, `DOD_PERF_PASSWORD`, `DOD_PERF_USER`, `DOD_PERF_BASE`, `DOD_PERF_SIZES` | – | `server/scripts/perf-test.ts` (`npm run perf`) |
| `DOD_TEST_PG_HOST`, `_PORT`, `_USER`, `_PASSWORD` | – | Test integrasi backend (opt-in; membuat database sementara) |
