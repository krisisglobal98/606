# Data Profil (Analisis)

The **Data Profil** card on the Analisis page shows one record of the master data at a time. It sits on the left edge after **Hasil Analisis**. Collapsed, it is a vertical tab; opened, it appears right after Hasil Analisis. Inside the card the user first picks a **Kebun / Bisnis Unit**, then the **Jenis profil** below it (Blok or Kendaraan). The blocks or vehicles of that unit are then listed below the two dropdowns, and the chosen record's profile opens on the right. Everything stays inside the card and the page never navigates away. Data Profil and **Tabel Hasil** take turns: opening Data Profil hides Tabel Hasil, and collapsing Data Profil brings the table back. The card does not depend on the dataset. When there is no dataset, or its source cannot be reached, the card is offered below that message.

| Report | Picker | What it shows |
|---|---|---|
| **Profil Blok** (Jenis profil: Blok) | Every block of the unit, search by block code or name | Organisation path (company › unit › estate › rayon › afdeling), planting status, luas tanam and luas blok, umur tanam, pokok total and per ha, active TPH, share of productive palms, planting, land, palm population and area breakdown |
| **Kartu Kendaraan** (Jenis profil: Kendaraan) | Every vehicle of the unit, search by code, name, no. polisi or no. aset | Plate number, status and downtime, last KM/HM, year made, STNK validity (warning within 30 days, red when past), ownership, identity numbers, specification, dates and meter readings |

With a unit chosen the list holds every active record of that unit (up to 1,000; the largest unit has 800 blocks). Changing the unit clears the open records. The unit, the kind and the records are kept for the browser session.

## Profil Blok: Areal Statement

The kebun picker has a search box (code or name; arrows and Enter also work). The **Profil** tab of a block is its Areal Statement: indicators on top (Luas Areal, Luas Tanam, Persentase Luas Ditanam, Kerapatan Pokok, Persentase Pokok Sisipan), then Identitas Wilayah dan Blok, Data Luas Areal (rows without the repeated word Luas), Data Penanaman, Data Populasi Tanaman and Kondisi Operasional. Kerapatan is Jumlah Pokok per Luas Tanam; Persentase Pokok Sisipan is Pokok Sisipan over Jumlah Pokok; Umur is by calendar year. *Data yang belum tersedia* lists what has no source yet. The master holds some blocks twice under one id (SAM-1); the picker and its count show each block once.

## Tabs

Each record opens on its **Profil** tab (the master data above). The other tabs show one month. A *Periode* picker lists only the months that have data, newest first. The open tab and month are kept for the browser session.

| Profil Blok | Shows | Source (unit database, read-only) |
|---|---|---|
| **Produksi** | Tonase, janjang, brondolan, BJR, produktivitas per ha tanam, output per HK, AKP taksasi, panen harian, monthly trend, achievement against the budget | `FieldOperation.trx_harvest`, `trx_blockactivity` (modul PANEN), `trx_bjr_monthly`, `trx_taksasi_header`; budget from `dor_block_budget` |
| **Perawatan** | Upkeep activities (not harvest, loading or fertilising): luas, hasil, HK, hari, last date; materials used | `trx_blockactivity`, `trx_progress_header` + `trx_progress_material`; names from `ms_jobcode`, `mst_material_oracle` |
| **Pemupukan** | Fertilising activities with dose; fertiliser applied, total and per ha tanam | same tables, activities whose name contains *pupuk* |
| **Biaya** | Labour cost allocated to the block per activity: HK, Rp/HK, nilai, share; per ha tanam | `Keuangan.tr_costallocation` (target = block code) |

| Kartu Kendaraan | Shows | Source |
|---|---|---|
| **KPI** | Pemakaian (KM/HM), trip, muatan, jam operasi, Physical Availability, downtime, rasio BBM against its standard, biaya per ton; tarif aktual vs budget with its index; operators | `TractionWorkshop.tr_tractionvehicleactivity` + `…detail`, `tr_tractionpremi`; costs and standards from DOD |
| **Biaya** | Cost per category (BBM, oli, sparepart, ban, service luar, upah, bengkel, pajak/KIR, penyusutan, sewa) with share, Rp per KM/HM and a ring chart | `dor_vehicle_cost` (DOD) |
| **Kegiatan** | Usage per activity and its charge (usage × tarif aktual) | vehicle activity detail per job code |
| **Work Order** | Work orders of the month | `TractionWorkshop.tr_workorder` + `tr_workorderdetailvehicle` (empty in every unit today) |
| **Keputusan** | Cumulative repair cost (sparepart + ban + service luar + bengkel) ÷ nilai buku, and a recommendation | `dor_vehicle_cost`, `dor_vehicle_card` (DOD) |

Every unit has its own operational database on the application server, `dor_apims_<unit>`. The name comes from the first token of the business unit code (`AMS-Kebun1` → `dor_apims_ams`); when that database does not exist, the token without trailing digits is tried (`PISP2-PKS` → `dor_apims_pisp`). That covers 104 of 118 units directly. A unit without a database says so in the tab. These sessions are read-only too, with a 20 s statement timeout.

