# Akses Data: Level Akses, Assignment, dan Filtering Laporan

Implementasi Phase 4 (2026-11-10), berdasarkan keputusan pemilik proyek K-01 s.d. K-14. Dokumen audit, keputusan, dan rencana implementasinya (`ORG_SCOPE_*.md`) diarsipkan di luar project (folder karantina cleanup); dokumen ini yang berlaku.

Semua laporan, tabel, pilihan nilai, dan Data Profil hanya menampilkan data dalam cakupan pengguna yang login. Pembatasan dilakukan di **backend**. Frontend hanya menampilkan hasilnya.

---

## 1. Model keamanan

| Hal | Diatur oleh | Memberi data? |
|---|---|---|
| Identitas dan login | `dor_user` (DOD sendiri; Phase 1) | tidak |
| Peran aplikasi (`admin`, `analyst`, `publisher`, `viewer`) | `dor_user.role` | **tidak**. Admin mengelola aplikasi, tetapi tanpa assignment tidak melihat data |
| Assignment akses data | `dor_user_access` (pengelola akses data) | **ya**, hanya cakupannya |
| Hak khusus `unrestricted_data` | `.env` `DOD_DATA_UNRESTRICTED_USERS` | ya, semua data, dan dicatat di audit |
| Pengelola akses data | `.env` `DOD_DATA_ACCESS_MANAGERS` | tidak. Boleh mengubah assignment pengguna **lain**, tidak pernah miliknya sendiri |

Prinsip:
- **Fail-closed.** Pengguna tanpa assignment, dengan assignment tidak valid, master organisasi tidak tersedia, atau dataset tidak standar tidak mendapat data. Tidak pernah ada fallback ke akses global.
- **PIMS hanya dibaca.** `dor_apims_master` dibaca dengan akun DOD yang sudah ada (`dodmin`), yang di sana hanya diberi SELECT, dalam sesi READ ONLY. Tidak ada salinan master, dan pengguna PIMS tidak dipakai sebagai identitas.

## 2. Sembilan level

| # | Level | Assignment (id PIMS) | Data yang terlihat |
|---:|---|---|---|
| 1 | Kepemilikan | organisasi level 2–7 **dan** kategori (`INTI/PLASMA/KKPA`), dalam **satu** assignment | BU organisasi itu **AND** kolom kepemilikan ∈ kategori |
| 2 | Group | `ms_group.id` | BU semua company dengan `group_id` itu |
| 3 | Wilayah Administrasi | `ms_so_node.id` dari daftar `DOD_ORG_WILAYAH_NODE_IDS` | BU node (`ms_so_node_businessunit`) |
| 4 | Region | `ms_region.id` (`DOD_ORG_REGION_SOURCE=ms_region`) atau `ms_so_node.id` struktur REGION (`so_region`) | BU company region itu / BU node |
| 5 | GMK | `ms_gmk_header.id` dari daftar `DOD_ORG_GMK_HEADER_IDS` | BU `ms_gmk_detail` |
| 6 | Perusahaan | `ms_company.id` | BU dengan `company_id` itu |
| 7 | Unit Operasional | `ms_businessunit.id` | BU itu |
| 8 | Rayon | pasangan (`ms_businessunit.id`, `ms_rayon.id`) | BU itu **AND** kolom rayon. Tanpa kolom rayon: **tidak ada data** (notifikasi field tidak lengkap) |
| 9 | Divisi | pasangan (`ms_businessunit.id`, `ms_division.id`) | BU itu **AND** kolom divisi. Tanpa kolom divisi: **tidak ada data** (notifikasi field tidak lengkap) |

**Field tidak lengkap (keputusan pemilik 2026-11-12).** Bila dataset tidak memiliki kolom yang menjadi dasar level akses pengguna (Unit Operasional untuk semua level; Kepemilikan, Rayon, atau Divisi untuk level itu), data tidak ditampilkan dan pengguna mendapat notifikasi `403 ACCESS_FIELD_MISSING`: "Data tidak dapat dilihat karena field … pada dataset ini tidak lengkap, sehingga Anda tidak memiliki otoritas untuk melihat data ini." Tidak pernah ada pelebaran ke unit induk. Pada dataset multi-sumber, sumber yang tidak memiliki kolom rayon/divisi tidak memberi baris untuk grant Rayon/Divisi (mis. kolom budget kosong). Grant lain milik pengguna yang kolomnya ada tetap berlaku.

