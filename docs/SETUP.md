# Panduan Menjalankan DOD Minimal

Panduan ini menjelaskan apa yang perlu disiapkan dan cara menjalankan DOD Minimal di komputer/server lokal (Windows), berdampingan dengan instalasi DOD lengkap yang mungkin sudah berjalan di mesin yang sama.

DOD Minimal terdiri dari tiga bagian:

| Bagian | Isi | Wajib? |
|---|---|---|
| **Frontend** (folder utama) | Aplikasi React (Vite). Semua data berasal dari DOD API; tidak ada mock API atau data contoh bawaan. | Ya |
| **DOD API** (`server/`) | Login, Data Warehouse, dataset, analitik, Data Profil, Report, pengguna dan hak akses. Satu-satunya bagian yang terhubung ke database. | Ya |
| **PostgreSQL** | Database aplikasi (`dod_application_sit`): user, sesi, koneksi, dataset, report, log. Bukan database sumber. | Ya |

## Berdampingan dengan instalasi DOD lengkap

Di server ini sudah berjalan instalasi DOD lengkap (service Windows `DOD-API`, folder `D:\DOD`, port 8080/8090, database `dor_application`). DOD Minimal **tidak berbagi apa pun** dengannya:

| | DOD lengkap (sudah berjalan) | DOD Minimal (source ini) |
|---|---|---|
| Web publik | 8088 (IIS) | **8100** (`run.ps1 preview -LanHost` atau situs IIS `DODMIN`) |
| DOD API (internal) | `127.0.0.1:8080` | `127.0.0.1:8181` |
| Frontend dev (lokal saja) | – | `http://localhost:5180` |
| Database aplikasi | `dor_application` | `dod_application_sit` (role `dodmin`) |
| Database lain di server ini | `dor_upload`, `dod_dashboard_generator`, `dor_gis_geometry`, `dor_webpwadh2`, `webpwadh1_src` | tidak dipakai dan tidak disentuh |
| Service Windows / folder | `DOD-API`, `D:\DOD` | `DODMIN-API`, `D:\DODMinimal` (hanya bila di-deploy, lihat [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md)) |
| Situs IIS | `DOD`, `DOD-Publish` | `DODMIN` (8100) |
| Konfigurasi | `D:\DOD\config\dod.env` | `.env` di folder ini |

**Port publik.** Server ini membuka port **8088–8188** untuk publik (alamat `10.110.1.2`). Yang sudah terpakai di rentang itu: 8088 dan 8089 (IIS, instalasi DOD lengkap), 8090 (`DOD-API`, loopback), 8188 (proses lain), 8181 (DOD Minimal API, loopback). DOD Minimal memakai **8100** (web). DOD API hanya listen di `127.0.0.1`, jadi tidak terjangkau dari luar walaupun berada di rentang itu. Sebelum memakai port lain, cek dulu: `Get-NetTCPConnection -State Listen -LocalPort <port>`.

Karena origin (port) berbeda, sesi login dan `localStorage` browser kedua aplikasi juga terpisah. Semua bawaan di atas tertulis di kode (`server/src/config/config.ts`, `vite.config.ts`, `scripts/run.*`, `deploy/windows/DOD.Common.ps1`), jadi tetap berlaku walaupun `.env` tidak lengkap.

---

## 1. Prasyarat

| Kebutuhan | Versi | Keterangan |
|---|---|---|
| **Node.js** | **24 LTS** (`.nvmrc`; minimal 24.0.0) | Backend menjalankan TypeScript langsung (fitur Node 24). npm ikut terpasang. |
| **PostgreSQL** | 14 ke atas | Database aplikasi. Di server ini: service `postgresql-x64-18`, `D:\PostgreSQL\bin`. |
| **Browser** | Chrome / Edge / Firefox terbaru | Buka lewat `http://localhost:…`, bukan membuka file langsung. |

Cek: `node -v` (harus v24.x) dan `npm -v`.

## 2. Konfigurasi `.env`

```powershell
Copy-Item .env.example .env        # bila belum ada; run.ps1 juga membuatnya otomatis
```

Isi minimal:

