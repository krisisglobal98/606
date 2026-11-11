# Operasional Database

Database apa saja yang dipakai DOD Minimal, mana database aplikasinya, serta cara migrasi, backup, dan restore. Dokumen ini tidak memuat password atau connection string; semuanya berasal dari `.env` (lokal) atau `<Root>\config\dod.env` (server).

## 1. Topologi

| Peran | Teknologi | Nama bawaan DOD Minimal | Wajib? | Diatur dengan |
|---|---|---|---|---|
| **Database aplikasi** (satu-satunya) | PostgreSQL 14+ | `dod_application_sit` | Ya | `DOD_DB_*` |
| Master organisasi (baca-saja) | PostgreSQL, server yang sama | mis. `dor_apims_master` | Tidak | `DOD_DB_MASTER_NAME` |
| Budget produksi per blok untuk Data Profil (baca-saja) | PostgreSQL, server yang sama | mis. `DO_PIMS_REPORT` | Tidak | `DOD_PRODUCTION_DB` |
| Sumber data nyata (baca-saja) | PostgreSQL / ClickHouse / MySQL / MongoDB / Redis | mis. APIMS_REPORT | Untuk data nyata | `DOD_DW_*` di `.env` (satu-satunya tempat; tidak ada halaman koneksi) |

Aturan:

- **Satu database aplikasi.** Semua data milik aplikasi (user, sesi, hak akses menu, koneksi, dataset, kategori, report, template, penerima, distribusi, setting, audit, query log) ada di database yang ditunjuk `DOD_DB_NAME`.
- **Sumber hanya dibaca.** API tidak pernah menulis ke database sumber. Hanya skrip contoh (`w2.ts`, `dummy.ts`) yang membuat dan mengisi database DUMMY-nya sendiri.
- **Berbagi server dengan instalasi DOD lengkap.** Server PostgreSQL yang sama boleh juga dipakai instalasi DOD lengkap (`dor_application`, `dor_upload`, `dod_dashboard_generator`, `dor_gis_geometry`, `dor_webpwadh2`, `webpwadh1_src`). DOD Minimal tidak pernah memakai nama-nama itu: database aplikasinya `dod_application_sit`, dan `scripts/setup-local-db.ps1` menolak nama tersebut. DOD Minimal tidak lagi punya skrip yang membuat atau menghapus database contoh. Setiap perintah di bawah menyebut database secara eksplisit; jangan menjalankan perintah tingkat server (`pg_dumpall`, `DROP DATABASE` tanpa nama yang jelas).
- **ClickHouse opsional.** Bila mati atau tidak dikonfigurasi, dataset ClickHouse tampil *tidak tersedia*; modul lain tetap berjalan.

## 2. Membuat database aplikasi

Lokal (Windows), sekali: isi `DOD_DB_*` di `.env`, lalu

```powershell
.\scripts\setup-local-db.ps1                     # meminta password superuser PostgreSQL; membuat role + database bila belum ada
```

Manual (psql sebagai superuser), dengan nama dan password Anda sendiri:

```sql
CREATE ROLE dodmin LOGIN NOSUPERUSER PASSWORD '<password acak>';
CREATE DATABASE dod_application_sit OWNER dodmin ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE dod_application_sit FROM PUBLIC;
```

Tabelnya dibuat oleh API saat start (migrasi).

## 3. Migrasi

- File: `server/src/db/migrations/NNN_*.sql` (saat ini `001_init` s.d. `021_user_access`; `007`, `011`, `013`, `014` milik modul yang dihapus sudah tidak ada, dan `005` tinggal menambah peran `publisher`). Dijalankan otomatis saat DOD API start (`MetadataDb.migrate()` di `server/src/db/metadataDb.ts`), masing-masing sekali, di dalam transaksi, dicatat di tabel `dor_migration`. Semua migrasi aditif (tabel dan kolom baru), kecuali `016` (tabel Laporan Excel dan curah hujan) dan `017` (tabel Publish) yang men-drop tabel **hanya bila tabelnya kosong** (tabel berisi data dibiarkan dan dicatat sebagai NOTICE), dan `018` (kanal WhatsApp/Telegram dan kontak aplikasi) yang men-drop kolom `dor_recipient.phone`, `telegram`, `preferred` dan `dor_distribution.chat_message`, `channel_mode` **hanya bila kosong**, serta menghapus baris `dor_setting` `app.contact` dan hak menu `settings.contact`. `019` mengubah koneksi yang dulu ditambahkan dari UI menjadi koneksi `.env` (prefix dari namanya, mis. "Postgres SQL" → `POSTGRES_SQL`, id `postgres-sql`), memindahkan dataset ke id baru itu, membuang password terenkripsinya, dan menghapus hak menu `data.warehouse`. `020` (Laporan PDF) men-drop tabel `dor_delivery`, `dor_distribution`, `dor_recipient`, `dor_report_artifact`, `dor_report_template_version`, `dor_report`, `dor_report_template` **hanya bila kosong dan tidak dirujuk tabel lain**, serta menghapus hak menu `report.*` selain `report.operasional`; `dor_setting` tetap (dipakai akses data). `021` menambah tabel akses data (`dor_user_access`, `dor_dataset_org_validation`). Baris `dor_setting` `dashboard.config` dari modul Dashboard yang sudah dihapus dibiarkan apa adanya (tidak dibaca lagi; data tidak diubah).
- Cek: `psql -h <DOD_DB_HOST> -U <DOD_DB_USER> -d dod_application_sit -c "SELECT name, applied_at FROM dor_migration ORDER BY name"`.
- Admin pertama dibuat dari `DOD_ADMIN_USERNAME` / `DOD_ADMIN_PASSWORD` hanya bila tabel `dor_user` kosong.

## 4. Backup

Format custom (`-Fc`) dapat dicek dan di-restore sebagian. Simpan di luar repository dengan izin baca terbatas, dan jangan menimpa backup lama. Pakai `pg_dump` dengan versi mayor yang sama atau lebih baru daripada server.

```powershell
$dir = 'D:\DODMinimal-backups'; New-Item -ItemType Directory -Force $dir | Out-Null
$f = Join-Path $dir "dod_application_sit-$(Get-Date -Format yyyyMMddTHHmmss).dump"
pg_dump -h <DOD_DB_HOST> -p <DOD_DB_PORT> -U <DOD_DB_USER> -d dod_application_sit -Fc -Z6 -f $f
pg_restore -l $f | Select-String 'TABLE DATA' | Measure-Object    # sama dengan jumlah tabel di bawah
psql -h <DOD_DB_HOST> -U <DOD_DB_USER> -d dod_application_sit -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
Get-FileHash $f -Algorithm SHA256
```


## 5. Restore

Selalu uji di database sementara dulu, jangan langsung ke database aktif:

```powershell
createdb -h <host> -U <superuser> -O <DOD_DB_USER> dodmin_restore_check
pg_restore -h <host> -U <superuser> -d dodmin_restore_check --no-owner --role=<DOD_DB_USER> --exit-on-error <file.dump>
psql -h <host> -U <DOD_DB_USER> -d dodmin_restore_check -c "SELECT count(*) FROM dor_dataset"
```

Mengganti database aktif (setelah uji benar): hentikan DOD API (service `DODMIN-API` atau `run.ps1`), ganti nama `dod_application_sit` menjadi `dod_application_sit_old_<tanggal>` (jangan di-drop), buat `dod_application_sit` baru dari dump dengan `pg_restore` di atas, jalankan DOD API (migrasi yang belum ada akan diterapkan), lalu cek login dan beberapa halaman. Hapus database lama hanya setelah hasilnya diterima.
