'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getComparativoData } from '@/app/actions'
import type { AiUiAction, ComparativoData, DashboardData } from '@/app/actions'
import type { Ratio } from '@/lib/metrics'
import { fmtMoneda, fmtPct, fmtVeces, fmtDias, fmtPeriodo } from '@/lib/format'
import PeriodSelector from '@/components/dashboard/PeriodSelector'
import GrokAssistantDock from '@/components/ai/GrokAssistantDock'
import { buildPeriodHref, previousComparablePeriods } from '@/lib/period-selection'
import { usePublishFinancialScope } from '@/components/layout/financial-scope'

interface ComparativoViewProps {
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  initialRuc: string
  initialPeriodosA: string[]
  initialPeriodosB: string[]
  initialData: ComparativoData | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pctDiff(a: number, b: number): number | null {
  if (a === 0) return null
  return (b - a) / Math.abs(a)
}

function pctDiffLabel(a: number, b: number): string {
  const d = pctDiff(a, b)
  if (d === null) return '—'
  const sign = d >= 0 ? '+' : ''
  return `${sign}${(d * 100).toFixed(1)}%`
}

type Direction = 'up' | 'down' | 'neutral'
type DirectionPreference = 'up' | 'down' | 'neutral'

function varDirection(a: number, b: number): Direction {
  const diff = b - a
  const tolerance = Math.max(Math.abs(a), Math.abs(b), 1) * 1e-9
  if (Math.abs(diff) <= tolerance) return 'neutral'
  return diff > 0 ? 'up' : 'down'
}

const UP_IS_GOOD = new Set([
  'ingresos',
  'utilBruta',
  'margenBruto',
  'ebit',
  'ebitda',
  'margenEbitda',
  'utilAntesPT',
  'utilNeta',
  'margenNeto',
  'roe',
  'roa',
  'razonCorriente',
  'pruebaAcida',
  'capitalTrabajo',
  'coberturaIntereses',
])

const DOWN_IS_GOOD = new Set([
  'costo',
  'gastos',
  'pt',
  'ir',
  'razonEndeudamiento',
  'apalancamiento',
  'diasCobro',
  'diasInventario',
  'cce',
])

function preferredDirection(clave: string): DirectionPreference {
  if (UP_IS_GOOD.has(clave)) return 'up'
  if (DOWN_IS_GOOD.has(clave)) return 'down'
  return 'neutral'
}

function varColor(clave: string, dir: Direction): string {
  if (dir === 'neutral') return 'text-gray-500'
  const good = preferredDirection(clave)
  if (good === 'neutral') return 'text-gray-500'
  return dir === good ? 'text-green-600' : 'text-red-600'
}

function VarArrow({ dir, clave }: { dir: Direction; clave: string }) {
  if (dir === 'neutral') return <Minus className="h-3.5 w-3.5 text-gray-400" />
  const good = preferredDirection(clave)
  const color = good === 'neutral'
    ? 'text-gray-500'
    : dir === good
    ? 'text-green-600'
    : 'text-red-600'
  return dir === 'up'
    ? <TrendingUp className={`h-3.5 w-3.5 ${color}`} />
    : <TrendingDown className={`h-3.5 w-3.5 ${color}`} />
}

function fmtRatioVal(r: Ratio): string {
  if (r.valor === null) return 'N/D'
  switch (r.unidad) {
    case 'porcentaje': return fmtPct(r.valor)
    case 'veces':      return fmtVeces(r.valor)
    case 'dias':       return fmtDias(r.valor)
    case 'moneda':     return fmtMoneda(r.valor)
  }
}

function labelPeriodo(periods: string[]): string {
  if (periods.length === 0) return '—'
  const sorted = [...periods].sort()
  if (sorted.length === 1) return fmtPeriodo(sorted[0])
  const years = [...new Set(sorted.map(p => p.substring(0, 4)))]
  if (years.length === 1) return years[0]
  return `${fmtPeriodo(sorted[0])} – ${fmtPeriodo(sorted[sorted.length - 1])}`
}

// ─── KPI comparison card ──────────────────────────────────────────────────────

function KPICompare({
  titulo,
  valA,
  valB,
  rawA,
  rawB,
  clave,
}: {
  titulo: string
  valA: string
  valB: string
  rawA: number
  rawB: number
  clave: string
}) {
  const dir = varDirection(rawA, rawB)
  const pct = pctDiffLabel(rawA, rawB)
  const txtColor = varColor(clave, dir)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">Período A</p>
          <p className="text-base font-bold font-mono tabular-nums text-gray-900 truncate">{valA}</p>
        </div>
        <div className={`flex flex-col items-center gap-0.5 shrink-0 ${txtColor}`}>
          <VarArrow dir={dir} clave={clave} />
          <span className="text-xs font-semibold whitespace-nowrap">{pct}</span>
        </div>
        <div className="text-right min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">Período B</p>
          <p className="text-base font-bold font-mono tabular-nums text-gray-900 truncate">{valB}</p>
        </div>
      </div>
    </div>
  )
}

