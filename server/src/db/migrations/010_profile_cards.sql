-- Data Profil (Analisis): the figures of the Kartu Kendaraan and Profil Blok tabs that no source system holds.
-- Everything else in those tabs is read live from the unit databases (dor_apims_<unit>: FieldOperation,
-- TractionWorkshop, Keuangan). These tables start empty; an administrator fills them in the tabs (or by import).
-- vehicle_id / block_id are the ids of ms_vehicle / ms_block in the master database (no foreign key: another database).

-- One row per vehicle: budget tariff, standards, asset values and the replacement thresholds of the card.
CREATE TABLE IF NOT EXISTS dor_vehicle_card (
  vehicle_id               bigint PRIMARY KEY,
  tarif_budget             numeric(14,2) CHECK (tarif_budget >= 0),        -- Rp per KM/HM
  satuan                   text CHECK (satuan IN ('KM', 'HM')),
  bbm_standar              numeric(10,4) CHECK (bbm_standar >= 0),          -- liter per KM/HM
  interval_service         numeric(12,1) CHECK (interval_service > 0),     -- KM/HM between services
  nilai_perolehan          numeric(16,2) CHECK (nilai_perolehan >= 0),
  nilai_buku               numeric(16,2) CHECK (nilai_buku >= 0),
  nilai_buku_per           date,
  biaya_perbaikan_awal     numeric(16,2) NOT NULL DEFAULT 0 CHECK (biaya_perbaikan_awal >= 0), -- repairs before the first month in dor_vehicle_cost
  batas_pantau             numeric(5,4) NOT NULL DEFAULT 0.5 CHECK (batas_pantau > 0),          -- repair ÷ book value: from here PANTAU
  batas_evaluasi           numeric(5,4) NOT NULL DEFAULT 0.75 CHECK (batas_evaluasi > 0),       -- from here EVALUASI PEREMAJAAN
  keterangan               text CHECK (length(keterangan) <= 500),
  updated_by               text REFERENCES dor_user(id) ON DELETE SET NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (batas_evaluasi >= batas_pantau)
);

-- Monthly cost of a vehicle per category (the "Rincian Biaya" of the card).
CREATE TABLE IF NOT EXISTS dor_vehicle_cost (
  vehicle_id  bigint NOT NULL,
  periode     date NOT NULL CHECK (periode = date_trunc('month', periode)::date),
  kategori    text NOT NULL CHECK (kategori IN ('BBM', 'OLI', 'SPAREPART', 'BAN', 'SERVICE_LUAR', 'UPAH', 'BENGKEL', 'PAJAK', 'PENYUSUTAN', 'SEWA')),
  nilai       numeric(16,2) NOT NULL CHECK (nilai >= 0),
  qty         numeric(14,3) CHECK (qty >= 0),                                -- e.g. liter BBM
  sumber      text CHECK (length(sumber) <= 200),
  updated_by  text REFERENCES dor_user(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, periode, kategori)
);

-- Monthly production budget of a block (achievement in the Produksi tab).
CREATE TABLE IF NOT EXISTS dor_block_budget (
  block_id    bigint NOT NULL,
  periode     date NOT NULL CHECK (periode = date_trunc('month', periode)::date),
  ton_budget  numeric(12,3) NOT NULL CHECK (ton_budget >= 0),
  updated_by  text REFERENCES dor_user(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, periode)
);
