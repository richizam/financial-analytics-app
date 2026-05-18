'use server'

import fs from 'fs'
import path from 'path'
import {
  listAvailablePeriods,
  parsePeriod,
  parseMultiplePeriods,
  calcularSaldosConApertura,
  calcularSaldosPorCuenta,
  loadOpeningBalances,
  yearFromPeriod,
} from '@/lib/parser'
import { generarESF, generarERI } from '@/lib/statements'
import { calcularMetricas } from '@/lib/metrics'
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
  debe: number    // centavos
  haber: number   // centavos
  saldo: number   // centavos, acumulado corriendo
}

export interface MayorData {
  codCuenta: string
  nombreCuenta: string
  saldoInicial: number  // centavos
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
  label: string      // "Mar 2025"
  ingresos: number   // centavos
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

// ─── Server Actions ───────────────────────────────────────────────────────────

/** Lista los RUC disponibles (carpetas en data/empresas/). */
export async function getAvailableRucs(): Promise<string[]> {
  const dir = path.join(process.cwd(), 'data', 'empresas')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isDirectory())
    .sort()
}

/** Devuelve todos los períodos disponibles por RUC en un solo objeto (para precargar). */
export async function getAllPeriods(rucs: string[]): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  for (const ruc of rucs) {
    result[ruc] = listAvailablePeriods(ruc)
  }
  return result
}

/**
 * Calcula el dashboard completo para un RUC y conjunto de períodos.
 * Los períodos deben estar en el mismo año para que la apertura sea correcta.
 * Períodos de años distintos: se usa el año del primer período para la apertura.
 */
export async function getDashboardData(
  ruc: string,
  periodos: string[],
): Promise<DashboardData | null> {
  if (periodos.length === 0) return null

  const sorted = [...periodos].sort()
  const year = yearFromPeriod(sorted[0])

  // ── Estados financieros del período consolidado ──
  const { entries: allEntries, periodosLeidos } = parseMultiplePeriods(ruc, sorted)

  // ESF: saldos acumulados desde apertura del año
  const saldosESF = calcularSaldosConApertura(ruc, year, allEntries)
  // ERI: solo movimientos del período (cuentas 4.x/5.x no tienen saldo inicial)
  const saldosERI = calcularSaldosPorCuenta(allEntries)

  const esf = generarESF(saldosESF)
  const eri = generarERI(saldosERI)

  // Aproximar días del período para ratios de eficiencia
  const diasPeriodo = sorted.length === 1 ? 30
    : sorted.length <= 3  ? 90
    : sorted.length <= 6  ? 180
    : 365

  const metricas = calcularMetricas(esf, eri, 'comercial', diasPeriodo)

  // ── Desglose mensual para gráfico de barras ──
  const monthlyChart: MonthBar[] = sorted.map(periodo => {
    const { entries } = parsePeriod(ruc, periodo)
    const saldos = calcularSaldosPorCuenta(entries)
    const eriMes = generarERI(saldos)
    return {
      periodo,
      label:         fmtPeriodo(periodo),
      ingresos:      eriMes.ingresos.total,
      costoVentas:   eriMes.costoVentas.total,
      utilidadBruta: eriMes.utilidadBruta,
      utilidadNeta:  eriMes.utilidadNeta,
    }
  })

  return { esf, eri, metricas, monthlyChart, periodosLeidos }
}

/**
 * Devuelve la lista de cuentas disponibles y el mayor de la cuenta seleccionada.
 * Si codCuenta es null, usa la primera cuenta disponible.
 */
export async function getMayorPageData(
  ruc: string,
  periodos: string[],
  codCuenta: string | null,
): Promise<MayorPageData> {
  if (periodos.length === 0) return { cuentas: [], mayor: null, selectedCuenta: null }

  const sorted = [...periodos].sort()
  const year = yearFromPeriod(sorted[0])

  const { entries } = parseMultiplePeriods(ruc, sorted)
  const opening = loadOpeningBalances(ruc, year)

  // Construir mapa de cuentas desde movimientos + saldos de apertura
  const cuentaMap = new Map<string, string>()
  for (const e of entries) cuentaMap.set(e.codCuenta, e.nombreCuenta)
  for (const [cod, s] of opening) {
    if (!cuentaMap.has(cod)) cuentaMap.set(cod, s.nombreCuenta)
  }

  const cuentas: CuentaOption[] = [...cuentaMap.entries()]
    .map(([cod, nombre]) => ({ codCuenta: cod, nombreCuenta: nombre }))
    .sort((a, b) => a.codCuenta.localeCompare(b.codCuenta))

  const selected = (codCuenta && cuentaMap.has(codCuenta))
    ? codCuenta
    : cuentas[0]?.codCuenta ?? null

  if (!selected) return { cuentas, mayor: null, selectedCuenta: null }

  const openingEntry = opening.get(selected)
  const saldoInicial = openingEntry?.saldo ?? 0
  const nombreCuenta = cuentaMap.get(selected) ?? selected

  // Filtrar y ordenar movimientos de la cuenta
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
      fecha:       e.fecha,
      asiento:     e.asiento,
      tipo:        e.tipo,
      descripcion: e.descripcion,
      debe:        e.debe,
      haber:       e.haber,
      saldo:       saldoAcumulado,
    }
  })

  return {
    cuentas,
    mayor: {
      codCuenta: selected,
      nombreCuenta,
      saldoInicial,
      entries:    mayorEntries,
      totalDebe,
      totalHaber,
      saldoFinal: saldoAcumulado,
    },
    selectedCuenta: selected,
  }
}
