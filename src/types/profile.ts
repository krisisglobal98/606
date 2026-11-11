/** Data Profil (Analisis): read-only profiles from the master database (server/src/profile). */
/** A kebun / business unit with its number of active blocks and vehicles. */
export interface ProfileUnit { id: string; code: string; name: string; blocks: number; vehicles: number }
export interface Picked<T> { items: T[]; more: boolean }
export interface BlockItem { id: string; code: string; name: string; unit: string | null; division: string | null; plantedHa: number | null; status: string | null }
export interface VehicleItem { id: string; code: string; name: string; unit: string | null; group: string | null; registrationNo: string | null }
export interface VehicleGroup { id: string; code: string; name: string; category: string | null }

export interface BlockProfile {
  id: string
  code: string
  name: string
  active: boolean
  org: { company: string | null; unit: string | null; unitCode: string | null; estate: string | null; estateCode: string | null; rayon: string | null; division: string | null }
  planting: { plantedOn: string | null; ageYears: number | null; status: string | null; statusCode: string | null; variety: string | null; breeder: string | null; tahunLc: number | null }
  land: { terrain: string | null; soil: string | null; ownership: string | null; landuse: string | null; upkeep: string | null; upkeepCode: string | null; harvest: string | null; harvestCode: string | null }
  area: { blockHa: number | null; plantedHa: number | null; other: { label: string; ha: number }[] }
  stand: { initial: number | null; total: number | null; productive: number | null; insertion: number | null; dead: number | null; perHa: number | null }
  tph: number
  remark: string | null
  validFrom: string | null
  updatedAt: string | null
}

export interface VehicleCard {
  id: string
  code: string
  name: string
  active: boolean
  downtime: boolean
  org: { company: string | null; unit: string | null; unitCode: string | null }
  group: { code: string | null; name: string | null; category: string | null; uom: string | null }
  identity: { registrationNo: string | null; assetNumber: string | null; controlAllocation: string | null; engineNo: string | null; chassisNo: string | null; merk: string | null; type: string | null; model: string | null }
  ownership: { kind: string | null; description: string | null }
  dates: { made: string | null; purchased: string | null; stnkUntil: string | null; whitened: string | null }
  meter: { start: number | null; end: number | null; startAdjust: number | null; endAdjust: number | null }
  remark: string | null
  validFrom: string | null
  updatedAt: string | null
}

/* ---------------- Operational tabs (server/src/profile/ops.ts) ---------------- */
export type BlockTab = 'produksi' | 'perawatan' | 'pemupukan' | 'biaya'
interface OpsBase { source: string | null; periods: string[]; period: string | null; notice: string | null }
export interface BlockProduction {
  kpi: { janjang: number; brondolanKg: number; tonase: number; haPanen: number; hkPanen: number; hariPanen: number; pemanen: number; bjr: number | null; bjrSource: string | null; produktivitas: number | null; outputHk: number | null; akp: number | null; taksasi: number; budgetTon: number | null; achievement: number | null }
  daily: { day: string; janjang: number; kg: number }[]
  monthly: { period: string; ton: number; ha: number }[]
}
export interface BlockActivities {
  activities: { code: string; name: string; modul: string; hk: number; pekerja: number; hari: number; ha: number; qty: number; uom: string | null; dosis: number | null; first: string; last: string }[]
  materials: { code: string; name: string; uom: string | null; category: string | null; qty: number; activities: string[]; perHa: number | null }[]
  totals: { hk: number; ha: number; kegiatan: number; material: number }
}
export interface BlockCost {
  items: { code: string; name: string; hk: number; nilai: number; rate: number | null; entries: number }[]
  total: number
  hk: number
  perHa: number | null
}
export type BlockOps = OpsBase & { tab: BlockTab; block: { id: string; code: string; unitCode: string | null; plantedHa: number | null }; data: BlockProduction | BlockActivities | BlockCost | null }

export type CostCategory = 'BBM' | 'OLI' | 'SPAREPART' | 'BAN' | 'SERVICE_LUAR' | 'UPAH' | 'BENGKEL' | 'PAJAK' | 'PENYUSUTAN' | 'SEWA'
export interface VehicleCardSettings {
  tarifBudget: number | null
  satuan: 'KM' | 'HM' | null
  bbmStandar: number | null
  intervalService: number | null
  nilaiPerolehan: number | null
  nilaiBuku: number | null
  nilaiBukuPer: string | null
  biayaPerbaikanAwal: number
  batasPantau: number
  batasEvaluasi: number
  keterangan: string | null
  updatedAt?: string | null
}
export interface VehicleOpsData {
  kpi: { pemakaian: number; trip: number; muatanTon: number; jamOperasi: number; jamRusak: number; jamTersedia: number; pa: number | null; hariOperasi: number; meterStart: number | null; meterEnd: number | null; jumlahWO: number; bbmLiter: number | null; bbmRasio: number | null; totalBiaya: number | null; tarifAktual: number | null; biayaPerTon: number | null; indeks: number | null }
  operators: { name: string; days: number }[]
  costs: { kategori: CostCategory; label: string; nilai: number; qty: number | null; sumber: string | null; recorded: boolean }[]
  costRecorded: boolean
  activities: { code: string; name: string; usage: number; trip: number; kg: number; lines: number; share: number; charge: number | null }[]
  workOrders: { nomor: string; tanggal: string | null; masuk: string | null; jenis: string | null; bengkel: string | null; keluhan: string | null; penyebab: string | null; meter: number | null }[]
  cumulative: { sdBulanLalu: number; bulanIni: number; total: number; nilaiBuku: number | null; rasio: number | null; rekomendasi: 'PERTAHANKAN' | 'PANTAU' | 'EVALUASI PEREMAJAAN' | null; batasPantau: number | null; batasEvaluasi: number | null }
}
export type VehicleOps = OpsBase & { vehicle: { id: string; code: string; unitCode: string | null }; satuan: 'KM' | 'HM'; card: VehicleCardSettings | null; data: VehicleOpsData | null }
