'use server'

import fs from 'fs'
import path from 'path'
import {
  listRucsFromStorage,
  listPeriodsFromStorage,
  readCsvFromStorage,
  uploadCsvToStorage,
} from '@/lib/storage'
import {
  listAvailablePeriods,
  parseMultiplePeriods,
  calcularSaldosConApertura,
  calcularSaldosPorCuenta,
  loadOpeningBalances,
} from '@/lib/parser'
import {
  parsePeriodContent,
  parseMultiplePeriodsContent,
  parseOpeningBalancesContent,
  calcularSaldosConAperturaContent,
  calcularSaldosPorCuentaContent,
  yearFromPeriod,
} from '@/lib/parser-content'
import { generarESF, generarERI } from '@/lib/statements'
import { calcularMetricas } from '@/lib/metrics'
import { analyzeAnomalies } from '@/lib/anomalies'
import type { AnomaliesData } from '@/lib/anomalies'
import { fmtPeriodo } from '@/lib/format'
import type { ESF, ERI } from '@/lib/statements'
import type { MetricsResult } from '@/lib/metrics'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CuentaOption {
  codCuenta: string
  nombreCuenta: string
}

export interface MayorEntry {
  fecha: string; asiento: string; tipo: string; descripcion: string
  debe: number; haber: number; saldo: number
}

export interface MayorData {
  codCuenta: string; nombreCuenta: string; saldoInicial: number
  entries: MayorEntry[]; totalDebe: number; totalHaber: number; saldoFinal: number
}

export interface MayorPageData {
  cuentas: CuentaOption[]; mayor: MayorData | null; selectedCuenta: string | null
}

export interface MonthBar {
  periodo: string; label: string
  ingresos: number; costoVentas: number; utilidadBruta: number; utilidadNeta: number
}

export interface DashboardData {
  esf: ESF; eri: ERI; metricas: MetricsResult
  monthlyChart: MonthBar[]; periodosLeidos: string[]
}

// ─── Helper: determinar si usar storage ──────────────────────────────────────

function useStorage(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// ─── Server Actions ───────────────────────────────────────────────────────────

export async function getAvailableRucs(): Promise<string[]> {
  if (useStorage()) {
    try {
      const rucs = await listRucsFromStorage()
      if (rucs.length > 0 || process.env.VERCEL) return rucs
    } catch (e) {
      console.warn('[actions] Storage listRucs falló:', e)
    }
  }
  const dir = path.join(process.cwd(), 'data', 'empresas')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory()).sort()
}

export async function getAllPeriods(rucs: string[]): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  for (const ruc of rucs) {
    if (useStorage()) {
      try { result[ruc] = await listPeriodsFromStorage(ruc); continue } catch { /* fallback */ }
    }
    result[ruc] = listAvailablePeriods(ruc)
  }
  return result
}

export async function getDashboardData(ruc: string, periodos: string[]): Promise<DashboardData | null> {
  if (periodos.length === 0) return null
  const sorted = [...periodos].sort()
  const year   = yearFromPeriod(sorted[0])

  if (useStorage()) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) {
      const csv = await readCsvFromStorage(ruc, `${p}.csv`)
      if (csv) contents.push({ periodo: p, content: csv })
    }
    const { entries: allEntries, periodosLeidos } = parseMultiplePeriodsContent(contents)
    const openingCsv = await readCsvFromStorage(ruc, `saldos_iniciales_${year}.csv`)
    const opening    = openingCsv ? parseOpeningBalancesContent(openingCsv, year) : new Map()
    const saldosESF  = calcularSaldosConAperturaContent(opening, allEntries)
    const saldosERI  = calcularSaldosPorCuentaContent(allEntries)
    const esf = generarESF(saldosESF)
    const eri = generarERI(saldosERI)
    const dias = sorted.length === 1 ? 30 : sorted.length <= 3 ? 90 : sorted.length <= 6 ? 180 : 365
    const metricas = calcularMetricas(esf, eri, 'comercial', dias)
    const monthlyChart: MonthBar[] = contents.map(({ periodo, content }) => {
      const { entries } = parsePeriodContent(content, periodo)
      const s = calcularSaldosPorCuentaContent(entries)
      const e = generarERI(s)
      return { periodo, label: fmtPeriodo(periodo), ingresos: e.ingresos.total,
        costoVentas: e.costoVentas.total, utilidadBruta: e.utilidadBruta, utilidadNeta: e.utilidadNeta }
    })
    return { esf, eri, metricas, monthlyChart, periodosLeidos }
  }

  // Fallback filesystem
  const { entries: allEntries, periodosLeidos } = parseMultiplePeriods(ruc, sorted)
  const saldosESF = calcularSaldosConApertura(ruc, year, allEntries)
  const saldosERI = calcularSaldosPorCuenta(allEntries)
  const esf = generarESF(saldosESF)
  const eri = generarERI(saldosERI)
  const dias = sorted.length === 1 ? 30 : sorted.length <= 3 ? 90 : sorted.length <= 6 ? 180 : 365
  const metricas = calcularMetricas(esf, eri, 'comercial', dias)
  const monthlyChart: MonthBar[] = sorted.map(periodo => {
    const s = calcularSaldosPorCuenta(allEntries.filter(e => e.periodo === periodo))
    const e = generarERI(s)
    return { periodo, label: fmtPeriodo(periodo), ingresos: e.ingresos.total,
      costoVentas: e.costoVentas.total, utilidadBruta: e.utilidadBruta, utilidadNeta: e.utilidadNeta }
  })
  return { esf, eri, metricas, monthlyChart, periodosLeidos }
}

