# Pengguna, Organisasi, dan Hak Akses

Semua pengguna ada di satu tabel `dor_user` di database aplikasi. Login dikelola DOD sendiri (username + password, hash scrypt; SSO PIMS adalah tahap berikutnya). Tidak ada akun demo: administrator pertama dibuat dari `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` saat tabel user masih kosong. **Peran tidak menentukan data yang terlihat:** itu diatur assignment akses data ([DATA_ACCESS.md](DATA_ACCESS.md)).

## Peran

| Peran | Hak utama |
|---|---|
| `admin` | Mengelola aplikasi: Pengguna, Hak Akses Menu, dataset. **Tanpa assignment tidak melihat data laporan** |
| `analyst` | Membuat dan mengubah dataset dan kategori (koneksi sumber diatur di `.env` server, tidak di aplikasi) |
| `publisher` | Saat ini sama dengan `viewer` (menu Publish sudah dihapus); peran tetap ada agar pengguna lama tetap valid |
| `viewer` | Membaca: Beranda, Analisis, Report, Data |

Setiap route API memeriksa perannya sendiri (`requireRole` di `server/src/http/server.ts`). Hak Akses Menu (di bawah) hanya bisa **mempersempit** hak ini, tidak pernah memperluas.

## Pengguna (Settings → Pengguna)

`/settings/users` (admin). API: `GET/POST /api/users`, `GET/PUT /api/users/:id` (`server/src/users/`).

- Buat pengguna dengan password awal; ubah data, nonaktifkan/aktifkan lagi, reset password. `password_hash` tidak pernah dikirim API.
- Pengguna mengganti password sendiri lewat `POST /api/auth/password`.
- Form pengguna hanya berisi **identitas, peran aplikasi, identitas SSO, dan status**. Field level/cakupan/ownership lama ditolak API.

## Akses data (Settings → Pengguna → Akses data)

Bagian **Akses data** di halaman pengguna menampilkan assignment pengguna (sembilan level: Kepemilikan, Group, Wilayah Administrasi, Region, GMK, Perusahaan, Unit Operasional, Rayon, Divisi), validitasnya terhadap master PIMS, dan jumlah Unit Operasional yang dicakup. API: `GET/PUT /api/users/:id/access`, opsi organisasi `GET /api/org/options?level=&parent=` (dibaca langsung dari PIMS, read-only, tanpa salinan), `GET /api/org/status`, `POST /api/org/reload`.

- Hanya **pengelola akses data** (`DOD_DATA_ACCESS_MANAGERS`) yang boleh mengubah assignment, dan tidak untuk akunnya sendiri.
- Hak khusus **`unrestricted_data`** (`DOD_DATA_UNRESTRICTED_USERS`) memberi akses semua data; diberikan di `.env`, bukan lewat UI, dan dicatat di audit.
- Pengguna tanpa assignment, termasuk administrator aplikasi, tidak melihat data laporan.
- Aturan lengkap, konfigurasi, dan audit: [DATA_ACCESS.md](DATA_ACCESS.md).

Salinan master lama (`dor_org_*`, *Sinkronkan master*) sudah dipensiunkan: kodenya dikarantina di `D:\DODSourceMinimal_removed\step7`, dan tabelnya dibiarkan (kosong). Kolom cakupan lama di `dor_user` (`level_code`, `*_code`, `ownership_code`) tidak diubah dan tidak dipakai lagi.

## Hak Akses Menu

**Settings → Hak Akses Menu** (`/settings/permissions`, admin) menentukan menu yang boleh dibuka tiap peran. Menu yang dimatikan hilang dari navigasi, halamannya menampilkan "Menu tidak tersedia untuk peran Anda", dan server menolak API-nya dengan `403 MENU_FORBIDDEN`.

| Menu | Sub-menu | Peran yang bisa memilikinya |
|---|---|---|
| Beranda | | semua |
| Analisis | Profil Blok, Kartu Kendaraan (laporan kartu Data Profil, `/api/profile/*`) | semua |
| Report | Laporan Operasional | semua |
| Data | Set Data (Dataset & Kategori) | semua |
| Settings | Pengguna & Organisasi, Hak Akses Menu (semua admin) | semua |

Aturan:
- **Batas atas:** peran hanya bisa mendapat menu yang memang diizinkan pemeriksaan perannya; sel lain tampil "tidak tersedia".
- **Sub-menu** butuh menu induknya. Mematikan Report juga menutup semua tab Report.
- **Terkunci:** Settings dan Hak Akses Menu selalu aktif untuk admin, agar tidak ada yang terkunci di luar.
- **Bawaan:** tanpa pilihan tersimpan, semua menu di dalam batas atas aktif. **Kembalikan bawaan** menghapus semua pilihan tersimpan.

Penegakan:
- **Server:** hook di `server/src/access/routes.ts` memeriksa setiap request yang sudah login terhadap `API_RULES` sebelum body dibaca. API modul butuh menunya (mis. `/api/profile/*` butuh Analisis); sebuah tab butuh sub-menunya (mis. `/api/profile/blocks/*` butuh Profil Blok, `GET /api/saved-reports` butuh Laporan Operasional). Bacaan bersama (dataset, analitik) tetap terbuka untuk semua pengguna yang login. Pemeriksaan peran tiap route tetap berlaku.
- **Browser:** `/api/auth/login` dan `/api/auth/me` mengembalikan `user.menus`. Aplikasi memuatnya ulang saat start dan saat tab terlihat lagi (paling sering sekali per menit), jadi perubahan sampai tanpa login ulang. Halaman awal jatuh ke menu pertama yang diizinkan.
- **Cache:** server menyimpan pilihan 10 detik; penyimpanan langsung berlaku di server yang menyimpannya.

Penyimpanan: tabel `dor_role_menu` (migrasi `008_role_menu.sql`), primary key `(role, menu_id)`; setiap simpan dan reset dicatat di `dor_audit` (`access.menus.save`, `access.menus.reset`). Katalog menu: `server/src/access/menus.ts`; browser memakai id yang sama (`src/app/auth/menus.ts`, dijaga `tests/menus.test.ts`).

| Method | Path | |
|---|---|---|
| GET | `/api/access/menus` | matriks peran × menu: per sel `state` (`on`, `off`, `unavailable`), `locked`, `stored`, `reason` |
| PUT | `/api/access/menus` | `{ "roles": { "viewer": { "report": false } } }`; sel yang tidak dikenal, tidak tersedia, atau terkunci ditolak |
| POST | `/api/access/menus/reset` | kembali ke bawaan |

## Sesi dan pembatas login

Sesi: token acak 32 byte, yang disimpan di database hanya SHA-256-nya, berlaku `DOD_SESSION_HOURS` (default 8 jam); logout menghapus sesi. Pembatas login dan rinciannya: [SECURITY.md](SECURITY.md#authentication-and-roles).

## Test

- `server/test/users.test.ts`, `server/test/userOrg.integration.test.ts` (database sementara, opt-in dengan `DOD_TEST_PG_HOST`), `tests/userMeta.test.ts`.
- `server/test/access.test.ts`, `server/test/access.integration.test.ts`, `tests/menus.test.ts`.
