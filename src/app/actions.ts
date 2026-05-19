'use server'

import fs from 'fs'
import path from 'path'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { createOneDriveClient } from '@/lib/onedrive'
import {
  listAvailablePeriods,
  parsePeriod,
  parseMultiplePeriods,
  calcularSaldosConApertura,
  calcularSaldosPorCuenta,
  loadOpeningBalances,
  yearFromPeriod,
} from '@/lib/parser'
import {
  parsePeriodContent,
  parseMultiplePeriodsContent,
  parseOpeningBalancesContent,
  calcularSaldosConAperturaContent,
  calcularSaldosPorCuentaContent,
  yearFromPeriod as yearFromPeriodC,
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

// ─── Helpers de fuente de datos ───────────────────────────────────────────────

/** Devuelve el cliente de OneDrive si el usuario autenticado tiene token de Microsoft. */
async function getOneDriveClient() {
  const session = await getServerSession(authOptions)
  const token = (session as { msAccessToken?: string } | null)?.msAccessToken
  if (!token) return null
  return createOneDriveClient(token)
}

// ─── Server Actions ───────────────────────────────────────────────────────────

/** Lista los RUC disponibles (OneDrive o filesystem local). */
export async function getAvailableRucs(): Promise<string[]> {
  // 1. Intentar OneDrive
  const od = await getOneDriveClient()
  if (od) {
    try {
      const rucs = await od.listRucs()
      if (rucs.length > 0) return rucs
    } catch (e) {
      console.warn('[actions] OneDrive listRucs falló, usando filesystem:', e)
    }
  }

  // 2. Fallback: filesystem local (desarrollo)
  const dir = path.join(process.cwd(), 'data', 'empresas')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isDirectory())
    .sort()
}

/** Devuelve todos los períodos disponibles por RUC. */
export async function getAllPeriods(rucs: string[]): Promise<Record<string, string[]>> {
  const od = await getOneDriveClient()
  const result: Record<string, string[]> = {}

  for (const ruc of rucs) {
    if (od) {
      try {
        result[ruc] = await od.listPeriods(ruc)
        continue
      } catch {
        // fallback
      }
    }
    result[ruc] = listAvailablePeriods(ruc)
  }
  return result
}

/** Calcula el dashboard completo para un RUC y conjunto de períodos. */
export async function getDashboardData(
  ruc: string,
  periodos: string[],
): Promise<DashboardData | null> {
  if (periodos.length === 0) return null

  const sorted = [...periodos].sort()
  const year   = yearFromPeriodC(sorted[0])

  const od = await getOneDriveClient()

  if (od) {
    // ── Leer desde OneDrive ──
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) {
      const csv = await od.readCsv(ruc, `${p}.csv`)
      if (csv) contents.push({ periodo: p, content: csv })
    }

    const { entries: allEntries, periodosLeidos } = parseMultiplePeriodsContent(contents)

    // Saldos de apertura
    const openingCsv = await od.readCsv(ruc, `saldos_iniciales_${year}.csv`)
    const opening = openingCsv
      ? parseOpeningBalancesContent(openingCsv, year)
      : new Map()

    const saldosESF = calcularSaldosConAperturaContent(opening, allEntries)
    const saldosERI = calcularSaldosPorCuentaContent(allEntries)

    const esf = generarESF(saldosESF)
    const eri = generarERI(saldosERI)

    const diasPeriodo = sorted.length === 1 ? 30
      : sorted.length <= 3  ? 90
      : sorted.length <= 6  ? 180 : 365

    const metricas = calcularMetricas(esf, eri, 'comercial', diasPeriodo)

    const monthlyChart: MonthBar[] = []
    for (const { periodo, content } of contents) {
      const { entries } = parsePeriodContent(content, periodo)
      const saldos = calcularSaldosPorCuentaContent(entries)
      const eriMes = generarERI(saldos)
      monthlyChart.push({
        periodo,
        label:         fmtPeriodo(periodo),
        ingresos:      eriMes.ingresos.total,
        costoVentas:   eriMes.costoVentas.total,
        utilidadBruta: eriMes.utilidadBruta,
        utilidadNeta:  eriMes.utilidadNeta,
      })
    }

    return { esf, eri, metricas, monthlyChart, periodosLeidos }
  }

  // ── Fallback: filesystem ──
  const { entries: allEntries, periodosLeidos } = parseMultiplePeriods(ruc, sorted)
  const saldosESF = calcularSaldosConApertura(ruc, year, allEntries)
  const saldosERI = calcularSaldosPorCuenta(allEntries)
  const esf = generarESF(saldosESF)
  const eri = generarERI(saldosERI)

  const diasPeriodo = sorted.length === 1 ? 30
    : sorted.length <= 3 ? 90 : sorted.length <= 6 ? 180 : 365
  const metricas = calcularMetricas(esf, eri, 'comercial', diasPeriodo)

  const monthlyChart: MonthBar[] = sorted.map(periodo => {
    const { entries } = parsePeriod(ruc, periodo)
    const saldos = calcularSaldosPorCuenta(allEntries.filter(e => e.periodo === periodo))
    const eriMes = generarERI(saldos)
    return {
      periodo, label: fmtPeriodo(periodo),
      ingresos: eriMes.ingresos.total, costoVentas: eriMes.costoVentas.total,
      utilidadBruta: eriMes.utilidadBruta, utilidadNeta: eriMes.utilidadNeta,
    }
  })

  return { esf, eri, metricas, monthlyChart, periodosLeidos }
}

