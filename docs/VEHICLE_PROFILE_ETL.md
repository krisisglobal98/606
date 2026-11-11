# Pengisian Data Kartu Kendaraan

Panduan mengisi semua tab Kartu Kendaraan (Analisis → Data Profil → Jenis profil: Kendaraan). Ikuti pola ini saat menambah sumber data atau memperluas ke kebun lain. Rincian tampilan ada di [DATA_PROFILE.md](DATA_PROFILE.md).

Pilot: kebun **PSA**, database `dor_apims_psa`, data dummy Oktober 2026.

## 1. Aturan yang tidak boleh dilanggar

1. **Hanya data nyata dari sumber.** Jangan mengisi angka perkiraan, contoh, atau rumus pengganti. Tab tanpa sumber harus tampil kosong dan menjelaskan apa yang belum ada.
2. **Sumber hanya dibaca.** `dor_apims_master` dan `dor_apims_<alias>` tidak pernah ditulis. ETL hanya menulis ke tabel DOD di database aplikasi.
3. **Input administrator tidak boleh tertimpa.** Baris ETL ditandai `sumber` berawalan `ETL:`. Baris lain dianggap input manusia dan dilewati.
4. **ETL harus aman dijalankan berulang.** Baris milik ETL diganti, dan bulan yang hilang dari sumber ikut dihapus.
5. **Selalu dry-run dulu,** dan cocokkan totalnya dengan kueri langsung ke sumber sebelum menulis.

## 2. Menentukan database: tabel `dor_company_db`

Setiap perusahaan punya database sendiri, `dor_apims_<companyAlias>` dalam huruf kecil. `companyAlias` berasal dari `ms_company` di `dor_apims_master`.

| Kolom | Isi |
|---|---|
| `company_id` | `ms_company.id` |
| `company_code`, `company_name`, `company_alias` | Salinan dari `ms_company` |
| `database_name` | `dor_apims_<alias>`; kosong bila alias kosong |
| `db_exists` | Apakah database itu benar-benar ada di server |
| `synced_at` | Waktu sinkron terakhir |

Alur API: kendaraan → `ms_vehicle.businessunit_id` → `ms_businessunit.company_id` → `dor_company_db`. Bila perusahaan tidak ada di tabel, API memakai aturan lama, yaitu token pertama kode unit (`server/src/profile/unitSource.ts`).

Yang perlu diketahui:
- Satu alias bisa dimiliki dua baris perusahaan (PSA: `A05` dan `R07`). Keduanya menunjuk database yang sama, jadi ETL menggabungkan keduanya.
- Per 2 November 2026 ada 151 perusahaan aktif, dan 116 di antaranya punya database.
- Tabel terisi otomatis saat pertama dipakai bila masih kosong. Setelah ada perubahan di `ms_company`, jalankan `map --sync` (bagian 5).

Kode: `server/src/profile/companyDb.ts`.

## 3. Sumber data per tab

Status di bawah adalah kondisi `dor_apims_psa` setelah data dummy diisi. Semua 91 kendaraan PSA terisi untuk Oktober 2026.

| Tab | Isi | Sumber sekarang | Cara | Sumber saat live |
|---|---|---|---|---|
| **Profil** | Identitas, kepemilikan, dokumen | `ms_vehicle`, `ms_vehiclegroup`, `ms_uom`, `ms_vehiclemodel` | Baca langsung | Sama. Meter kosong bila `km_hm_*` di master bernilai 0; meter nyata ada di tab KPI |
| **KPI**, **Kegiatan** | Pemakaian, trip, muatan, jam, PA, per kode kegiatan | `TractionWorkshop.tr_tractionvehicleactivity` + `detail`, `ms_jobcode` | Baca langsung | Sama |
| **KPI**, operator | Nama operator dan jumlah hari | `TractionWorkshop.tr_tractionpremi` | Baca langsung | Sama |
| **Biaya**, UPAH | Premi operator dan helper | `tr_tractionpremi.grandtotalpremi` | ETL | Sama; gaji pokok belum termasuk |
| **Biaya**, BBM, OLI, SPAREPART, BAN | Pemakaian material per kendaraan | `dod_dummy.material_record` | ETL | Tabel material record APIMS |
| **Biaya**, BENGKEL, SERVICE_LUAR, PAJAK, PENYUSUTAN, SEWA | Biaya lain | `dod_dummy.vehicle_other_cost` | ETL | Belum ditentukan |
| **Work Order** | Riwayat bengkel | `TractionWorkshop.tr_workorder` + `tr_workorderdetailvehicle` | Baca langsung | Sama |
| **Keputusan**, nilai buku, tarif, standar | Kartu kendaraan | `dod_dummy.vehicle_asset` → `dor_vehicle_card` | ETL | Belum ditentukan |
| **Profil Blok**, budget produksi | `SUM(produksi_harian)` ÷ 1000 per blok per bulan | `DO_PIMS_REPORT.data_budget.budget_produksi_harian` | Baca langsung | Tabel yang sama |

