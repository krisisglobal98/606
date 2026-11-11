# Dokumentasi DOD Minimal

## Mulai di sini

| Dokumen | Isi |
|---|---|
| [SETUP.md](SETUP.md) | Prasyarat, `.env`, database lokal, menjalankan, mengatasi masalah; pemisahan dari instalasi DOD lengkap |
| [CONFIGURATION.md](CONFIGURATION.md) | Semua variabel environment beserta nilai bawaannya |

## Operasional

| Dokumen | Isi |
|---|---|
| [DATABASE_CONNECTION.md](DATABASE_CONNECTION.md) | Database aplikasi vs sumber, variabel koneksi, jaminan baca-saja, kode error |
| [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md) | Topologi database, membuat database, migrasi, backup, restore |
| [DEPLOYMENT_WINDOWS.md](DEPLOYMENT_WINDOWS.md) | Deployment Windows Server / IIS (service `DODMIN-API`, `D:\DODMinimal`) |
| [SECURITY.md](SECURITY.md) | Secret, akses baca-saja, autentikasi, CSP, reverse proxy, logging |
| [USERS_AND_ACCESS.md](USERS_AND_ACCESS.md) | Peran, pengguna, master organisasi, Hak Akses Menu |
| [DATA_ACCESS.md](DATA_ACCESS.md) | Akses data per pengguna (cakupan organisasi), penjaga backend, audit |

## Modul

| Dokumen | Isi |
|---|---|
| [DATA_MODULE.md](DATA_MODULE.md) | Menu Data: halaman dan statusnya |
| [DATA_WAREHOUSE.md](DATA_WAREHOUSE.md) | Koneksi dari `.env`, penemuan metadata, API Data Warehouse |
| [DATASET_ARCHITECTURE.md](DATASET_ARCHITECTURE.md) | Model semantik dataset dan query analitik |
| [DATA_PROFILE.md](DATA_PROFILE.md) | Kartu Data Profil di Analisis (Profil Blok, Kartu Kendaraan) |
| [VEHICLE_PROFILE_ETL.md](VEHICLE_PROFILE_ETL.md) | Pengisian data Kartu Kendaraan (sumber, ETL, data contoh) |
| [REPORT_MODULE.md](REPORT_MODULE.md) | Report: Laporan Operasional |
| [I18N.md](I18N.md) | Bahasa aplikasi (Indonesia / English) |
| [DESIGN_REFERENCE.md](DESIGN_REFERENCE.md) | Referensi desain dan token tampilan |
| [REAL_DATA_TESTING.md](REAL_DATA_TESTING.md) | Langkah uji dengan sumber nyata dan angka acuan performa |

## Lain-lain

- `brand/`: logo resmi DOD dan skrip pembuat ikon turunan (`dod_logo.py`).
- `sql/dor_apims_master/`: skrip GRANT baca-saja master organisasi untuk DBA (lihat [DATA_ACCESS.md](DATA_ACCESS.md)).