/** Devuelve la lista de cuentas y el mayor de la cuenta seleccionada. */
export async function getMayorPageData(
  ruc: string,
  periodos: string[],
  codCuenta: string | null,
): Promise<MayorPageData> {
  if (periodos.length === 0) return { cuentas: [], mayor: null, selectedCuenta: null }

  const sorted = [...periodos].sort()
  const year   = yearFromPeriodC(sorted[0])

  const od = await getOneDriveClient()
  let entries: import('@/lib/parser').JournalEntry[] = []
  let opening: Map<string, import('@/lib/parser').SaldoCuenta> = new Map()

  if (od) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) {
      const csv = await od.readCsv(ruc, `${p}.csv`)
      if (csv) contents.push({ periodo: p, content: csv })
    }
    const result = parseMultiplePeriodsContent(contents)
    entries = result.entries

    const openingCsv = await od.readCsv(ruc, `saldos_iniciales_${year}.csv`)
    opening = openingCsv ? parseOpeningBalancesContent(openingCsv, year) : new Map()
  } else {
    const result = parseMultiplePeriods(ruc, sorted)
    entries = result.entries
    opening = loadOpeningBalances(ruc, year)
  }

  const cuentaMap = new Map<string, string>()
  for (const e of entries) cuentaMap.set(e.codCuenta, e.nombreCuenta)
  for (const [cod, s] of opening) {
    if (!cuentaMap.has(cod)) cuentaMap.set(cod, s.nombreCuenta)
  }

  const cuentas: CuentaOption[] = [...cuentaMap.entries()]
    .map(([cod, nombre]) => ({ codCuenta: cod, nombreCuenta: nombre }))
    .sort((a, b) => a.codCuenta.localeCompare(b.codCuenta))

  const selected = (codCuenta && cuentaMap.has(codCuenta))
    ? codCuenta : cuentas[0]?.codCuenta ?? null

  if (!selected) return { cuentas, mayor: null, selectedCuenta: null }

  const openingEntry = opening.get(selected)
  const saldoInicial = openingEntry?.saldo ?? 0
  const nombreCuenta = cuentaMap.get(selected) ?? selected

  const accountEntries = entries
    .filter(e => e.codCuenta === selected)
    .sort((a, b) => {
      const d = a.fecha.localeCompare(b.fecha)
      return d !== 0 ? d : a.asiento.localeCompare(b.asiento)
    })

  let saldoAcumulado = saldoInicial
  let totalDebe = 0
  let totalHaber = 0

  const mayorEntries: MayorEntry[] = accountEntries.map(e => {
    saldoAcumulado += e.debe - e.haber
    totalDebe      += e.debe
    totalHaber     += e.haber
    return {
      fecha: e.fecha, asiento: e.asiento, tipo: e.tipo,
      descripcion: e.descripcion, debe: e.debe, haber: e.haber, saldo: saldoAcumulado,
    }
  })

  return {
    cuentas,
    mayor: { codCuenta: selected, nombreCuenta, saldoInicial,
      entries: mayorEntries, totalDebe, totalHaber, saldoFinal: saldoAcumulado },
    selectedCuenta: selected,
  }
}

