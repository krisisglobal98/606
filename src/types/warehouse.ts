/**
 * Contracts of the DOD backend's data warehouse API (/api/dw/*). Mirrors server/src/dw and
 * server/src/datasets. Credentials never appear here: a connection only says whether its password
 * secret is configured on the server.
 */

export type ConnectionStatus = 'untested' | 'connected' | 'failed' | 'not_configured'

export type DbType = 'postgresql' | 'clickhouse' | 'mysql' | 'mongodb' | 'redis'

/** What DOD can do with a source type today; connect, test and browse work for every type. */
export interface DwCapabilities {
  preview: boolean
  profile: boolean
  exactCount: boolean
  dataset: boolean
}

/** A connection of the server's .env, as the browser sees it (no host, database, account or password). */
export interface DwConnection {
  id: string
  name: string
  dbType: DbType
  environment: string
  /** Default schema (PostgreSQL) / database (ClickHouse) for building a dataset. */
  schema: string
  /** False when its password is missing in .env. */
  secretConfigured: boolean
  capabilities: DwCapabilities
  status: ConnectionStatus
}

/** Master Kategori (parentId null) and Sub-kategori. */
export interface DwCategory {
  id: string
  name: string
  description: string
  parentId: string | null
  sortOrder: number
  datasetCount: number
  createdAt: string
  updatedAt: string
}

export interface DatasetCategoryRef {
  id: string
  name: string
  parentId: string | null
  parentName: string | null
}

export interface DwSchema {
  name: string
  tableCount: number
  canUse: boolean
  isDefault: boolean
}

export type TypeCategory = 'number' | 'string' | 'date' | 'boolean' | 'other'

export interface DwTable {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized_view' | 'partitioned_table' | 'foreign_table'
  estimatedRows: number | null
  totalBytes: number | null
  columnCount: number
  comment: string | null
  lastAnalyzedAt: string | null
  canSelect: boolean
}

export interface DwColumn {
  name: string
  ordinal: number
  dataType: string
  typeCategory: TypeCategory
  nullable: boolean
  defaultValue: string | null
  comment: string | null
  stats: { nullFraction: number | null; distinctEstimate: number | null; commonValues: string[]; min: string | null; max: string | null } | null
}

/* ---------------- Datasets & semantic model ---------------- */

export interface SemanticSource {
  alias: string
  table: string
  label: string
  role: 'actual' | 'budget' | 'other'
  dateColumn: string
}

export interface SemanticDimension {
  id: string
  label: string
  columns: Record<string, string | null>
  description?: string
}

interface MeasureBase {
  id: string
  label: string
  unit: string
  decimals: number
  description?: string
}
/** Only rows whose dimension value is in the list count (e.g. status = B). */
export interface MeasureWhere {
  dim: string
  values: string[]
}
export type SemanticMeasure =
  | (MeasureBase & { type: 'sum'; source: string; column: string; where?: MeasureWhere })
  /** pick: max (default) = largest value per entity in the period; last = value on its latest date, 0 included. */
  | (MeasureBase & { type: 'snapshot'; source: string; column: string; pick?: 'max' | 'last'; where?: MeasureWhere })
  /** Number of distinct values of a column (e.g. units). */
  | (MeasureBase & { type: 'distinct'; source: string; column: string; where?: MeasureWhere })
  | (MeasureBase & { type: 'ratio'; numerator: string; denominator: string; scale: number })
  /** Budget pro rata to the report date (budget and workdays are SUM measures). */
  | (MeasureBase & { type: 'prorate'; budget: string; workdays: string })

export interface SemanticModel {
  version: 1
  sources: SemanticSource[]
  dimensions: SemanticDimension[]
  measures: SemanticMeasure[]
  entity: string[]
  kpi: { actual: string; target: string | null }
  scopeFields: string[]
  filterFields: string[]
  defaultLayout: { dimensions: string[]; measures: string[] }
}

export interface DatasetSuggestion {
  semantic: SemanticModel
  problems: string[]
  tables: { name: string; columns: { name: string; dataType: string; typeCategory: TypeCategory }[] }[]
}

export interface WhDatasetSummary {
  id: string
  name: string
  description: string
  connectionId: string
  connectionName: string
  environment: string
  schema: string
  sourceTables: string[]
  status: 'draft' | 'active' | 'archived'
  category: DatasetCategoryRef | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  dimensionCount: number
  measureCount: number
}

export interface CatalogField {
  id: string
  label: string
  kind: 'dimension' | 'measure'
  dataType: 'date' | 'string' | 'number'
  unit?: string
  decimals?: number
  description?: string
}

export interface WhDataset extends Omit<WhDatasetSummary, 'dimensionCount' | 'measureCount'> {
  semantic: SemanticModel
  fields: CatalogField[]
  /** Answer of a create / update only: the organization validation that ran right after the save. */
  orgValidation?: { status: DatasetOrgStatus; error: string | null }
}

/* ---------------- Data access: organization parameters of a dataset (server dataAccess/datasetOrg.ts) ---------------- */

export type DatasetOrgStatus = 'OK' | 'PARTIAL' | 'UNVERIFIED' | 'NONPIMS' | 'NONE' | 'FAILED'
export interface OrgDim {
  dim: string
  forms: Record<string, string | null>
}
export interface DatasetOrgValidation {
  status: 'ok' | 'partial' | 'failed'
  unmappedShare: number
  rows: number
  unmappedRows: number
  unmappedValues: string[]
  perSource: { alias: string; rows: number; unmappedRows: number; distinct: number; unmappedDistinct: number }[]
}
export interface DatasetOrgInfo {
  profile: {
    businessUnit: OrgDim | null
    group: OrgDim | null
    region: OrgDim | null
    company: OrgDim | null
    rayon: OrgDim | 'ambiguous' | null
    division: OrgDim | 'ambiguous' | null
    ownership: OrgDim | 'ambiguous' | null
    standardProblem: { status: 'NONPIMS' | 'NONE'; message: string; missingField?: boolean } | null
  }
  status: DatasetOrgStatus
  validation: { status: DatasetOrgValidation['status']; datasetUpdatedAt: string; checkedAt: string; detail: DatasetOrgValidation } | null
}
