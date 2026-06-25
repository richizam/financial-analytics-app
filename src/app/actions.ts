'use server'

import { revalidatePath } from 'next/cache'
import { getBackendJson, postBackendForm, postBackendJson } from '@/lib/python-backend'
import type { AnomaliesData } from '@/lib/anomalies'
import type { ESF, ERI } from '@/lib/statements'
import type { MetricsResult } from '@/lib/metrics'

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

export type { AnomaliesData }

export async function getAvailableRucs(): Promise<string[]> {
  return getBackendJson<string[]>('/rucs')
}

export async function getAllPeriods(rucs: string[]): Promise<Record<string, string[]>> {
  return postBackendJson<Record<string, string[]>>('/periods', { rucs })
}

export async function getDashboardData(
  ruc: string,
  periodos: string[],
): Promise<DashboardData | null> {
  return postBackendJson<DashboardData | null>('/dashboard', { ruc, periodos })
}

export async function getMayorPageData(
  ruc: string,
  periodos: string[],
  codCuenta: string | null,
): Promise<MayorPageData> {
  return postBackendJson<MayorPageData>('/mayor', { ruc, periodos, codCuenta })
}

export async function getMayorCompletoData(ruc: string, periodos: string[]): Promise<MayorData[]> {
  return postBackendJson<MayorData[]>('/mayor/completo', { ruc, periodos })
}

export async function getAnomaliesData(
  ruc: string,
  periodos: string[],
): Promise<AnomaliesData | null> {
  return postBackendJson<AnomaliesData | null>('/anomalies', { ruc, periodos })
}

export async function getComparativoData(
  ruc: string,
  periodosA: string[],
  periodosB: string[],
): Promise<ComparativoData | null> {
  return postBackendJson<ComparativoData | null>('/comparativo', { ruc, periodosA, periodosB })
}

export async function uploadCsvAction(
  formData: FormData,
): Promise<UploadCsvResult> {
  return postBackendForm<UploadCsvResult>('/upload-csv', formData)
}

export async function saveCompanyConfig(config: CompanyConfig): Promise<{ ok: boolean; error?: string }> {
  return postBackendJson<{ ok: boolean; error?: string }>('/company-config', { config })
}

export async function getCompanyConfig(ruc: string): Promise<CompanyConfig | null> {
  return getBackendJson<CompanyConfig | null>(`/company-config/${encodeURIComponent(ruc)}`)
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

// Enriched company list for the sidebar (friendly name + framework + data coverage).
export async function getCompaniesOverview(): Promise<CompanyOverview[]> {
  const rucs = await getAvailableRucs()
  if (rucs.length === 0) return []
  const periodsByRuc = await getAllPeriods(rucs)
  const overviews: CompanyOverview[] = []
  for (const ruc of rucs) {
    const cfg = await getCompanyConfig(ruc)
    const periods = periodsByRuc[ruc] ?? []
    overviews.push({
      ruc,
      razonSocial: cfg?.razonSocial?.trim() || ruc,
      sector: cfg?.sector ?? '',
      niifFramework: cfg?.niifFramework ?? '',
      isDemo: Boolean(cfg?.isDemo),
      periodCount: periods.length,
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods.length ? periods[periods.length - 1] : null,
    })
  }
  return overviews
}

export interface CompanyCloneResult {
  ok: boolean
  ruc?: string
  error?: string
}

export async function cloneCompany(input: {
  sourceRuc: string
  destRuc: string
  config?: Partial<CompanyConfig>
}): Promise<CompanyCloneResult> {
  return postBackendJson<CompanyCloneResult>('/companies/clone', input)
}

interface DemoPreset {
  destRuc: string
  razonSocial: string
  sector: string
  niifFramework: string
  clasificacion: string
}

const DEMO_PRESETS: DemoPreset[] = [
  { destRuc: '0992222222001', razonSocial: 'Comercial Andina S.A.', sector: 'comercial', niifFramework: 'niif_pymes', clasificacion: 'mediana' },
  { destRuc: '0993333333001', razonSocial: 'Servicios Quito Cía. Ltda.', sector: 'servicios', niifFramework: 'niif_pymes', clasificacion: 'pequena' },
]

function buildCompanyConfig(
  overrides: Partial<CompanyConfig> & { ruc: string; razonSocial: string },
): CompanyConfig {
  const base: CompanyConfig = {
    razonSocial: overrides.razonSocial,
    ruc: overrides.ruc,
    tipoContribuyente: 'sociedad',
    clasificacion: 'mediana',
    niifFramework: 'niif_pymes',
    cotizaEnBolsa: false,
    esEntidadFinanciera: false,
    regimenTributario: 'general',
    agenteRetencion: false,
    contribuyenteEspecial: false,
    sector: 'comercial',
    tieneInventarios: true,
    tieneActivosFijos: true,
    tieneArrendamientos: false,
    mesInicioEjercicio: 1,
    fuenteDatos: 'excel',
    createdAt: new Date().toISOString(),
  }
  return { ...base, ...overrides }
}

// One-click demo: clone the existing dataset into two preset companies and give
// the original a friendly name. Idempotent — skips presets that already exist.
export async function seedDemoCompanies(): Promise<{ ok: boolean; created: string[]; error?: string }> {
  const rucs = await getAvailableRucs()
  const periodsByRuc = await getAllPeriods(rucs)
  const source = rucs.find(ruc => (periodsByRuc[ruc] ?? []).length > 0)
  if (!source) return { ok: false, created: [], error: 'No hay una empresa con datos para clonar' }

  // Name the existing bare-RUC company so the switcher reads nicely.
  const existing = await getCompanyConfig(source)
  if (!existing?.razonSocial) {
    await saveCompanyConfig(
      buildCompanyConfig({
        ruc: source,
        razonSocial: 'Distribuidora del Guayas S.A.',
        sector: 'comercial',
        niifFramework: 'niif_pymes',
      }),
    )
  }

  const created: string[] = []
  for (const preset of DEMO_PRESETS) {
    if (rucs.includes(preset.destRuc)) continue
    const result = await cloneCompany({
      sourceRuc: source,
      destRuc: preset.destRuc,
      config: buildCompanyConfig({
        ruc: preset.destRuc,
        razonSocial: preset.razonSocial,
        sector: preset.sector,
        niifFramework: preset.niifFramework,
        clasificacion: preset.clasificacion,
        isDemo: true,
      }),
    })
    if (result.ok && result.ruc) created.push(result.ruc)
  }

  revalidatePath('/', 'layout')
  return { ok: true, created }
}

export async function getNotasData(ruc: string, periodos: string[]): Promise<NotasData | null> {
  return postBackendJson<NotasData | null>('/notas', { ruc, periodos })
}

export async function askGrokAnalytics(input: {
  message: string
  ruc: string
  periodos: string[]
  conversation?: Array<{
    role: 'user' | 'assistant'
    content: string
    ui_action?: AiUiAction | null
    executed_tools?: string[]
  }>
  conversation_summary?: string
}): Promise<AiChatResponse> {
  return postBackendJson<AiChatResponse>('/ai/chat', input)
}

export async function suggestCsvMappingAction(formData: FormData): Promise<CsvMappingResponse> {
  return postBackendForm<CsvMappingResponse>('/ai/csv-mapping', formData)
}
