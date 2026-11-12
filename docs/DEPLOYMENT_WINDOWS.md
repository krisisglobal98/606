# Deployment DOD Minimal di Windows Server (IIS)

> **Status.** Skrip di `deploy/windows/` lolos pemeriksaan sintaks Windows PowerShell 5.1. Deployment IIS DOD Minimal belum dijalankan di server; jalankan `Test-DOD.ps1` dan daftar periksa di bagian 5 sebelum menganggap deployment selesai.

DOD Minimal dipasang **di samping** instalasi DOD lengkap yang mungkin sudah ada di server yang sama, tanpa menyentuhnya:

| | DOD lengkap (sudah ada) | DOD Minimal |
|---|---|---|
| Folder | `D:\DOD` | `D:\DODMinimal` (`-Root`) |
| Service Windows (NSSM) | `DOD-API` | `DODMIN-API` |
| DOD API | `127.0.0.1:8080` | `127.0.0.1:8181` |
| Situs IIS / app pool | `DOD` (8088), `DOD-Publish` (8089) / `DOD` | `DODMIN` (8100: HTTP, atau HTTPS dengan `-CertThumbprint`) / `DODMIN` |
| Paket rilis | `dod-<versi>-<commit>.zip` | `dodmin-<versi>-<commit>.zip` |
| Database aplikasi | `dor_application` | `dod_application_sit` |
| Log | `D:\DOD\logs\dod-api*.log` | `D:\DODMinimal\logs\dodmin-api*.log` |

**Port publik.** Server membuka port **8088–8188** untuk publik. Terpakai: 8088/8089 (IIS DOD lengkap), 8090 (`DOD-API`), 8188 (proses lain), 8181 (`DODMIN-API`, loopback). Situs DOD Minimal memakai **8100**; API (8181) hanya listen di `127.0.0.1`.

Pengaman di skrip: `Deploy-DOD.ps1` menolak `-Root D:\DOD`, menolak zip yang bukan `dodmin-*`, menolak `DOD_API_PORT` 8080/8090, menolak membuat situs IIS pada port yang sudah dipakai situs lain atau proses lain, dan memberi peringatan bila port situs di luar rentang publik. Nama service, folder, situs, dan port ada di satu tempat: `deploy/windows/DOD.Common.ps1`.

## 1. Susunan

```
Browser ──HTTP(S)──▶ IIS site "DODMIN"  (D:\DODMinimal\current\dist, web.config)
                       ├── /api/*  ──ARR proxy──▶ service DODMIN-API  http://127.0.0.1:8181   (node src\main.ts, NSSM)
                       └── lainnya ──file statis / SPA fallback ke index.html
DODMIN-API ──▶ PostgreSQL: dod_application_sit (+ database opsional di server yang sama)
           ──▶ sumber data warehouse baca-saja (mis. APIMS_REPORT)
```

Folder di server (dibuat oleh `Deploy-DOD.ps1`; `-Root` default `D:\DODMinimal`, tanpa spasi):

| Folder | Isi |
|---|---|
| `releases\dodmin-<versi>-<commit>\` | Satu folder per rilis: `dist\`, `server\` (+ `node_modules`), `templates\`, `deploy\windows\`. Tiga rilis terakhir disimpan |
| `current\` | *Junction* ke rilis aktif. Situs IIS dan service selalu memakai path ini, jadi update dan rollback cukup memindahkan junction |
| `config\dod.env` | Konfigurasi production, di luar rilis. Hanya Administrators, SYSTEM, dan akun service yang bisa membaca |
| `logs\` | `dodmin-api.log` / `dodmin-api.err.log`, dirotasi tiap 10 MB |

## 2. Prasyarat server

| Komponen | Catatan |
|---|---|
| Windows Server 2016+ dengan IIS 10 | `Install-Prerequisites.ps1` memasang role IIS yang dibutuhkan |
| **URL Rewrite 2.1** dan **ARR 3** | Unduhan terpisah (tautannya ditampilkan skrip). Tanpa URL Rewrite, `web.config` gagal dimuat (500.19); tanpa ARR, `/api` tidak diteruskan |
| Node.js 24 LTS | `node -v` ≥ 24.0.0 |
| NSSM | Menjalankan DOD API sebagai Windows service: https://nssm.cc/download, salin `win64\nssm.exe` ke `C:\Tools\nssm\` |
| PostgreSQL | Database `dod_application_sit` dan role-nya ([DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md#2-membuat-database-aplikasi)) |
| Akses jaringan | Ke PostgreSQL dan ke registry npm (atau cache npm) saat `npm ci` |
| Sertifikat TLS (opsional) | Di `Cert:\LocalMachine\My`; thumbprint-nya dipakai `-CertThumbprint`. Tanpa sertifikat situs dibuat HTTP di port 8100 |

## 3. Langkah

**Di mesin build** (dari root repository; setelah repository Git dibuat dan perubahan di-commit):

```powershell
npm ci; npm ci --prefix server
npm run release        # lint, typecheck, test, build → release\dodmin-<versi>-<commit>.zip
```

Tanpa repository Git (atau dengan perubahan yang belum di-commit) hanya paket uji yang bisa dibuat: `node scripts/package-release.mjs --allow-dirty` (nama `dodmin-<versi>-nogit.zip` / `…-dirty.zip`).

Paket berisi `dist\` (dengan `web.config`), source `server\` (tanpa test, data, `.env`, dan `node_modules`), `templates\`, skrip `deploy\windows\`, dan `RELEASE.json`. Dependency API dipasang di server (`npm ci --omit=dev`), tidak ikut di dalam zip.

**Di server Windows** (PowerShell **sebagai Administrator**):

```powershell
# 0. Buka zip di folder sementara untuk mengambil skripnya
Expand-Archive C:\Temp\dodmin-0.1.5-abc1234.zip C:\Temp\dodmin-setup
cd C:\Temp\dodmin-setup\deploy\windows
Set-ExecutionPolicy -Scope Process Bypass