// ─── ERI comparison table ─────────────────────────────────────────────────────

interface ERIRow {
  concepto: string
  a: number
  b: number
  clave: string
  isMargen?: boolean
  indent?: boolean
  isBold?: boolean
  isNegative?: boolean  // show values as (negative)
}

function buildERIRows(a: DashboardData, b: DashboardData): ERIRow[] {
  const { eri: ea } = a
  const { eri: eb } = b

  return [
    { concepto: 'Ingresos netos',                 a: ea.ingresos.total,               b: eb.ingresos.total,               clave: 'ingresos',    isBold: true },
    { concepto: '(-) Costo de ventas',            a: ea.costoVentas.total,            b: eb.costoVentas.total,            clave: 'costo',       isNegative: true },
    { concepto: 'Utilidad bruta',                  a: ea.utilidadBruta,                b: eb.utilidadBruta,                clave: 'utilBruta',   isBold: true },
    { concepto: '  Margen bruto',                  a: ea.margenBruto,                  b: eb.margenBruto,                  clave: 'margenBruto', isMargen: true, indent: true },
    { concepto: '(-) Gastos de operación',         a: ea.gastosOperacion.total,        b: eb.gastosOperacion.total,        clave: 'gastos',      isNegative: true },
    { concepto: 'EBIT (Utilidad operacional)',      a: ea.utilidadOperacional,          b: eb.utilidadOperacional,          clave: 'ebit',        isBold: true },
    { concepto: 'EBITDA',                          a: ea.ebitda,                       b: eb.ebitda,                       clave: 'ebitda',      isBold: true },
    { concepto: '  Margen EBITDA',                 a: ea.margenEbitda,                 b: eb.margenEbitda,                 clave: 'margenEbitda',isMargen: true, indent: true },
    { concepto: 'Utilidad antes de PT e IR',       a: ea.utilidadAntesParticipacion,   b: eb.utilidadAntesParticipacion,   clave: 'utilAntesPT' },
    { concepto: '(-) Participación trabajadores',  a: ea.participacionTrabajadores,    b: eb.participacionTrabajadores,    clave: 'pt',          isNegative: true },
    { concepto: '(-) Impuesto a la renta',         a: ea.impuestoRenta,                b: eb.impuestoRenta,                clave: 'ir',          isNegative: true },
    { concepto: 'UTILIDAD NETA',                   a: ea.utilidadNeta,                 b: eb.utilidadNeta,                 clave: 'utilNeta',    isBold: true },
    { concepto: '  Margen neto',                   a: ea.margenNeto,                   b: eb.margenNeto,                   clave: 'margenNeto',  isMargen: true, indent: true },
  ]
}