| Variabel | Isi |
|---|---|
| `DOD_DB_HOST`, `DOD_DB_PORT` | `127.0.0.1`, `5432` |
| `DOD_DB_NAME`, `DOD_DB_USER` | `dod_application_sit`, `dodmin` (jangan memakai database/akun instalasi DOD lengkap) |
| `DOD_DB_PASSWORD` | password acak untuk role `dodmin` (min. 12 karakter) |
| `DOD_ADMIN_USERNAME`, `DOD_ADMIN_PASSWORD` | akun administrator pertama (dibuat otomatis saat tabel user masih kosong) |

Membuat nilai acak (PowerShell): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Semua variabel lain (sumber data warehouse, master organisasi, budget produksi, data contoh) opsional dan dijelaskan di [CONFIGURATION.md](CONFIGURATION.md). `.env` tidak masuk Git; hanya variabel `VITE_*` yang sampai ke browser.

## 3. Database lokal

Sekali saja, buat role dan database DOD Minimal di PostgreSQL lokal:

```powershell
.\scripts\setup-local-db.ps1
```

Skrip membaca `DOD_DB_*` dari `.env`, meminta password superuser PostgreSQL (`postgres`; tidak disimpan dan tidak ditampilkan), lalu membuat role `dodmin` dan database `dod_application_sit` bila belum ada. Skrip menolak nama database/akun milik instalasi DOD lengkap dan tidak pernah menghapus apa pun. Tabel dibuat otomatis oleh DOD API saat pertama kali start.

