// Shared TypeScript contracts for the server actions. Kept free of the
// 'use server' directive so types can be imported anywhere without pulling in
// a server-action boundary.
import type { AnomaliesData } from '@/lib/anomalies'
import type { ESF, ERI } from '@/lib/statements'
import type { MetricsResult } from '@/lib/metrics'

export type { AnomaliesData }

export interface CuentaOption { codCuenta: string; nombreCuenta: string }

export interface MayorEntry {
  fecha: string
  asiento: string
  tipo: string
  descripcion: string
  debe: number
  haber: number
  saldo: number
}

export interface MayorData {
  codCuenta: string
  nombreCuenta: string
  saldoInicial: number
  entries: MayorEntry[]
  totalDebe: number
  totalHaber: number
  saldoFinal: number
}

export interface MayorPageData {
  cuentas: CuentaOption[]
  mayor: MayorData | null
  selectedCuenta: string | null
}

export interface MonthBar {
  periodo: string
  label: string
  ingresos: number
  costoVentas: number
  utilidadBruta: number
  utilidadNeta: number
}

export interface DashboardData {
  esf: ESF
  eri: ERI
  metricas: MetricsResult
  monthlyChart: MonthBar[]
  periodosLeidos: string[]
}

export interface ComparativoData { a: DashboardData; b: DashboardData }

export interface CompanyConfig {
  razonSocial: string
  nombreComercial?: string
  ruc: string
  tipoContribuyente: string
  clasificacion: string
  niifFramework: string
  cotizaEnBolsa: boolean
  esEntidadFinanciera: boolean
  regimenTributario: string
  agenteRetencion: boolean
  contribuyenteEspecial: boolean
  sector: string
  tieneInventarios: boolean
  tieneActivosFijos: boolean
  tieneArrendamientos: boolean
  metodoInventarios?: string
  mesInicioEjercicio: number
  fuenteDatos: string
  createdAt: string
  isDemo?: boolean
}

export interface NotasData {
  esf: ESF
  eri: ERI
  config: CompanyConfig | null
  ruc: string
  periodos: string[]
}

export interface AiUiAction {
  type: 'render_dashboard'
  dashboard_id: string
  href?: string
  ruc: string
  periodos: string[]
  periodosA?: string[]
  periodosB?: string[]
  filters?: {
    startDate?: string | null
    endDate?: string | null
    granularity?: string
  }
}

export interface AiChatResponse {
  message: string
  ui_action: AiUiAction | null
  citations: Array<{ type: string; source: string; result_id: string }>
  executed_tools: string[]
  provider: string
  model?: string
}

export interface CsvMappingProposal {
  mapping: Record<string, string | null>
  detected_format: Record<string, string | null>
  confidence: number
  warnings: string[]
  requires_user_confirmation: boolean
}

export interface CsvMappingResponse {
  provider: string
  file_profile: {
    filename: string
    delimiter: string
    encoding: string
    sampled_rows: number
    column_count: number
    columns: Array<{ name: string; detected_type: string; examples: string[] }>
  }
  proposal: CsvMappingProposal
  warnings: string[]
  model?: string
}

export interface UploadCsvResult {
  ok: boolean
  error?: string
  filename?: string
  normalized?: boolean
  rowCount?: number
  provider?: string
  confidence?: number
  warnings?: string[]
  errors?: Array<{ row?: number; field?: string; message?: string }>
  mappingRequired?: boolean
  file_profile?: CsvMappingResponse['file_profile']
  proposal?: CsvMappingProposal
}

export interface CompanyOverview {
  ruc: string
  razonSocial: string
  sector: string
  niifFramework: string
  isDemo: boolean
  periodCount: number
  firstPeriod: string | null
  lastPeriod: string | null
}

export interface CompanyCloneResult {
  ok: boolean
  ruc?: string
  error?: string
}
