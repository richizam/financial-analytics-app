'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { TrendingUp, DollarSign, Percent, Activity, ArrowLeft, FolderOpen } from 'lucide-react'
import { getDashboardData } from '@/app/actions'
import type { AiUiAction, DashboardData } from '@/app/actions'
import { fmtMoneda, fmtPct, fmtVeces, fmtPeriodo } from '@/lib/format'
import GrokAssistantDock from '@/components/ai/GrokAssistantDock'
import { usePublishFinancialScope } from '@/components/layout/financial-scope'
import StatCard from '@/components/dashboard/StatCard'
import PeriodSelector from '@/components/dashboard/PeriodSelector'
import RatiosTable from '@/components/tables/RatiosTable'
import ESFView from '@/components/statements/ESFView'
import ERIView from '@/components/statements/ERIView'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const chartLoading = (height: string) => () => (
  <div className={`flex ${height} items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground`}>
    Cargando gráfico…
  </div>
)

const PLBarChart = dynamic(() => import('@/components/charts/PLBarChart'), {
  ssr: false,
  loading: chartLoading('h-[300px]'),
})
const RevenueProfitChart = dynamic(() => import('@/components/charts/RevenueProfitChart'), {
  ssr: false,
  loading: chartLoading('h-[260px]'),
})
const MarginTrendChart = dynamic(() => import('@/components/charts/MarginTrendChart'), {
  ssr: false,
  loading: chartLoading('h-[260px]'),
})

interface DashboardProps {
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  initialRuc: string
  initialPeriods: string[]
  initialData: DashboardData | null
  companyNames: Record<string, string>
}

type TabId = 'esf' | 'eri'

// ─── Welcome screen (empresa sin archivos CSV todavía) ────────────────────────