Aturan:
- **Satu pengguna, banyak assignment.** Hasilnya gabungan grant. Bagian-bagian grant **tidak pernah dicampur**: FRG+PLASMA dan SAM+INTI tidak menghasilkan FRG+INTI.
- **Hanya baris aktif.** Yang dihitung hanya baris master yang aktif (`is_active AND NOT is_deleted`, dan dalam `valid_from`/`valid_to` bila terisi). Organisasi yang dinonaktifkan di PIMS langsung tidak memberi data lagi, paling lambat setelah masa berlaku cache.
- **Relasi BU–divisi bukan bukti akses.** `ms_businessunitdivision` hanya dipakai sebagai peringatan di form (K-07a), tidak untuk memberi atau menolak akses.
- **Level yang sumbernya belum ditetapkan tidak bisa dipakai.** Ini berlaku untuk Region, Wilayah, dan GMK: form menonaktifkannya dan resolver menolaknya.
- **Akses diputuskan sebelum sumber disentuh.** Query, grid, dan nilai filter memeriksa cakupan pengguna terhadap dataset lebih dulu (penolakan diaudit), baru kemudian membaca metadata tabel sumber. Pengguna yang ditolak tidak pernah memicu akses ke sumber dan tidak melihat kondisi koneksinya (`server/src/analytics/analyticsService.ts`, `context()`).

## 3. Dataset

Status per dataset dihitung otomatis dari model semantiknya (`server/src/dataAccess/datasetOrg.ts`) dan hasil validasi nilai.

| Status | Syarat | Pengguna berlevel |
|---|---|---|
| OK | kolom BU (`business_unit` atau `kodebisnisunit`, **satu** dimensi) ada di **setiap** sumber, dan semua nilai = `ms_businessunit.code` | data difilter |
| PARTIAL | seperti OK, tetapi sebagian baris tanpa BU valid (kode perusahaan, BU kosong) | data difilter; baris tanpa BU valid **tersembunyi**, dan UI menampilkan persentasenya |
| UNVERIFIED | belum ada validasi untuk versi dataset ini (`updated_at`) | tidak ada data |
| FAILED | tidak satu pun nilai BU cocok dengan master | tidak ada data |
| NONPIMS | kolom unit bukan kode PIMS (`kebun_id`, `unit_id`, …) | tidak ada data |
| NONE | tanpa kolom BU, atau salah satu sumber tanpa BU | tidak ada data; notifikasi field tidak lengkap (`ACCESS_FIELD_MISSING`) untuk semua level |

- **Konsistensi (K-09).** Kolom Group (`groupcode`), Region (`regioncode`), dan Company (`company` = alias, `companycodeora` = kode Oracle) yang ada di suatu sumber wajib cocok dengan master untuk BU baris itu. Baris yang tidak cocok tersembunyi; nilai NULL tidak diperiksa.
- **Notifikasi.** Untuk level 1–4, 6, dan 7: *"Tabel belum standar dan tidak memiliki parameter default untuk pembatasan akses data."* Untuk level 5, 8, dan 9: *"Data tidak tersedia untuk cakupan akses Anda."*
- **Validasi.** `POST /api/dw/datasets/:id/org-validation` (admin/analyst) menghitung baris per nilai BU di setiap sumber dan membandingkannya dengan master. Hasilnya disimpan di `dor_dataset_org_validation`. Validasi wajib diulang setiap kali dataset diubah, karena versinya ikut `updated_at`.

## 4. Penerapan di backend

| Jalur | Penerapan |
|---|---|
| `POST /api/dw/analytics/query` (KPI, chart, tabel) | `SqlBuilder`: predikat di `src_r` **setiap** sumber, sebelum snapshot, `GROUPING SETS`, jendela periode, dan `FULL JOIN` |
| `POST /api/dw/analytics/grid` (pivot, hierarchical grid, drilldown, paging, jumlah baris) | sama |
| `GET /api/dw/datasets/:id/values` (pilihan nilai, pencarian) | predikat di setiap `SELECT DISTINCT`; kunci cache memuat sidik cakupan |
| `GET /api/dw/catalog` | status akses per dataset; coverage dihitung dari baris dalam cakupan saja |
| Laporan Operasional | dijalankan lewat `grid` dengan cakupan **pembuka** laporan |
| Data Profil `/api/profile/*` | daftar difilter id BU (dan rayon/divisi/kepemilikan blok); setiap endpoint berbasis id memeriksa record dulu, dan di luar cakupan hasilnya **404**; PUT butuh admin **dan** cakupan |
| Metadata kolom (`pg_stats`) | contoh nilai hanya untuk pemegang `unrestricted_data` |
| Export | tidak ada endpoint; file dibuat di browser dari respons yang sudah difilter |

