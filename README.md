# DOD Minimal (Daily Operation Discovery)

Aplikasi web pelaporan dan analitik operasional: data dibaca langsung (baca-saja) dari database sumber, diolah lewat dataset dengan pemetaan semantik, lalu ditampilkan sebagai analisis dan laporan (termasuk pengiriman laporan lewat email).

**Login → Beranda → Analisis → Report → Data → Settings**

DOD Minimal berjalan **terpisah** dari instalasi DOD lengkap yang mungkin ada di server yang sama: port, database, service Windows, folder, dan situs IIS-nya sendiri (web publik 8100, API internal 8181, database `dod_application_sit`). Rinciannya: [docs/SETUP.md](docs/SETUP.md#berdampingan-dengan-instalasi-dod-lengkap).

## Mulai cepat (Windows)

```powershell
Copy-Item .env.example .env        # isi DOD_DB_PASSWORD, DOD_ADMIN_PASSWORD
.\scripts\setup-local-db.ps1       # sekali: role dodmin + database dod_application_sit di PostgreSQL lokal
.\scripts\run.ps1                  # DOD API :8181 + frontend dev http://localhost:5180
.\scripts\run.ps1 preview -LanHost # build produksi, web publik http://<IP server>:8100
.\scripts\run.ps1 check            # typecheck, lint, test, build
```

Login dengan `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` dari `.env` (administrator pertama dibuat saat tabel user masih kosong; tidak ada akun demo). macOS/Linux: `./scripts/run.sh`. Panduan lengkap: **[docs/SETUP.md](docs/SETUP.md)**.

## Arsitektur

```
Browser ──▶ frontend (vite preview :8100 / dev :5180 / IIS) ──/api──▶ DOD API (server/, 127.0.0.1:8181) ──▶ PostgreSQL: dod_application_sit
                                                                                   └──read-only──▶ database sumber (PostgreSQL, ClickHouse, MySQL, MongoDB, Redis)
```

Browser tidak pernah terhubung ke database dan tidak pernah menerima tabel mentah: hanya metadata untuk membangun dataset, atau hasil agregasi. Koneksi sumber hanya diatur di `.env` server; browser tidak menerima host, akun, atau password-nya. Browser juga tidak memanggil layanan pihak ketiga (CSP `connect-src 'self'`).

| Folder | Isi |
|---|---|
| `src/` | Frontend React: `app/` (router, layout, guard menu), `pages/`, `components/`, `services/` (satu modul per area API, semua lewat `services/api/apiClient`), `stores/`, `types/contracts.ts` (kontrak Zod), `i18n/` |
| `server/` | DOD API (Fastify, node-postgres). `src/container.ts` merangkai service; `src/db/migrations/` dijalankan saat start; `scripts/` berisi skrip Data Profil dan uji performa; `test/` |
| `deploy/` | Skrip Windows/IIS (`deploy/windows/`) |
| `scripts/` | `run.ps1` / `run.sh`, `setup-local-db.ps1`, `package-release.mjs` |
| `tests/` | Test frontend (`node --test`) |
| `docs/` | Dokumentasi: [docs/README.md](docs/README.md) |

## Modul

| Modul | Status | Dokumen |
|---|---|---|
| Beranda | Tersedia: halaman awal polos (judul dan sapaan) | – |
| Data (Set Data: dataset, kategori; koneksi dari `.env`) | Tersedia | [DATA_MODULE.md](docs/DATA_MODULE.md), [DATA_WAREHOUSE.md](docs/DATA_WAREHOUSE.md) |
| Analisis | Tersedia | [DATASET_ARCHITECTURE.md](docs/DATASET_ARCHITECTURE.md), [DATA_PROFILE.md](docs/DATA_PROFILE.md) |
| Report (Laporan Operasional) | Tersedia | [REPORT_MODULE.md](docs/REPORT_MODULE.md) |
| Settings (Pengguna, Organisasi, Hak Akses Menu) | Tersedia | [USERS_AND_ACCESS.md](docs/USERS_AND_ACCESS.md) |

Modul yang dihapus dari DOD Minimal: peta GIS di Beranda (dan Input Curah Hujan), Insight, Laporan Excel, Dashboard Generator, Executive Summary, Publish, kontak WhatsApp/Telegram, Gudang Data (halaman koneksi) dan tahap Data yang belum dibuat (Pemetaan Data, Transformasi, Alur Data, Mutu Data), Report → Laporan PDF (editor, template, Blast email, riwayat, penerima, SMTP), kartu Auto Insights (Wawasan) dan Explain This Number (Jelaskan angka ini) di Analisis, serta Dashboard (`/dashboard`). File yang dihapus disimpan di folder karantina di luar project, beserta manifest-nya.

## Konfigurasi

`.env` (diabaikan Git) berisi semua pengaturan. Hanya `VITE_APP_NAME`, `VITE_APP_ENV`, dan `VITE_API_BASE_URL` yang masuk ke bundle browser, jadi jangan pernah menaruh kredensial di variabel `VITE_`. Semua variabel lain (`DOD_*`) hanya dibaca backend. Daftar lengkap: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Versi teknologi: [TECH_STACK.md](TECH_STACK.md).