The database of a unit comes from the company mapping `dor_company_db` (`ms_company.companyAlias` → `dor_apims_<alias>`), with the name rule above as the fallback. How the vehicle tabs are filled, the ETL and what has no source yet: [VEHICLE_PROFILE_ETL.md](VEHICLE_PROFILE_ETL.md).

**Tables DOD keeps itself** (migration `010_profile_cards.sql`, database `dod_application_sit`). They hold what no source system has, and start empty:

| Table | Holds |
|---|---|
| `dor_vehicle_card` | Per vehicle: tarif budget, satuan, standar BBM, interval service, nilai perolehan, nilai buku, repairs before DOD records them, thresholds of the recommendation |
| `dor_vehicle_cost` | Per vehicle, month and category: nilai, qty (e.g. liter BBM), sumber |

An administrator fills them in the tabs: *Isi/Ubah biaya* (Biaya) and *Isi/Ubah data kartu* (Keputusan). Other roles only read them. Without these values the tabs say what is missing, and never show an estimated tariff or recommendation.

The recommendation is a DOD rule on the repair ratio, set per vehicle:
- below *batas pantau* (default 50%): **PERTAHANKAN**;
- from *batas pantau*: **PANTAU**;
- from *batas evaluasi* (default 75%): **EVALUASI PEREMAJAAN**.

## Data source

Read-only, straight from the organisation master database (`DOD_DB_<TARGET>_MASTER_NAME`, e.g. `dor_apims_master`) on the application database's server and account. Nothing is copied into DOD and the master is never written: the pool is read-only (`default_transaction_read_only`) with a 15 s statement timeout. When no master database is configured, the API answers `409 PROFILE_MASTER_NOT_CONFIGURED`.

| Report | Tables |
|---|---|
| Profil Blok | `ms_block`, `ms_businessunit`, `ms_company`, `ms_estate`, `ms_rayon`, `ms_division`, `ms_status_tanaman`, `ms_variety`, `ms_terrain`, `ms_soil`, `ms_blockownership`, `ms_landuse`, `ms_condition`, `ms_tph` |
| Kartu Kendaraan | `ms_vehicle`, `ms_businessunit`, `ms_company`, `ms_vehiclegroup`, `ms_uom`, `ms_vehiclemodel` |

Only active, non-deleted records are listed. The source's placeholders are shown as "–", never as a value:
- dates such as `1900-01-01`, `1900-01-00` and `[NULL]`;
- texts such as `-` and the empty string;
- meters that never moved from 0.

## API (`server/src/profile`)

| Endpoint | Returns |
|---|---|
| `GET /api/profile/status` | `{ configured }` |
| `GET /api/profile/units` | Kebun / business units with their active block and vehicle counts |
| `GET /api/profile/vehicles/groups` | Vehicle groups (API only) |
| `GET /api/profile/blocks?unit=&q=` | `{ items, more }`: up to 1,000 with a unit, 50 without |
| `GET /api/profile/vehicles?unit=&group=&q=` | `{ items, more }`: up to 1,000 with a unit, 50 without |
| `GET /api/profile/blocks/:id` | Profil Blok |
| `GET /api/profile/vehicles/:id` | Kartu Kendaraan |
| `GET /api/profile/blocks/:id/ops/:tab?period=YYYY-MM` | Tab `produksi`, `perawatan`, `pemupukan` or `biaya`, with the months that have data |
| `GET /api/profile/vehicles/:id/ops?period=YYYY-MM` | Every Kartu Kendaraan tab of the month |
| `PUT /api/profile/vehicles/:id/card` | Admin: the card data |
| `PUT /api/profile/vehicles/:id/costs/:period` | Admin: `{ items: [{ kategori, nilai, qty, sumber }] }`, replaces the month |

Every signed-in role may read the API. Settings → Hak Akses Menu narrows this per role:
- `/api/profile/*` needs **Analisis**;
- `/blocks` needs **Profil Blok**;
- `/vehicles` needs **Kartu Kendaraan**.

A report the role may not open is left out of the Jenis profil dropdown.

## Tests

- `server/test/profile.test.ts`: the routes (reads for every role, writes for administrators), the 409 when no master database is configured, the age calculation, hour parsing (`03:23`, `7 Jam 0 Menit`), months, the unit database mapping and the card rules.
- An opt-in read of the real master: `DOD_TEST_PROFILE_MASTER=1 node --env-file=../.env --test test/profile.test.ts`, run from `server/`. It is read-only and writes nothing; it also reads the tabs of a block and a vehicle of `AMS-Kebun1` from `dor_apims_ams`.
- `tests/profile.test.ts`: the report ids match the server menus, and the STNK countdown.

The production budget of a block is read (read-only, `server/src/profile/blockBudget.ts`) from `DO_PIMS_REPORT.data_budget.budget_produksi_harian`, the database named by `DOD_PRODUCTION_DB`: `SUM(produksi_harian)` (kg) ÷ 1000 for the month, matched on `kodebisnisunit`, `blokcode` and, when a code repeats, `afdeling`. It is not entered in DOD.