function WelcomeScreen({
  ruc,
  companyName,
  fallbackRuc,
  fallbackName,
  onGoBack,
}: {
  ruc: string
  companyName: string
  fallbackRuc: string | null
  fallbackName: string | null
  onGoBack: () => void
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xs text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <FolderOpen className="h-7 w-7" />
        </div>

        <h2 className="text-lg font-bold text-gray-900">{companyName}</h2>
        <p className="mt-1 text-sm text-gray-500">RUC {ruc}</p>

        <p className="mt-5 text-sm text-gray-700">
          La empresa fue configurada correctamente.
          Aún no hay archivos de asientos contables.
        </p>

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Carga tus archivos de asientos en:
          </p>
          <div className="font-mono text-xs text-gray-700 space-y-1.5 leading-relaxed">
            <p className="text-gray-400">data/empresas/<span className="text-blue-600 font-semibold">{ruc}</span>/</p>
            <p className="pl-4">├── <span className="text-green-700">202501.csv</span>
              <span className="text-gray-400 ml-2">← diario enero 2025</span></p>
            <p className="pl-4">├── <span className="text-green-700">202502.csv</span>
              <span className="text-gray-400 ml-2">← diario febrero 2025</span></p>
            <p className="pl-4">├── <span className="text-green-700">...</span></p>
            <p className="pl-4">└── <span className="text-amber-700">saldos_iniciales_2025.csv</span>
              <span className="text-gray-400 ml-2">← apertura del año</span></p>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Columnas: <code className="rounded-sm bg-gray-200 px-1">fecha · asiento · tipo · codCuenta · nombreCuenta · descripcion · debe · haber</code>
          </p>
        </div>

        {fallbackRuc && fallbackName && (
          <button
            onClick={onGoBack}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a {fallbackName}
          </button>
        )}
      </div>
    </main>
  )
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriods,
  initialData,
  companyNames,
}: DashboardProps) {
  const [selectedRuc, setSelectedRuc]       = useState(initialRuc)
  const [selectedPeriods, setSelectedPeriods] = useState(initialPeriods)
  const [data, setData]                     = useState<DashboardData | null>(initialData)
  const [activeTab, setActiveTab]           = useState<TabId>('eri')
  const [isPending, startTransition]        = useTransition()
  const [isLoading, setIsLoading]           = useState(false)
  const requestIdRef                        = useRef(0)
  const setupAppliedRef                     = useRef(false)
  const searchParams                        = useSearchParams()

  // Defined before the effects below (and stabilised with useCallback) so they
  // can appear honestly in dependency arrays without stale-closure risk.
  const reload = useCallback((ruc: string, periods: string[]) => {
    const requestId = ++requestIdRef.current
    if (periods.length === 0) {
      setData(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    void getDashboardData(ruc, periods)
      .then(next => {
        if (requestId !== requestIdRef.current) return
        startTransition(() => setData(next))
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return
        console.error('No se pudo cargar el dashboard', error)
        startTransition(() => setData(null))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false)
      })
  }, [])

  const handleRucChange = useCallback((ruc: string) => {
    const defaultPeriods = periodsByRuc[ruc] ?? []
    const years = [...new Set(defaultPeriods.map(p => p.substring(0, 4)))].sort()
    const lastYear = years[years.length - 1] ?? ''
    const periods = defaultPeriods.filter(p => p.startsWith(lastYear))
    setSelectedRuc(ruc)
    setSelectedPeriods(periods)
    reload(ruc, periods)
  }, [periodsByRuc, reload])

  // After /setup, select the newly created company (mount-only: reads a
  // one-shot sessionStorage flag).
  useEffect(() => {
    const pendingRuc = sessionStorage.getItem('setup_ruc')
    if (pendingRuc && allRucs.includes(pendingRuc)) {
      sessionStorage.removeItem('setup_ruc')
      setupAppliedRef.current = true
      handleRucChange(pendingRuc)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initial data load (mount-only: hydrates the dashboard when the server
  // passed initialData={null}).
  useEffect(() => {
    if (!setupAppliedRef.current && !initialData && initialPeriods.length > 0) {
      reload(initialRuc, initialPeriods)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The sidebar switches companies by pushing a new URL (e.g. /?ruc=…). A
  // searchParams-only navigation doesn't reliably re-render this dynamic page
  // server-side (the client Router Cache can short-circuit it), so we react to
  // the URL param directly — useSearchParams() updates synchronously on client
  // navigation. We compare against the last ruc this effect applied (a ref),
  // not selectedRuc: the header PeriodSelector also mutates selectedRuc, and
  // reacting to that would revert an internal switch back to the URL value.
  const urlRuc = searchParams.get('ruc')
  const appliedUrlRucRef = useRef(initialRuc)
  useEffect(() => {
    if (!urlRuc || urlRuc === appliedUrlRucRef.current || !allRucs.includes(urlRuc)) return
    appliedUrlRucRef.current = urlRuc
    handleRucChange(urlRuc)
  }, [urlRuc, allRucs, handleRucChange])

  function handlePeriodsChange(periods: string[]) {
    setSelectedPeriods(periods)
    reload(selectedRuc, periods)
  }

  function handleAiAction(action: AiUiAction) {
    const nextRuc = action.ruc && allRucs.includes(action.ruc) ? action.ruc : selectedRuc
    const available = periodsByRuc[nextRuc] ?? []
    const nextPeriods = (action.periodos ?? []).filter(period => available.includes(period))
    if (nextPeriods.length === 0) return
    setSelectedRuc(nextRuc)
    setSelectedPeriods(nextPeriods)
    reload(nextRuc, nextPeriods)
  }

  // Share the active company + periods (and loaded data) with the sidebar so its
  // navigation links and global export reflect the current dashboard selection.
  usePublishFinancialScope(selectedRuc, selectedPeriods, data)

  // ── Derived state ──
  const hasNoPeriods = (periodsByRuc[selectedRuc] ?? []).length === 0

  // First RUC (other than current) that has CSV data — used for "← Volver" button
  const fallbackRuc = allRucs.find(r => r !== selectedRuc && (periodsByRuc[r] ?? []).length > 0) ?? null

  const periodoLabel = selectedPeriods.length === 1
    ? fmtPeriodo(selectedPeriods[0])
    : selectedPeriods.length > 1
    ? `${fmtPeriodo(selectedPeriods[0])} – ${fmtPeriodo(selectedPeriods[selectedPeriods.length - 1])}`
    : '—'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 shadow-xs backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          {/* Row 1 · title + active context */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-base font-semibold text-gray-900">Resumen general</h1>
            <span className="text-sm text-gray-400">·</span>
            <span className="truncate text-sm text-gray-500">{periodoLabel}</span>
            {(isPending || isLoading) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                Actualizando…
              </span>
            )}
          </div>
          {/* Row 2 · period selector */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <PeriodSelector
              ruc={selectedRuc}
              allRucs={allRucs}
              periodsByRuc={periodsByRuc}
              selectedRuc={selectedRuc}
              selectedPeriods={selectedPeriods}
              onRucChange={handleRucChange}
              onPeriodsChange={handlePeriodsChange}
            />
          </div>
        </div>
      </header>

      {/* ── Welcome screen when no CSV files yet ── */}
      {hasNoPeriods && (
        <WelcomeScreen
          ruc={selectedRuc}
          companyName={companyNames[selectedRuc] ?? selectedRuc}
          fallbackRuc={fallbackRuc}
          fallbackName={fallbackRuc ? (companyNames[fallbackRuc] ?? fallbackRuc) : null}
          onGoBack={() => fallbackRuc && handleRucChange(fallbackRuc)}
        />
      )}

      {/* ── Main dashboard content ── */}
      {!hasNoPeriods && data && (
        <>
        <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
          {/* ── KPI cards ── */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Ingresos"
              value={fmtMoneda(data.eri.ingresos.total)}
              sub={periodoLabel}
              estado="gray"
              Icon={DollarSign}
              spark={data.monthlyChart.map(m => m.ingresos)}
            />
            <StatCard
              label="Utilidad neta"
              value={fmtMoneda(data.eri.utilidadNeta)}
              sub={`Margen ${fmtPct(data.eri.margenNeto)}`}
              estado={data.metricas.rentabilidad.find(r => r.clave === 'margenNeto')?.estado ?? 'gray'}
              Icon={TrendingUp}
              spark={data.monthlyChart.map(m => m.utilidadNeta)}
            />
            <StatCard
              label="Margen bruto"
              value={fmtPct(data.eri.margenBruto)}
              sub={`EBITDA ${fmtPct(data.eri.margenEbitda)}`}
              estado={data.metricas.rentabilidad.find(r => r.clave === 'margenBruto')?.estado ?? 'gray'}
              Icon={Percent}
              spark={data.monthlyChart.map(m => (m.ingresos > 0 ? m.utilidadBruta / m.ingresos : 0))}
            />
            <StatCard
              label="Razón corriente"
              value={data.metricas.liquidez.find(r => r.clave === 'razonCorriente')?.valor != null
                ? fmtVeces(data.metricas.liquidez.find(r => r.clave === 'razonCorriente')!.valor!)
                : 'N/D'}
              sub="Liquidez"
              estado={data.metricas.liquidez.find(r => r.clave === 'razonCorriente')?.estado ?? 'gray'}
              Icon={Activity}
            />
          </section>

          {/* ── Charts ── */}
          {data.monthlyChart.length > 0 ? (
            <>
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Ingresos y utilidad neta</CardTitle>
                    <CardDescription>Evolución mensual</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RevenueProfitChart data={data.monthlyChart} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Evolución de márgenes</CardTitle>
                    <CardDescription>Margen bruto y neto por mes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MarginTrendChart data={data.monthlyChart} />
                  </CardContent>
                </Card>
              </section>

              <Card>
                <CardHeader>
                  <CardTitle>Ingresos · Costo de ventas · Utilidad bruta</CardTitle>
                  <CardDescription>Comparativa mensual</CardDescription>
                </CardHeader>
                <CardContent>
                  <PLBarChart data={data.monthlyChart} />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Sin datos para el período seleccionado
              </CardContent>
            </Card>
          )}

          {/* ── Estados financieros en pestañas ── */}
          <Card className="overflow-hidden">
            <div className="flex border-b border-border">
              {([
                { id: 'eri' as TabId, label: 'Estado de Resultados (ERI)' },
                { id: 'esf' as TabId, label: 'Situación Financiera (ESF)' },
              ]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {activeTab === 'eri' ? <ERIView eri={data.eri} /> : (
                <ESFView
                  esf={data.esf}
                  utilidadNeta={data.eri.utilidadNeta}
                  ptEnAsientos={data.eri.ptEnAsientos}
                  irEnAsientos={data.eri.irEnAsientos}
                  pt={data.eri.participacionTrabajadores}
                  ir={data.eri.impuestoRenta}
                />
              )}
            </div>
          </Card>

          {/* ── Tabla de ratios ── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Ratios financieros — Sector comercial</h2>
            <RatiosTable
              metricas={data.metricas}
              esf={data.esf}
              eri={data.eri}
              diasPeriodo={
                selectedPeriods.length === 1 ? 30
                : selectedPeriods.length <= 3  ? 90
                : selectedPeriods.length <= 6  ? 180
                : 365
              }
            />
          </section>
        </main>
          <GrokAssistantDock
            ruc={selectedRuc}
            selectedPeriods={selectedPeriods}
            onApplyAction={handleAiAction}
          />
        </>
      )}

      {!hasNoPeriods && !data && (
        <main className="mx-auto max-w-7xl px-4 py-6">
          <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-sm text-gray-400 shadow-xs">
            {isLoading ? 'Cargando dashboard...' : 'No hay datos para el periodo seleccionado.'}
          </div>
        </main>
      )}
    </div>
  )
}