Bila memilih membuat secara manual: lihat [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md#2-membuat-database-aplikasi).

## 4. Menjalankan

```powershell
.\scripts\run.ps1            # DOD API :8181 + frontend http://localhost:5180
```

Bila muncul *running scripts is disabled*: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, lalu ulangi.

Skrip memeriksa Node.js, membuat `.env` bila belum ada, memasang dependency frontend dan backend bila perlu, menyalakan DOD API dan menunggu `/api/health`, lalu menyalakan frontend. Ctrl+C menghentikan keduanya. Skrip menolak start bila port API sudah dipakai DOD API lain.

Buka **http://localhost:5180** dan login dengan `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` dari `.env`.

| Perintah (Windows) | macOS / Linux | Fungsi |
|---|---|---|
| `.\scripts\run.ps1` | `./scripts/run.sh` | Backend + frontend dev (hot reload) |
| `.\scripts\run.ps1 backend` | `./scripts/run.sh backend` | Hanya DOD API |
| `.\scripts\run.ps1 preview` | `./scripts/run.sh preview` | Build produksi + backend, sajikan di http://localhost:8100 |
| `.\scripts\run.ps1 build` | `./scripts/run.sh build` | Build produksi ke `dist\` |
| `.\scripts\run.ps1 check` | `./scripts/run.sh check` | Typecheck frontend + backend, lint, test, build |
| `.\scripts\run.ps1 install` | `./scripts/run.sh install` | Pasang dependency saja |

Opsi: `-Port 5190` / `PORT=5190` (port frontend), `-LanHost` / `HOST=1` (akses dari jaringan), `-Fresh` / `FRESH=1` (pasang ulang dependency).

Manual (tanpa skrip):

```powershell
npm ci; cd server; npm ci; cd ..
cd server; npm run dev          # terminal 1: DOD API di :8181
npm run dev                     # terminal 2: frontend di :5180 (proxy /api → :8181)
```

Health check: `http://127.0.0.1:8181/api/health`, `/api/health/database`, `/api/health/datawarehouse`.

### Akses dari jaringan (port publik, tanpa IIS)

Mode dev (`:5180`) hanya untuk komputer ini. Agar bisa dibuka pengguna lain lewat port publik:

```powershell
# .env (sekali):
#   DOD_TRUSTED_PROXIES=127.0.0.1           # vite preview meneruskan IP pengunjung (X-Forwarded-For)
.\scripts\run.ps1 preview -LanHost        # build produksi + API; web di http://10.110.1.2:8100
```

Tanpa `DOD_TRUSTED_PROXIES=127.0.0.1`, semua pengunjung lewat proxy terlihat sebagai `127.0.0.1` dan berbagi satu pembatas login: 5 kali salah password untuk `admin` mengunci akun itu 15 menit bagi semua orang (atau sampai API di-restart).

`vite preview` menyajikan hasil build dengan header keamanan produksi dan meneruskan `/api` ke `127.0.0.1:8181`. Untuk pemakaian tetap (service otomatis, HTTPS), pakai IIS: [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md). Windows Firewall di server harus mengizinkan port yang dipakai (inbound TCP).

## 5. Langkah pertama setelah login

1. **Koneksi sumber** diatur hanya di `.env`: `DOD_DW_CONNECTIONS` + `DOD_DW_<PREFIX>_*` termasuk `_PASSWORD` (akun baca-saja), lalu restart DOD API ([CONFIGURATION.md](CONFIGURATION.md#sumber-data-warehouse-hanya-dari-env)). Tidak ada halaman koneksi di aplikasi.
2. **Data → Set Data → Buat dataset**: pilih koneksi, schema, dan tabel, lalu periksa pemetaannya.
3. **Buka di Analisis**: pilih periode, dimensi, dan measure. Angka diagregasi di database sumber; browser hanya menerima hasilnya.
4. Opsional: **Settings → Pengguna** untuk membuat pengguna lain, **Settings → Hak Akses Menu** untuk membatasi menu per peran.

Modul yang butuh persiapan tambahan:

| Modul | Persiapan | Tanpa persiapan |
|---|---|---|
| Sinkronisasi master organisasi, Data Profil | `DOD_DB_MASTER_NAME` (budget produksi: `DOD_PRODUCTION_DB`) | Fitur nonaktif |

## 6. Mengatasi masalah

| Gejala | Penyebab dan solusi |
|---|---|
| `DOD_DB_HOST, DOD_DB_NAME, DOD_DB_USER belum diisi` | Isi `DOD_DB_*` di `.env`. |
| `DOD API gagal start: 28P01` / `password authentication failed` | Password `DOD_DB_PASSWORD` tidak cocok dengan role. Jalankan ulang `scripts\setup-local-db.ps1` (menyetel ulang password role). |
| `DOD API gagal start: 3D000` | Database `DOD_DB_NAME` belum ada: jalankan `scripts\setup-local-db.ps1`. |
| `ECONNREFUSED` ke database | PostgreSQL belum jalan (`Get-Service postgresql*`) atau `DOD_DB_HOST/PORT` salah. |
| `Koneksi DEV: HOST wajib diisi` | `DOD_DW_CONNECTIONS` menyebut prefix yang belum diisi. Kosongkan `DOD_DW_CONNECTIONS` atau isi `DOD_DW_DEV_*`. |
| `Port 8181 sudah dipakai DOD API lain` | `run.ps1` lain masih berjalan. Hentikan prosesnya (`Get-NetTCPConnection -LocalPort 8181`). Jangan pernah mengganti ke 8080/8090 (milik DOD lengkap). |
| `Port 5180 is already in use` | Tutup proses lain atau pakai `-Port 5190`. |
| *Terlalu banyak percobaan masuk* (HTTP 429) | Tunggu sesuai pesan (default 15 menit) atau restart DOD API. |
| Login gagal terus | Akun DOD lengkap (`dor_application`) **tidak** berlaku di sini: database DOD Minimal (`dod_application_sit`) hanya berisi `admin` dengan password `DOD_ADMIN_PASSWORD` dari `.env`. Admin dibuat dari `DOD_ADMIN_PASSWORD` hanya saat tabel user kosong. Bila password diganti setelahnya, ubah lewat Settings → Pengguna (admin lain) atau buat ulang database. |
| Koneksi *Password belum diset* | Isi `DOD_DW_<P>_PASSWORD` di `.env`, lalu restart backend. |
| *Server DOD tidak dapat menjangkau database sumber* | Firewall/allowlist belum mengizinkan IP server ini, atau port database diblokir. |
| *Query melebihi batas waktu* | Persempit periode/filter, atau naikkan `DOD_QUERY_TIMEOUT_MS`. |
| Refresh halaman memberi 404 dari web server | SPA fallback belum aktif (IIS: `web.config` dan modul URL Rewrite). |
| Halaman lama setelah deploy baru | Muat ulang paksa (Ctrl + Shift + R); `index.html` selalu direvalidasi. |

## 7. Ringkasan

```powershell
Copy-Item .env.example .env        # isi DOD_DB_PASSWORD, DOD_ADMIN_PASSWORD
.\scripts\setup-local-db.ps1       # sekali: role dodmin + database dod_application_sit
.\scripts\run.ps1                  # http://localhost:5180
```