**Mengapa KPI, Kegiatan, dan Work Order tidak di-ETL:** tab ini dibaca langsung agar selalu mutakhir dan tidak ada salinan data. ETL hanya untuk tabel DOD yang memang menyimpan angka.

### Catatan ETL

- **UPAH bukan upah penuh.** Yang dihitung hanya premi; gaji pokok sopir tidak ada di tabel ini.
- **Penanda:** biaya memakai `sumber` berawalan `ETL:`, kartu memakai `keterangan` berawalan `ETL:`. Baris tanpa penanda dianggap input manusia dan tidak disentuh.
- **Kendaraan yang tidak ada di master** untuk perusahaan itu dihitung sebagai `unknownVehicles` dan tidak ditulis.
- **Peringatan di layar:** biaya dari `dod_dummy` menampilkan keterangan bahwa datanya dummy. Bila hanya premi yang terisi, tab memperingatkan bahwa total biaya lebih rendah dari sebenarnya.

## 4. Data dummy PSA

**Semua data `dor_apims_psa` saat ini dummy** dan tidak boleh dipakai untuk keputusan. Data asli masuk saat aplikasi live.

Skrip pengisinya (`psa-dummy.ts`) sudah dikeluarkan dari project dan diarsipkan di folder karantina cleanup (`D:\DODSourceMinimal_removed\cleanup\phase3\removed\server\scripts\profile\psa-dummy.ts`). Baris dummy yang pernah ditulisnya **masih ada** di `dor_apims_psa`. Untuk menghapusnya, kembalikan skrip itu ke `server/scripts/profile/` lalu jalankan `remove` dengan target eksplisit (`$env:PSA_DUMMY_DB = 'dor_apims_psa'`; `node --env-file=../.env scripts/profile/psa-dummy.ts remove`). Hanya `dor_apims_psa` yang boleh disentuh; master hanya dibaca.

Yang pernah ditulis:

| Tempat | Isi | Hasil |
|---|---|---|
| Skema `dod_dummy` | `material_record`, `vehicle_other_cost`, `vehicle_asset` | 1.307, 194, dan 91 baris |
| `TractionWorkshop`, remark `DUMMY DATA - DOD KENDARAAN` | Aktivitas, detail, dan premi kendaraan yang belum punya; work order | 1.501, 1.501, 820, dan 93 baris |

Untuk Profil Blok, skrip juga mengisi pemupukan blok TM dan TBM yang belum punya, di `FieldOperation` dengan remark `DUMMY DATA - DOD PUPUK`: material asli dari katalog (Urea dan MOP untuk TM, NPK untuk TBM) dengan dosis 0,5 sampai 2 kg per pokok. Karena data dummy hanya sebulan, semua blok tercatat dipupuk pada Oktober; di lapangan pemupukan dilakukan bergilir.

Skema terpisah dipakai untuk tabel yang belum ada di APIMS, supaya tidak bercampur dengan tabel aplikasi. Baris yang tidak ditulis skrip ini tidak diubah. Hasilnya selalu sama setiap dijalankan.

**Patokan kewajaran** yang dipakai skrip (`PROFILE`):

| Kelompok | Konsumsi BBM | Pemakaian per hari kerja | Harga perolehan |
|---|---|---|---|
| Dump Truck | 0,28 sampai 0,38 L/km | 80 sampai 170 km | Rp 480 sampai 620 juta |
| Mobil | 0,09 sampai 0,13 L/km | 60 sampai 140 km | Rp 290 sampai 420 juta |
| Bus Sekolah | 0,20 sampai 0,26 L/km | 55 sampai 90 km | Rp 380 sampai 520 juta |
| Tractor | 6 sampai 8,5 L/jam | 5 sampai 8 jam | Rp 620 sampai 860 juta |
| Excavator | 12 sampai 16 L/jam | 5 sampai 8 jam | Rp 1,35 sampai 1,75 miliar |
| Road Grader | 12 sampai 15 L/jam | 4 sampai 7 jam | Rp 2,1 sampai 2,6 miliar |
| Compactor | 8 sampai 10,5 L/jam | 4 sampai 7 jam | Rp 1,25 sampai 1,55 miliar |
| Backhoe Loader | 7 sampai 9,5 L/jam | 4 sampai 7 jam | Rp 980 juta sampai 1,25 miliar |
| Genset | 5 sampai 12 L/jam | 8 sampai 14 jam | Rp 180 sampai 420 juta |
| Waterpump | 2,5 sampai 4 L/jam | 4 sampai 8 jam | Rp 45 sampai 95 juta |