export async function getMayorPageData(ruc: string, periodos: string[], codCuenta: string | null): Promise<MayorPageData> {
  if (periodos.length === 0) return { cuentas: [], mayor: null, selectedCuenta: null }
  const sorted = [...periodos].sort()
  const year   = yearFromPeriod(sorted[0])

  type Entry   = import('@/lib/parser').JournalEntry
  type SaldoM  = import('@/lib/parser').SaldoCuenta
  let entries: Entry[]             = []
  let opening: Map<string, SaldoM> = new Map()

  if (useStorage()) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) { const c = await readCsvFromStorage(ruc, `${p}.csv`); if (c) contents.push({ periodo: p, content: c }) }
    entries = parseMultiplePeriodsContent(contents).entries
    const oc = await readCsvFromStorage(ruc, `saldos_iniciales_${year}.csv`)
    opening  = oc ? parseOpeningBalancesContent(oc, year) : new Map()
  } else {
    entries = parseMultiplePeriods(ruc, sorted).entries
    opening = loadOpeningBalances(ruc, year)
  }

  const cuentaMap = new Map<string, string>()
  for (const e of entries) cuentaMap.set(e.codCuenta, e.nombreCuenta)
  for (const [cod, s] of opening) { if (!cuentaMap.has(cod)) cuentaMap.set(cod, s.nombreCuenta) }

  const cuentas: CuentaOption[] = [...cuentaMap.entries()]
    .map(([cod, nombre]) => ({ codCuenta: cod, nombreCuenta: nombre }))
    .sort((a, b) => a.codCuenta.localeCompare(b.codCuenta))

  const selected = (codCuenta && cuentaMap.has(codCuenta)) ? codCuenta : cuentas[0]?.codCuenta ?? null
  if (!selected) return { cuentas, mayor: null, selectedCuenta: null }

  const saldoInicial = opening.get(selected)?.saldo ?? 0
  const nombreCuenta = cuentaMap.get(selected) ?? selected
  const accountEntries = entries.filter(e => e.codCuenta === selected)
    .sort((a, b) => { const d = a.fecha.localeCompare(b.fecha); return d !== 0 ? d : a.asiento.localeCompare(b.asiento) })

  let saldoAcumulado = saldoInicial, totalDebe = 0, totalHaber = 0
  const mayorEntries: MayorEntry[] = accountEntries.map(e => {
    saldoAcumulado += e.debe - e.haber; totalDebe += e.debe; totalHaber += e.haber
    return { fecha: e.fecha, asiento: e.asiento, tipo: e.tipo, descripcion: e.descripcion,
      debe: e.debe, haber: e.haber, saldo: saldoAcumulado }
  })

  return { cuentas, mayor: { codCuenta: selected, nombreCuenta, saldoInicial,
    entries: mayorEntries, totalDebe, totalHaber, saldoFinal: saldoAcumulado }, selectedCuenta: selected }
}

