'use server'

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
}

export interface NotasData {
  esf: ESF
  eri: ERI
  config: CompanyConfig | null
  ruc: string
  periodos: string[]
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
): Promise<{ ok: boolean; error?: string; filename?: string }> {
  return postBackendForm<{ ok: boolean; error?: string; filename?: string }>('/upload-csv', formData)
}

export async function saveCompanyConfig(config: CompanyConfig): Promise<{ ok: boolean; error?: string }> {
  return postBackendJson<{ ok: boolean; error?: string }>('/company-config', { config })
}

export async function getCompanyConfig(ruc: string): Promise<CompanyConfig | null> {
  return getBackendJson<CompanyConfig | null>(`/company-config/${encodeURIComponent(ruc)}`)
}

export async function getNotasData(ruc: string, periodos: string[]): Promise<NotasData | null> {
  return postBackendJson<NotasData | null>('/notas', { ruc, periodos })
}
