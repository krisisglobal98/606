# Menyusun laporan seperti sheet Excel Traksi

Panduan untuk analyst dan admin yang menyusun laporan Traksi (DR_Traksi.xlsx: R, ST, RH, MP, HKE, WS, DT_S, …) di DOD.
Semua langkah dilakukan di **Analisis**, lalu **Simpan Laporan**. Pengguna lain membuka hasilnya di **Laporan**.

## 1. Tanggal laporan, H.I, dan S.D.H.I

- **Filter → Tanggal laporan**. Kalau dibiarkan kosong (otomatis), tanggal laporan = tanggal akhir periode, paling lambat
  hari ini. Laporan tersimpan selalu dibuka dengan periode bulan berjalan dan tanggal laporan otomatis.
- **Layout → menu ⋮ pada ukuran → Kolom yang ditampilkan**:
  - **H.I**: nilai pada tanggal laporan.
  - **S.D.H.I**: tanggal 1 bulan tanggal laporan s.d. tanggal laporan.
  - **S.D. Tahun Ini**: 1 Januari s.d. tanggal laporan.
  - **Nilai**: periode filter.
- Satu ukuran bisa tampil dalam beberapa kolom sekaligus, tanpa dataset ganda. Rasio (availability, HKE %, fuel ratio)
  dihitung dari pembilang dan penyebut pada jendela yang sama, bukan dari rata-rata harian.
- Header tabel menyebut tanggal laporan yang dipakai.

## 2. Header bertingkat ("STATUS HARIAN UNIT" di atas B/S/R × H.I/S.D.H.I)

Di **Layout**, kelompokkan ukuran dengan **Measure Group**, lalu beri nama grupnya. Hasilnya tiga baris header:
grup → ukuran → kolom (H.I / S.D.H.I).

## 3. Tanggal sebagai kolom (sheet RH, MP, HKE, WS, DT..LB)

**Tabel Hasil → Kolom → Hari**. Setiap tanggal (1–31) menjadi kolom dan **Total** tampil di ujung kanan. Dimensi lain
juga bisa dijadikan kolom, misalnya status atau sub group, paling banyak 100 kolom.

## 4. Ukuran sebagai baris (sheet R)

Untuk tabel tanpa dimensi baris (satu baris total), nyalakan **Ukuran sebagai baris**:
- setiap ukuran menjadi satu baris dengan satuan dan desimalnya sendiri;
- kolomnya H.I / S.D.H.I / Nilai;
- Measure Group menjadi subjudul baris, misalnya Man Power → Workshop / Traksi / Total.

## 5. Jenis ukuran (Data → Set Data → Ubah pemetaan)

| Jenis | Kegunaan |
|---|---|
| SUM + **syarat** | hanya baris dengan nilai dimensi tertentu yang dihitung, misalnya Status = B, tanpa kolom turunan di DW |
| Snapshot, **nilai tanggal terakhir** | status harian (unit standby/rusak pada tanggal laporan, termasuk 0); "nilai terbesar" untuk luas atau jumlah pokok |
| **Hitung unik** | jumlah nilai unik, misalnya JUMLAH UNIT; subtotalnya dihitung ulang, bukan dijumlahkan |
| **Anggaran prorata** | ANG. S.D.H.I = anggaran sebulan × hari kerja s.d. tanggal laporan ÷ hari kerja sebulan; butuh ukuran SUM anggaran dan ukuran SUM hari kerja (kalender kerja) |

- **Kunci urut** pada dimensi: kolom angka (misalnya `urutan`) yang menentukan urutan baris, terpisah dari labelnya.
- **Muat ulang kolom**: membaca ulang kolom tabel sumber setelah tim data menambah kolom (ANALYZE tidak perlu).
- **Layout → Format → Skala tampilan**: ribuan ("Rp 000") atau jutaan, tanpa membuat ukuran baru.

## 6. Filter dan parameter

- Filter nilai: pilih satu nilai, atau isi **"atau berisi teks…"** (misalnya `DT-0`, tanpa membedakan huruf besar-kecil).
  Batasan data tetap bisa memilih beberapa nilai.
- Header laporan menampilkan **parameter** yang aktif (PT, GMK, sub group, unit) dan tanggal laporan.

## 7. Mengubah laporan dan ekspor

- **Laporan → Ubah di Analisis** (pembuat laporan atau admin) → ubah layout → **Simpan Laporan → Perubahan pada
  laporan …**. ID laporan tetap, jadi tautan ke laporan itu tetap berfungsi.
- **Ekspor Excel**: .xlsx dengan tata letak seperti di layar (header bertingkat tergabung, total, panel beku).
- **Cetak / PDF**: tabel saja, semua baris, orientasi lanskap. Pilih "Simpan sebagai PDF" di dialog cetak.

## 8. Syarat data

Setiap tabel atau view wajib punya kolom `business_unit` berisi kode PIMS. Pengguna level Rayon, Divisi, atau
Kepemilikan butuh kolom rayon/divisi/kepemilikan. Rincian ada di
`D:\DODSourceMinimal_removed\traksi\PERINTAH_TIM_DATA_TRAKSI.md` dan [DATA_ACCESS.md](DATA_ACCESS.md).