/** Mayor completo de TODAS las cuentas (para exportación Excel). */
export async function getMayorCompletoData(
  ruc: string,
  periodos: string[],
): Promise<MayorData[]> {
  if (periodos.length === 0) return []
  const sorted = [...periodos].sort()
  const year   = yearFromPeriodC(sorted[0])

  const od = await getOneDriveClient()
  let entries: import('@/lib/parser').JournalEntry[] = []
  let opening: Map<string, import('@/lib/parser').SaldoCuenta> = new Map()

  if (od) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) {
      const csv = await od.readCsv(ruc, `${p}.csv`)
      if (csv) contents.push({ periodo: p, content: csv })
    }
    entries = parseMultiplePeriodsContent(contents).entries
    const openingCsv = await od.readCsv(ruc, `saldos_iniciales_${year}.csv`)
    opening = openingCsv ? parseOpeningBalancesContent(openingCsv, year) : new Map()
  } else {
    entries = parseMultiplePeriods(ruc, sorted).entries
    opening = loadOpeningBalances(ruc, year)
  }

  const cuentaMap = new Map<string, string>()
  for (const e of entries) cuentaMap.set(e.codCuenta, e.nombreCuenta)
  for (const [cod, s] of opening) {
    if (!cuentaMap.has(cod)) cuentaMap.set(cod, s.nombreCuenta)
  }

  return [...cuentaMap.keys()].sort().map((cod) => {
    const openingEntry = opening.get(cod)
    const saldoInicial = openingEntry?.saldo ?? 0
    const nombreCuenta = cuentaMap.get(cod) ?? cod

    const accountEntries = entries
      .filter(e => e.codCuenta === cod)
      .sort((a, b) => {
        const d = a.fecha.localeCompare(b.fecha)
        return d !== 0 ? d : a.asiento.localeCompare(b.asiento)
      })

    let saldoAcumulado = saldoInicial, totalDebe = 0, totalHaber = 0

    const mayorEntries: MayorEntry[] = accountEntries.map(e => {
      saldoAcumulado += e.debe - e.haber
      totalDebe      += e.debe
      totalHaber     += e.haber
      return { fecha: e.fecha, asiento: e.asiento, tipo: e.tipo,
        descripcion: e.descripcion, debe: e.debe, haber: e.haber, saldo: saldoAcumulado }
    })

    return { codCuenta: cod, nombreCuenta, saldoInicial,
      entries: mayorEntries, totalDebe, totalHaber, saldoFinal: saldoAcumulado }
  })
}

export type { AnomaliesData }

/** Análisis de anomalías. */
export async function getAnomaliesData(
  ruc: string,
  periodos: string[],
): Promise<AnomaliesData | null> {
  if (periodos.length === 0) return null
  const sorted = [...periodos].sort()

  const od = await getOneDriveClient()
  let entries: import('@/lib/parser').JournalEntry[] = []

  if (od) {
    const contents: { periodo: string; content: string }[] = []
    for (const p of sorted) {
      const csv = await od.readCsv(ruc, `${p}.csv`)
      if (csv) contents.push({ periodo: p, content: csv })
    }
    entries = parseMultiplePeriodsContent(contents).entries
  } else {
    entries = parseMultiplePeriods(ruc, sorted).entries
  }

  return analyzeAnomalies(entries)
}

// ─── Comparativo ──────────────────────────────────────────────────────────────

export interface ComparativoData {
  a: DashboardData
  b: DashboardData
}

export async function getComparativoData(
  ruc: string,
  periodosA: string[],
  periodosB: string[],
): Promise<ComparativoData | null> {
  if (periodosA.length === 0 || periodosB.length === 0) return null
  const [a, b] = await Promise.all([
    getDashboardData(ruc, periodosA),
    getDashboardData(ruc, periodosB),
  ])
  if (!a || !b) return null
  return { a, b }
}

// ─── Configuración de empresa ─────────────────────────────────────────────────

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

export async function saveCompanyConfig(
  config: CompanyConfig,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = path.join(process.cwd(), 'data', 'empresas', config.ruc)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getCompanyConfig(ruc: string): Promise<CompanyConfig | null> {
  const p = path.join(process.cwd(), 'data', 'empresas', ruc, 'config.json')
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as CompanyConfig }
  catch { return null }
}