# 1. Prasyarat (ulangi sampai semuanya OK). Kalau .msi-nya sudah diunduh: -Installers C:\Installers
.\Install-Prerequisites.ps1

# 2. Pemasangan pertama: membuat D:\DODMinimal\config\dod.env dari template lalu berhenti
#    (-Nssm wajib sejak langkah ini bila nssm.exe tidak ada di PATH)
.\Deploy-DOD.ps1 -Zip C:\Temp\dodmin-0.1.5-abc1234.zip -Nssm C:\Tools\nssm\nssm.exe
notepad D:\DODMinimal\config\dod.env      # isi nilainya; lihat tabel di bawah

# 3. Jalankan lagi: pasang service DODMIN-API, situs IIS DODMIN, ARR
.\Deploy-DOD.ps1 -Zip C:\Temp\dodmin-0.1.5-abc1234.zip -ConfigureIis -Nssm C:\Tools\nssm\nssm.exe
#    dengan HTTPS: tambahkan -HostName dodmin.perusahaan.co.id -CertThumbprint <thumbprint>
#    port lain (harus kosong dan di rentang publik 8088-8188): -HttpPort 8100 -HttpsPort 8100

# 4. Verifikasi
.\Test-DOD.ps1 -BaseUrl http://localhost:8100
```

**Update berikutnya:** buat zip baru, lalu `.\Deploy-DOD.ps1 -Zip <zip baru>` dari folder `deploy\windows` rilis mana pun. Untuk mundur: `.\Rollback-DOD.ps1` (atau `-Release <nama>`).

Yang dilakukan `Deploy-DOD.ps1`, berurutan: membuka rilis → `npm ci --omit=dev` → memeriksa `dod.env` dengan kode rilis baru (tanpa menulis apa pun) → menghentikan service `DODMIN-API` → memindahkan `current` ke rilis baru dan menyalakan service → menunggu `/api/health` (migrasi database berjalan di sini) → bila API tidak sehat dalam 120 detik, `current` dikembalikan ke rilis sebelumnya. Situs IIS hanya dibuat/diubah dengan `-ConfigureIis`. Migrasi hanya menambah, sehingga rollback kode aman terhadap skema yang lebih baru.

**Isi `D:\DODMinimal\config\dod.env`** (template: `deploy\windows\dod.env.example`; daftar lengkap: [CONFIGURATION.md](CONFIGURATION.md)):

| Variabel | Nilai |
|---|---|
| `NODE_ENV` | `production` |
| `DOD_API_HOST` / `DOD_API_PORT` | `127.0.0.1` / `8181` (hanya IIS yang mengakses) |
| `DOD_TRUSTED_PROXIES` | Alamat asal koneksi ARR ke DOD API, `127.0.0.1` untuk IIS di server yang sama |
| `DOD_DB_*` | Server PostgreSQL, `dod_application_sit`, akun dan password sendiri (bukan milik instalasi DOD lengkap) |
| `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` | Hanya dipakai bila tabel user kosong |
| `DOD_DW_*`, `DOD_DB_MASTER_NAME`, `DOD_PRODUCTION_DB` | Sesuai kebutuhan (opsional) |

**Akun service:** default `NT AUTHORITY\LocalService` dengan hak baca rilis dan hak tulis data/log. Untuk akun lain: `-ServiceAccount DOMAIN\svc-dodmin -ServicePassword (Read-Host -AsSecureString)`.


## 4. Isi `web.config`

- Rule 1 `DOD API Reverse Proxy`: `^api/(.*)$` → `http://127.0.0.1:8181/api/{R:1}`, `stopProcessing`. `/api` tidak pernah dijawab dengan `index.html`. Bila `DOD_API_PORT` diubah, ubah juga port di `public\web.config`.
- Rule 2 `DOD SPA fallback`: selain file/folder yang ada, dan bukan `/api/` atau `/assets/`, di-rewrite ke `/index.html`. Refresh dan deep link berfungsi; chunk JS yang hilang tetap 404.
- Header: Content-Security-Policy (dari `public/web.config`; `vite preview` membaca kebijakan yang sama, dijaga `tests/csp.test.ts`), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`.
- `index.html` tanpa cache; `assets\` di-cache 365 hari (nama file berisi hash).
- MIME `.woff2`; segmen `.env` dan `.git` diblokir; batas body bawaan IIS (API sendiri menerima maksimal 512 KB per request).

## 5. Daftar periksa verifikasi (jalankan di server)

| # | Pemeriksaan | Cara | Hasil yang diharapkan |
|---|---|---|---|
| 1 | Modul IIS | `Get-WebGlobalModule \| ? Name -match 'Rewrite\|ApplicationRequestRouting'` | Keduanya ada |
| 2 | Proxy ARR aktif | IIS Manager → ARR → Server Proxy Settings | *Enable proxy* tercentang |
| 3 | `web.config` termuat | Buka `http(s)://<host>:<port>/` | Halaman login, bukan 500.19 |
| 4 | API lewat IIS | `curl.exe -i <base>/api/health` | 200 `application/json`, `"service":"dod-api"` |
| 5 | API error tetap JSON | `curl.exe -i <base>/api/tidak-ada` | 401 `application/json` (bukan HTML) |
| 6 | Deep link + refresh | Buka `<base>/beranda`, `/report/operasional`, `/data/dataset`, lalu F5 | Halaman tampil, bukan 404 IIS |
| 7 | Chunk hilang | `curl.exe -i <base>/assets/tidak-ada.js` | 404 |
| 8 | Cache | `curl.exe -I <base>/analisis` dan sebuah file `assets\*.js` | `index.html`: `no-cache`; aset: `max-age=31536000` |
| 9 | CSP | DevTools → Console saat login, Beranda, Analisis, preview Report | Tidak ada *Refused to …* |
| 10 | Rantai proxy | ARR *Preserve client IP* = `X-Forwarded-For`; `netstat -ano \| findstr :8181` | DOD API hanya listen di `127.0.0.1:8181`; `DOD_TRUSTED_PROXIES` = alamat ARR |
| 10e | Satu perangkat satu pengguna lewat IIS | Login akun A di PC 1, lalu akun B di PC 2 (perangkat berbeda) | Keduanya berhasil. Bila B ditolak "Perangkat ini sedang dipakai oleh A", IP pengunjung tidak sampai ke API (periksa *Preserve client IP* ARR dan `DOD_TRUSTED_PROXIES`). Format `IP:port` dari ARR sudah ditangani API |
| 10a | Batas per pengguna | Dari PC A, login salah 6× untuk satu username | Ke-6 → 429 dengan `Retry-After` |
| 10b | Pengguna lain di belakang proxy yang sama | Langsung setelahnya, login benar dari PC B | 200 |
| 10c | `X-Forwarded-For` palsu | Dari PC C: 6× login salah dengan header `X-Forwarded-For: 198.51.100.<n>` berbeda | Ke-6 → 429 |
| 10d | Akses langsung ke API | Dari PC lain: `curl.exe -i http://<host>:8181/api/health` | Gagal tersambung |
| 12 | Health ringkas | `curl.exe <base>/api/health/datawarehouse` tanpa login | Hanya `{"status": …}` |
| 13 | Service | Restart server Windows | `DODMIN-API` hidup kembali otomatis; `DOD-API` tidak terpengaruh |
| 14 | File sensitif | `curl.exe -i <base>/.env` dan `/web.config` | 404 |
| 15 | Backup | [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md#4-backup) untuk `dod_application_sit` | Dump berisi semua tabel |
| 16 | Tidak tumpang tindih | `Get-Service DOD-API, DODMIN-API`; `Get-NetTCPConnection -State Listen -LocalPort 8080,8090,8100,8181` | Kedua service berjalan; 8080/8090 milik `DOD-API`; 8181 milik `DODMIN-API` (127.0.0.1); 8100 milik IIS (situs `DODMIN`) |
| 17 | Port publik dari luar | Dari PC lain: buka `http://10.110.1.2:8100/` | Halaman login DOD Minimal |

Pemeriksaan 1–8, 10 (sisi server), 12–14 dijalankan otomatis oleh `deploy\windows\Test-DOD.ps1`; sisanya manual.

## Nama variabel lama

Variabel lingkungan memakai awalan `DOD_`. File env yang masih memakai awalan lama `DOR_` tetap terbaca (oleh API dan skrip deploy) selama `DOD_` dengan nama yang sama belum diisi. Nama tabel (`dor_*`) tidak berubah.