Filter dari browser (`scope`, `filters`, `path`) hanya di-AND dengan predikat, sehingga tidak pernah memperluas cakupan. `AggregateRequest.scope` wajib; build tanpa scope menghasilkan `500 SCOPE_MISSING`.

**Respons penolakan:**

| Kode | HTTP | Arti |
|---|---:|---|
| `SCOPE_UNRESOLVED` | 403 | tanpa assignment / semua assignment tidak valid (termasuk admin tanpa assignment) |
| `DATASET_NOT_STANDARD` | 409 | dataset tidak standar untuk level pengguna (`details.notify`, `details.status`) |
| `ORG_MASTER_NOT_CONFIGURED` / `ORG_MASTER_UNAVAILABLE` / `ORG_MASTER_ROLE_UNSAFE` | 503 | master tidak dikonfigurasi, tidak terjangkau, atau role tidak read-only |
| `PROFILE_NOT_FOUND` | 404 | record Data Profil tidak ada **atau** di luar cakupan (sengaja tidak dibedakan) |

## 5. Cache

| Cache | Kunci | Masa berlaku | Kegagalan |
|---|---|---|---|
| Snapshot organisasi | – | **tetap** `DOD_ORG_CACHE_SECONDS` (≤ 300 s) sejak dibaca, tanpa sliding; di menit terakhir umurnya, request memicu satu pembacaan ulang di latar belakang (request itu tetap memakai snapshot yang masih berlaku) | kedaluwarsa + master tidak terjangkau → 503; snapshot lama tidak pernah dipakai; gagal baca ulang di latar belakang → peringatan di log, snapshot berlaku dipakai sampai kedaluwarsa |
| Assignment | – | tidak di-cache: dibaca setiap request | perubahan berlaku pada request berikutnya |
| Nilai distinct / coverage | dataset + versi + field + q + **sidik cakupan** | 5 menit | – |
| Hasil Analisis / grid | dataset + versi + **sidik cakupan** + generasi snapshot + isi request | `DOD_RESULT_CACHE_SECONDS` (default 300 s, 0 = mati) | hak akses tetap dicek setiap request sebelum cache; gagal/ditolak tidak disimpan |
| Browser: katalog dan nilai filter | per sesi | dikosongkan setiap token atau pengguna berganti (login, logout, sesi berakhir) | – |

Tombol **Muat ulang master** (`POST /api/org/reload`) membuang snapshot, dan tindakan ini tercatat di audit.

## 6. Audit (`dor_audit`)

| Aksi | Kapan |
|---|---|
| `access.assignments.update` | assignment pengguna diganti (pelaku, target, sebelum/sesudah) |
| `data.unrestricted.grant` / `data.unrestricted.revoke` | daftar `DOD_DATA_UNRESTRICTED_USERS` berubah (dicatat saat API start) |
| `data.unrestricted.use` | pemegang `unrestricted_data` memakai datanya (paling sering sekali per jam per pengguna) |
| `data.denied` | request data ditolak guard (kode, target; paling sering sekali per 10 menit per pengguna, kode, dan target) |
| `dataset.org_validation` | validasi BU dataset |
| `org.reload` | snapshot master dibuang |

Password, token, dan secret tidak pernah dicatat.

## 7. Konfigurasi (`.env`, diisi pemilik server)

| Variabel | Isi |
|---|---|
| `DOD_ORG_DB_USER`, `DOD_ORG_DB_PASSWORD` | kosong = akun DOD yang sudah ada (`DOD_DB_USER` = `dodmin`, tanpa role baru). Tidak boleh `postgres` |
| `DOD_ORG_DB_HOST`, `_PORT`, `_NAME`, `_SSL` | default `DOD_DB_HOST`, `DOD_DB_PORT`, `DOD_DB_MASTER_NAME`, `DOD_DB_SSL` |
| `DOD_ORG_CACHE_SECONDS` | 0–300, default 300 |
| `DOD_ORG_REGION_SOURCE` | `ms_region` atau `so_region`; kosong = level Region tidak bisa dipakai |
| `DOD_ORG_WILAYAH_NODE_IDS` | id `ms_so_node` wilayah Direktur yang disetujui (koma) |
| `DOD_ORG_GMK_HEADER_IDS` | id `ms_gmk_header` yang disetujui (koma) |
| `DOD_DATA_UNRESTRICTED_USERS` | username pemegang `unrestricted_data` |
| `DOD_DATA_ACCESS_MANAGERS` | username pengelola akses data |