function ERITable({ a, b }: { a: DashboardData; b: DashboardData }) {
  const rows = buildERIRows(a, b)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="py-2 pr-4 text-left font-medium w-2/5">Concepto</th>
            <th className="py-2 px-3 text-right font-medium">Período A</th>
            <th className="py-2 px-3 text-right font-medium">Período B</th>
            <th className="py-2 px-3 text-right font-medium">Var $</th>
            <th className="py-2 pl-3 text-right font-medium">Var %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isMargen = row.isMargen
            const varAbs = row.b - row.a
            const dir = varDirection(row.a, row.b)
            const pct = pctDiffLabel(row.a, row.b)
            const txtVar = varColor(row.clave, dir)

            const fmtVal = (v: number) =>
              isMargen ? fmtPct(v) : fmtMoneda(v)
            const fmtVar = (v: number) =>
              isMargen ? pct : `${varAbs >= 0 ? '+' : ''}${fmtMoneda(varAbs)}`

            return (
              <tr
                key={i}
                className={`border-b border-gray-100 ${row.isBold ? 'bg-gray-50' : ''} hover:bg-gray-50 transition-colors`}
              >
                <td className={`py-2 pr-4 ${row.indent ? 'pl-5 text-gray-400' : ''} ${row.isBold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {row.concepto}
                </td>
                <td className={`py-2 px-3 text-right font-mono tabular-nums ${row.isBold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {fmtVal(row.a)}
                </td>
                <td className={`py-2 px-3 text-right font-mono tabular-nums ${row.isBold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {fmtVal(row.b)}
                </td>
                {isMargen ? (
                  <>
                    <td className={`py-2 px-3 text-right font-mono tabular-nums text-xs ${txtVar}`}>—</td>
                    <td className={`py-2 pl-3 text-right font-mono tabular-nums text-xs ${txtVar}`}>{pct}</td>
                  </>
                ) : (
                  <>
                    <td className={`py-2 px-3 text-right font-mono tabular-nums text-xs ${txtVar}`}>
                      {varAbs >= 0 ? '+' : ''}{fmtMoneda(varAbs)}
                    </td>
                    <td className={`py-2 pl-3 text-right font-mono tabular-nums text-xs ${txtVar}`}>{pct}</td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Ratios comparison table ───────────────────────────────────────────────────

function RatiosCompare({ a, b }: { a: DashboardData; b: DashboardData }) {
  const grupos: [string, Ratio[], Ratio[]][] = [
    ['Rentabilidad',  a.metricas.rentabilidad,  b.metricas.rentabilidad],
    ['Liquidez',      a.metricas.liquidez,       b.metricas.liquidez],
    ['Endeudamiento', a.metricas.endeudamiento,  b.metricas.endeudamiento],
    ['Eficiencia',    a.metricas.eficiencia,     b.metricas.eficiencia],
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="py-2 pr-4 text-left font-medium w-2/5">Ratio</th>
            <th className="py-2 px-3 text-right font-medium">Período A</th>
            <th className="py-2 px-3 text-right font-medium">Período B</th>
            <th className="py-2 pl-3 text-right font-medium">Variación</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(([cat, ratiosA, ratiosB]) => (
            <>
              <tr key={`hdr-${cat}`} className="bg-gray-100">
                <td colSpan={4} className="py-1.5 px-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  {cat}
                </td>
              </tr>
              {ratiosA.map((rA, i) => {
                const rB = ratiosB[i]
                const hasBothValues = rA.valor !== null && rB?.valor !== null && rB?.valor !== undefined
                const valA = rA.valor ?? 0
                const valB = rB?.valor ?? 0
                const dir = hasBothValues ? varDirection(valA, valB) : 'neutral'
                const pct = hasBothValues ? pctDiffLabel(valA, valB) : '—'
                const txtColor = varColor(rA.clave, dir)

                return (
                  <tr key={rA.clave} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-4 text-gray-600">{rA.etiqueta}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-gray-700">
                      {fmtRatioVal(rA)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-gray-700">
                      {rB ? fmtRatioVal(rB) : 'N/D'}
                    </td>
                    <td className={`py-2 pl-3 text-right font-mono tabular-nums text-xs ${txtColor}`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        <VarArrow dir={dir} clave={rA.clave} />
                        {pct}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ComparativoView({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriodosA,
  initialPeriodosB,
  initialData,
}: ComparativoViewProps) {
  const [selectedRuc, setSelectedRuc]       = useState(initialRuc)
  const [periodosA, setPeriodosA]           = useState(initialPeriodosA)
  const [periodosB, setPeriodosB]           = useState(initialPeriodosB)
  const [data, setData]                     = useState(initialData)
  const [isPending, startTransition]        = useTransition()
  const [isLoading, setIsLoading]           = useState(false)
  const requestIdRef                        = useRef(0)

  // Keep the sidebar in sync — use período B (the most recent) as the active scope.
  usePublishFinancialScope(selectedRuc, periodosB)

  useEffect(() => {
    if (!initialData && initialPeriodosA.length > 0 && initialPeriodosB.length > 0) {
      reload(initialRuc, initialPeriodosA, initialPeriodosB)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reload(ruc: string, pA: string[], pB: string[]) {
    const requestId = ++requestIdRef.current
    if (pA.length === 0 || pB.length === 0) {
      setData(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    void getComparativoData(ruc, pA, pB)
      .then(next => {
        if (requestId !== requestIdRef.current) return
        startTransition(() => setData(next))
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return
        console.error('No se pudo cargar el comparativo', error)
        startTransition(() => setData(null))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false)
      })
  }

  function handleRucChange(ruc: string) {
    const allPeriods = periodsByRuc[ruc] ?? []
    const years = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()
    const lastYear = years[years.length - 1] ?? ''
    const prevYear = years.length >= 2 ? years[years.length - 2] : lastYear
    const pA = allPeriods.filter(p => p.startsWith(prevYear))
    const pB = allPeriods.filter(p => p.startsWith(lastYear))
    setSelectedRuc(ruc)
    setPeriodosA(pA)
    setPeriodosB(pB)
    reload(ruc, pA, pB)
  }

  function handlePeriodosAChange(periods: string[]) {
    setPeriodosA(periods)
    reload(selectedRuc, periods, periodosB)
  }

  function handlePeriodosBChange(periods: string[]) {
    setPeriodosB(periods)
    reload(selectedRuc, periodosA, periods)
  }

  function handleAiAction(action: AiUiAction) {
    const nextRuc = action.ruc && allRucs.includes(action.ruc) ? action.ruc : selectedRuc
    const available = periodsByRuc[nextRuc] ?? []
    const actionA = (action.periodosA ?? []).filter(period => available.includes(period))
    const actionB = (action.periodosB ?? []).filter(period => available.includes(period))
    const actionPeriods = (action.periodos ?? []).filter(period => available.includes(period))
    const nextB = actionB.length > 0 ? actionB : actionPeriods
    const nextA = actionA.length > 0 ? actionA : previousComparablePeriods(available, nextB)
    if (nextA.length === 0 || nextB.length === 0) return
    setSelectedRuc(nextRuc)
    setPeriodosA(nextA)
    setPeriodosB(nextB)
    reload(nextRuc, nextA, nextB)
  }

  async function handleExport() {
    if (!data) return
    const { exportarComparativo } = await import('@/lib/excel-export')
    exportarComparativo(selectedRuc, periodosA, periodosB, data.a, data.b)
  }

  const labelA = labelPeriodo(periodosA)
  const labelB = labelPeriodo(periodosB)
  const selectedPeriodsForAi = Array.from(new Set([...periodosA, ...periodosB])).sort()
  const dashboardHref = buildPeriodHref('/', selectedRuc, periodosB.length > 0 ? periodosB : periodosA)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 shadow-xs backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Link
                href={dashboardHref}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <span className="h-5 w-px bg-gray-200" />
              <h1 className="text-base font-semibold text-gray-900">Comparativo de períodos</h1>
              {(isPending || isLoading) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  Actualizando…
                </span>
              )}
            </div>
            <button
              onClick={handleExport}
                disabled={isPending || isLoading || !data}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar Excel
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* Period selectors */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-700">Período A</p>
            <PeriodSelector
              ruc={selectedRuc}
              allRucs={allRucs}
              periodsByRuc={periodsByRuc}
              selectedRuc={selectedRuc}
              selectedPeriods={periodosA}
              onRucChange={handleRucChange}
              onPeriodsChange={handlePeriodosAChange}
            />
            <p className="mt-2 text-xs text-blue-600 font-medium">{labelA}</p>
          </div>
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-purple-700">Período B</p>
            <PeriodSelector
              ruc={selectedRuc}
              allRucs={allRucs}
              periodsByRuc={periodsByRuc}
              selectedRuc={selectedRuc}
              selectedPeriods={periodosB}
              onRucChange={handleRucChange}
              onPeriodsChange={handlePeriodosBChange}
            />
            <p className="mt-2 text-xs text-purple-600 font-medium">{labelB}</p>
          </div>
        </section>

        {!data ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-xs">
            <p className="text-sm text-gray-500">
              {isLoading
                ? 'Cargando comparativo...'
                : periodosA.length > 0 && periodosB.length > 0
                ? 'No hay datos para comparar en los periodos seleccionados.'
                : 'Selecciona dos periodos para comparar'}
            </p>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">KPIs — {labelA} vs {labelB}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <KPICompare
                  titulo="Ingresos"
                  valA={fmtMoneda(data.a.eri.ingresos.total)}
                  valB={fmtMoneda(data.b.eri.ingresos.total)}
                  rawA={data.a.eri.ingresos.total}
                  rawB={data.b.eri.ingresos.total}
                  clave="ingresos"
                />
                <KPICompare
                  titulo="Utilidad neta"
                  valA={fmtMoneda(data.a.eri.utilidadNeta)}
                  valB={fmtMoneda(data.b.eri.utilidadNeta)}
                  rawA={data.a.eri.utilidadNeta}
                  rawB={data.b.eri.utilidadNeta}
                  clave="utilNeta"
                />
                <KPICompare
                  titulo="Margen bruto"
                  valA={fmtPct(data.a.eri.margenBruto)}
                  valB={fmtPct(data.b.eri.margenBruto)}
                  rawA={data.a.eri.margenBruto}
                  rawB={data.b.eri.margenBruto}
                  clave="margenBruto"
                />
                <KPICompare
                  titulo="Margen neto"
                  valA={fmtPct(data.a.eri.margenNeto)}
                  valB={fmtPct(data.b.eri.margenNeto)}
                  rawA={data.a.eri.margenNeto}
                  rawB={data.b.eri.margenNeto}
                  clave="margenNeto"
                />
              </div>
            </section>

            {/* ERI comparison */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
              <h2 className="mb-4 text-sm font-semibold text-gray-700">
                Estado de Resultados — {labelA} vs {labelB}
              </h2>
              <ERITable a={data.a} b={data.b} />
            </section>

            {/* Ratios comparison */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
              <h2 className="mb-4 text-sm font-semibold text-gray-700">
                Ratios financieros — {labelA} vs {labelB}
              </h2>
              <RatiosCompare a={data.a} b={data.b} />
            </section>
          </>
        )}
      </main>
      <GrokAssistantDock
        ruc={selectedRuc}
        selectedPeriods={selectedPeriodsForAi}
        onApplyAction={handleAiAction}
      />
    </div>
  )
}
