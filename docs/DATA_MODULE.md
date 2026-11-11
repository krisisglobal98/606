# Modul Data

Menu **Data** (`/data`) berisi **Set Data**: dataset dengan pemetaan semantik di atas tabel database sumber, beserta kategorinya. Data selalu dibaca langsung dari sumber (baca-saja); DOD tidak menyalin data.

```
.env server (DOD_DW_CONNECTIONS) ──► Koneksi sumber ──► Dataset (+ Kategori) ──► Analisis, Report
```

**Koneksi sumber hanya diatur di file `.env` server** (`DOD_DW_CONNECTIONS` dan `DOD_DW_<PREFIX>_*`, lihat [CONFIGURATION.md](CONFIGURATION.md#sumber-data-warehouse-hanya-dari-env)). Tidak ada halaman maupun API untuk menambah, mengubah, menghapus, atau menguji koneksi, dan browser tidak pernah menerima host, nama database, akun, atau password koneksi.

## Halaman

| Rute | Halaman | Isi |
|---|---|---|
| `/data/dataset` | Set Data | Daftar dataset, ringkasan, hapus |
| `/data/dataset/new` | Buat dataset | Pilih koneksi (nama saja) dan schema, pilih 1–4 tabel, usulan pemetaan semantik (bisa diubah), simpan |
| `/data/dataset/:id` | Detail dataset | Sumber (nama koneksi, schema, tabel), field, pemetaan (bisa diubah), *Buka di Analisis* |
| `/data/categories` | Kategori | Pengelompokan dataset (bertingkat) |

Alamat lama `/data/warehouse/*` (Gudang Data) dan `/data/mapping`, `/data/transformation`, `/data/flow`, `/data/quality` (Pemetaan Data, Transformasi, Alur Data, Mutu Data; dulu hanya halaman *belum terhubung*) dialihkan ke `/data/dataset`.

## Hak akses

- Membaca daftar dataset dan katalog: semua pengguna yang login.
- Membuat, mengubah, menghapus dataset dan kategori; membaca daftar koneksi (nama dan jenis) serta schema/tabel/kolom sumber untuk membangun dataset: admin dan analyst, dengan menu *Set Data* (`data.dataset`).
- Menu dan sub-menu dapat dimatikan per peran: [USERS_AND_ACCESS.md](USERS_AND_ACCESS.md#hak-akses-menu).

## Kode

| Bagian | Lokasi |
|---|---|
| Halaman | `src/pages/data/` (`DataLayout.tsx`, `Dataset/`, `Warehouse/CreateDatasetPage.tsx`, `Warehouse/WarehouseDatasetPage.tsx`, `Warehouse/MappingEditor.tsx`) |
| Service frontend | `src/services/warehouse/dataWarehouseService.ts`, `src/services/dataset/` |
| Komponen bersama | `src/components/data/` (`StatusBadge`/status), `src/components/warehouse/` |
| Backend | `server/src/dw/` (koneksi dari `.env`, metadata per jenis database, pool baca-saja), `server/src/datasets/` (model semantik), `server/src/categories/` |

Rincian teknis:
- Koneksi, metadata, API: [DATA_WAREHOUSE.md](DATA_WAREHOUSE.md)
- Model dataset dan query analitik: [DATASET_ARCHITECTURE.md](DATASET_ARCHITECTURE.md)
- Variabel koneksi dan jaminan baca-saja: [DATABASE_CONNECTION.md](DATABASE_CONNECTION.md)