Harga: solar Rp 14.500/liter, oli Rp 42.000/liter, mekanik Rp 85.000/jam. Servis berkala setiap 5.000 km atau 250 jam; kerusakan lebih sering pada unit tua; penyusutan garis lurus 96 bulan dengan nilai sisa 10%. Patokan ini asumsi saya, bukan angka resmi perusahaan.

**Saat data asli masuk:** jalankan `psa-dummy.ts remove` (kembalikan dulu dari karantina, lihat di atas), arahkan kueri `readCosts` dan pembacaan kartu di `vehicleEtl.ts` ke tabel asli, lalu jalankan ETL lagi. Baris ETL lama otomatis terganti atau terhapus.

## 5. Menjalankan

Dari folder `server/`:

```bash
node --env-file=../.env scripts/profile/vehicle-etl.ts map                          # lihat mapping, tanpa menulis
node --env-file=../.env scripts/profile/vehicle-etl.ts map --sync                   # simpan ke dor_company_db
node --env-file=../.env scripts/profile/vehicle-etl.ts run --company PSA --dry-run  # lihat dampak, tanpa menulis
node --env-file=../.env scripts/profile/vehicle-etl.ts run --company PSA            # jalankan
node --env-file=../.env scripts/profile/vehicle-etl.ts run --company PSA --period 2026-10
```

`run` tanpa `--dry-run` menjalankan migrasi yang tertunda, menyinkronkan mapping, lalu menulis dalam satu transaksi. Setiap proses tercatat di `dor_etl_run`.

ETL belum terjadwal. Pilot dijalankan manual.

Untuk mengembalikan hasil ETL di database aplikasi:

```sql
DELETE FROM dor_vehicle_cost WHERE sumber LIKE 'ETL:%';
DELETE FROM dor_vehicle_card WHERE keterangan LIKE 'ETL:%';
```

## 6. Memperluas ke kebun lain

1. `map`: pastikan `db_exists` bernilai true untuk alias kebun itu.
2. Periksa apakah datanya asli atau dummy:
   ```sql
   SELECT remark, count(*) FROM "TractionWorkshop".tr_tractionvehicleactivity GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
   ```
3. `run --company <ALIAS> --dry-run`.
4. Cocokkan `total` dengan sumber:
   ```sql
   SELECT sum(grandtotalpremi) FROM "TractionWorkshop".tr_tractionpremi WHERE is_active AND NOT is_deleted;
   ```
5. Pastikan `unknownVehicles` bernilai 0, atau jelaskan penyebabnya.
6. `run --company <ALIAS>`, lalu buka Kartu Kendaraan dan periksa minimal satu kendaraan di setiap tab.

## 7. Menambah sumber biaya baru

Saat tabel material record asli atau sumber lain sudah ada:

1. Pastikan datanya bisa dihubungkan ke `ms_vehicle.id` dan punya tanggal serta nilai rupiah.
2. Ganti atau tambahkan pembacaan di `readCosts` (`server/src/profile/vehicleEtl.ts`), dengan `kategori` dari `COST_CATEGORIES` di `ops.ts` dan `sumber` berawalan `ETL:` yang menyebut tabel asalnya.
3. Pertahankan aturan: lewati baris manual, hapus baris ETL yang hilang dari sumber, dan tulis dalam satu transaksi.
4. Tambahkan kasusnya di `server/test/vehicleEtl.integration.test.ts`.
5. Perbarui tabel di bagian 3.

## 8. Pengujian

```bash
cd server && DOD_TEST_PG_HOST=/tmp node --env-file-if-exists=../.env --test test/vehicleEtl.integration.test.ts
```

Test membuat database sementara (aplikasi, master, dan unit), lalu menghapusnya kembali. Yang diuji: mapping, dry-run tanpa menulis, hasil yang sama saat dijalankan ulang, input manual yang tetap utuh, penghapusan data yang hilang dari sumber, kartu dan budget, serta penolakan perusahaan tanpa database.