export async function getMayorCompletoData(ruc: string, periodos: string[]): Promise<MayorData[]> {
  if (periodos.length === 0) return []
  const sorted = [...periodos].sort()
  const year   = yearFromPeriod(sorted[0])

  type Entry   = import('@/lib/parser').JournalEntry
  type SaldoM  = import('@/lib/parser').SaldoCuenta
  let entries: Entry[]             = []
  let opening: Map<string, SaldoM> = new Map()

  if (useStorage()) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) { const c = await readCsvFromStorage(ruc, `${p}.csv`); if (c) contents.push({ periodo: p, content: c }) }
    entries = parseMultiplePeriodsContent(contents).entries
    const oc = await readCsvFromStorage(ruc, `saldos_iniciales_${year}.csv`)
    opening  = oc ? parseOpeningBalancesContent(oc, year) : new Map()
  } else {
    entries = parseMultiplePeriods(ruc, sorted).entries
    opening = loadOpeningBalances(ruc, year)
  }

  const cuentaMap = new Map<string, string>()
  for (const e of entries) cuentaMap.set(e.codCuenta, e.nombreCuenta)
  for (const [cod, s] of opening) { if (!cuentaMap.has(cod)) cuentaMap.set(cod, s.nombreCuenta) }

  return [...cuentaMap.keys()].sort().map(cod => {
    const saldoInicial = opening.get(cod)?.saldo ?? 0
    const nombreCuenta = cuentaMap.get(cod) ?? cod
    const accountEntries = entries.filter(e => e.codCuenta === cod)
      .sort((a, b) => { const d = a.fecha.localeCompare(b.fecha); return d !== 0 ? d : a.asiento.localeCompare(b.asiento) })
    let saldoAcumulado = saldoInicial, totalDebe = 0, totalHaber = 0
    const mayorEntries: MayorEntry[] = accountEntries.map(e => {
      saldoAcumulado += e.debe - e.haber; totalDebe += e.debe; totalHaber += e.haber
      return { fecha: e.fecha, asiento: e.asiento, tipo: e.tipo, descripcion: e.descripcion,
        debe: e.debe, haber: e.haber, saldo: saldoAcumulado }
    })
    return { codCuenta: cod, nombreCuenta, saldoInicial, entries: mayorEntries, totalDebe, totalHaber, saldoFinal: saldoAcumulado }
  })
}

export type { AnomaliesData }

export async function getAnomaliesData(ruc: string, periodos: string[]): Promise<AnomaliesData | null> {
  if (periodos.length === 0) return null
  const sorted = [...periodos].sort()
  let entries: import('@/lib/parser').JournalEntry[] = []

  if (useStorage()) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) { const c = await readCsvFromStorage(ruc, `${p}.csv`); if (c) contents.push({ periodo: p, content: c }) }
    entries = parseMultiplePeriodsContent(contents).entries
  } else {
    entries = parseMultiplePeriods(ruc, sorted).entries
  }
  return analyzeAnomalies(entries)
}

export interface ComparativoData { a: DashboardData; b: DashboardData }

export async function getComparativoData(ruc: string, periodosA: string[], periodosB: string[]): Promise<ComparativoData | null> {
  if (periodosA.length === 0 || periodosB.length === 0) return null
  const [a, b] = await Promise.all([getDashboardData(ruc, periodosA), getDashboardData(ruc, periodosB)])
  if (!a || !b) return null
  return { a, b }
}

// ─── Carga de archivos CSV ─────────────────────────────────────────────────

export async function uploadCsvAction(formData: FormData): Promise<{ ok: boolean; error?: string; filename?: string }> {
  const file = formData.get('file') as File | null
  const ruc  = (formData.get('ruc') as string | null)?.trim()

  if (!file) return { ok: false, error: 'No se recibió ningún archivo' }
  if (!ruc || !/^\d{13}$/.test(ruc)) return { ok: false, error: 'RUC inválido (debe tener 13 dígitos)' }

  const name = file.name
  if (!/^(\d{6}|saldos_iniciales_\d{4})\.csv$/i.test(name)) {
    return { ok: false, error: 'El nombre debe ser YYYYMM.csv o saldos_iniciales_YYYY.csv' }
  }

  const buffer = await file.arrayBuffer()
  const result = await uploadCsvToStorage(ruc, name, buffer)
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, filename: name }
}

// ─── Configuración de empresa ─────────────────────────────────────────────────

export interface CompanyConfig {
  razonSocial: string; nombreComercial?: string; ruc: string; tipoContribuyente: string
  clasificacion: string; niifFramework: string; cotizaEnBolsa: boolean; esEntidadFinanciera: boolean
  regimenTributario: string; agenteRetencion: boolean; contribuyenteEspecial: boolean
  sector: string; tieneInventarios: boolean; tieneActivosFijos: boolean; tieneArrendamientos: boolean
  metodoInventarios?: string; mesInicioEjercicio: number; fuenteDatos: string; createdAt: string
}

export async function saveCompanyConfig(config: CompanyConfig): Promise<{ ok: boolean; error?: string }> {
  if (useStorage()) {
    const json = JSON.stringify(config, null, 2)
    const result = await uploadCsvToStorage(config.ruc, 'config.json', json)
    return result
  }
  try {
    const dir = path.join(process.cwd(), 'data', 'empresas', config.ruc)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: String(e) } }
}

export async function getCompanyConfig(ruc: string): Promise<CompanyConfig | null> {
  if (useStorage()) {
    try {
      const content = await readCsvFromStorage(ruc, 'config.json')
      if (!content) return null
      return JSON.parse(content) as CompanyConfig
    } catch { return null }
  }
  const p = path.join(process.cwd(), 'data', 'empresas', ruc, 'config.json')
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as CompanyConfig }
  catch { return null }
}