Saat pertama membaca master, API juga memeriksa role-nya. Role ditolak (fail-closed) bila superuser, punya hak tulis pada tabel mana pun, bisa membaca `ms_tenant` atau `ms_user_*`, atau bisa `CREATE` di skema.

## 8. Database

- Migrasi `021_user_access.sql` (database aplikasi) membuat `dor_user_access` dan `dor_dataset_org_validation`, dengan constraint bentuk per level, id angka, jenis organisasi per level, dan unik per assignment.
- Kolom lama `dor_user` (`level_code`, `*_code`, `ownership_code`) **tidak diubah** dan tidak dipakai lagi. Tabel `dor_org_*` (salinan lama) juga tidak dipakai lagi; datanya kosong dan dibiarkan.
- **Grant PIMS** (dijalankan DBA): [`docs/sql/dor_apims_master/`](sql/dor_apims_master/) berisi `01_preflight.sql` → `02_grant.sql` → `03_verify.sql`, dengan `04_rollback.sql` bila perlu.

## 9. Deployment

1. **Backup** database aplikasi (`pg_dump -Fc`), lalu verifikasi dengan `pg_restore --list` dan pembandingan jumlah baris.
2. Deploy rilis. Migrasi 021 berjalan saat API start dalam satu transaksi; bila gagal, transaksi di-rollback dan API tidak start.
3. Isi `.env`: `DOD_DATA_ACCESS_MANAGERS`, dan bila disetujui `DOD_DATA_UNRESTRICTED_USERS`, `DOD_ORG_REGION_SOURCE`, `DOD_ORG_WILAYAH_NODE_IDS`, `DOD_ORG_GMK_HEADER_IDS`. Restart API.
4. Cek **Settings → Pengguna**: kartu "Master organisasi PIMS" harus *Tersedia*.
5. Validasi dataset (admin/analyst): `POST /api/dw/datasets/:id/org-validation` per dataset yang dipakai.
6. Tetapkan assignment pengguna. Pengelola akses data mengerjakannya per pengguna, tidak pernah untuk dirinya sendiri.
7. Uji dengan akun berlevel: data hanya dalam cakupan. Admin tanpa assignment mendapat 403.

**Rollback aplikasi:** kembali ke rilis sebelumnya. Kolom lama `dor_user` tetap ada, dan tabel baru diabaikan versi lama. Bila perlu, pulihkan database dari backup. **Rollback grant:** `04_rollback.sql` (DBA).

## 10. Pengujian

| File | Isi |
|---|---|
| `server/test/dataAccessScope.test.ts` | 9 level, Kepemilikan AND, multiple assignment, pasangan Rayon/Divisi, fail-closed |
| `server/test/dataAccessGuard.test.ts` | status OK/PARTIAL/UNVERIFIED/FAILED/NONPIMS/NONE, notifikasi per level, predikat di setiap sumber sebelum agregasi dan `FULL JOIN`, bind parameter |
| `server/test/dataAccessService.test.ts` | cache tetap 5 menit (tanpa sliding, 503 saat kedaluwarsa dan master mati, refresh latar belakang di menit terakhir), admin tanpa assignment, `unrestricted_data`, pengelola akses, larangan mengubah assignment sendiri, audit, konfigurasi role |
| `server/test/dataAccessApi.integration.test.ts` | **API dipanggil langsung** + SQL nyata (tabel TEMP, transaksi di-rollback): semua level, Kepemilikan AND, fallback, multi-sumber, partial, K-09, manipulasi request, grid/paging, values, cache, katalog/coverage, audit penolakan |
| `server/test/dataAccessProfile.test.ts` | Data Profil anti-IDOR (6 endpoint berbasis id), PUT admin+cakupan, filter daftar; **inventaris route** (route baru gagal sampai diklasifikasikan) |
| `tests/userMeta.test.ts` | 9 level di UI sama dengan server; bentuk assignment |
