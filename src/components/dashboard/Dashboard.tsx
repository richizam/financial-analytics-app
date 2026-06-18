'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { TrendingUp, DollarSign, Percent, Activity, Download, BookOpen, ShieldAlert, GitCompare, Plus, ArrowLeft, FolderOpen, FileText } from 'lucide-react'
import { getDashboardData } from '@/app/actions'
import type { AiUiAction, DashboardData } from '@/app/actions'
import { fmtMoneda, fmtPct, fmtVeces, fmtPeriodo } from '@/lib/format'
import { exportarExcel } from '@/lib/excel-export'
import { buildPeriodHref } from '@/lib/period-selection'
import GrokAssistantDock from '@/components/ai/GrokAssistantDock'
import KPICard from '@/components/ui/KPICard'
import PeriodSelector from '@/components/dashboard/PeriodSelector'
import PLBarChart from '@/components/charts/PLBarChart'
import RatiosTable from '@/components/tables/RatiosTable'
import ESFView from '@/components/statements/ESFView'
import ERIView from '@/components/statements/ERIView'

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
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center">
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
            Columnas: <code className="rounded bg-gray-200 px-1">fecha · asiento · tipo · codCuenta · nombreCuenta · descripcion · debe · haber</code>
          </p>
        </div>

        {fallbackRuc && fallbackName && (
          <button
            onClick={onGoBack}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
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

  // After /setup, select the newly created company
  useEffect(() => {
    const pendingRuc = sessionStorage.getItem('setup_ruc')
    if (pendingRuc && allRucs.includes(pendingRuc)) {
      sessionStorage.removeItem('setup_ruc')
      handleRucChange(pendingRuc)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reload(ruc: string, periods: string[]) {
    if (periods.length === 0) return
    startTransition(async () => {
      const next = await getDashboardData(ruc, periods)
      if (next) setData(next)
    })
  }

  function handleRucChange(ruc: string) {
    const defaultPeriods = periodsByRuc[ruc] ?? []
    const years = [...new Set(defaultPeriods.map(p => p.substring(0, 4)))].sort()
    const lastYear = years[years.length - 1] ?? ''
    const periods = defaultPeriods.filter(p => p.startsWith(lastYear))
    setSelectedRuc(ruc)
    setSelectedPeriods(periods)
    reload(ruc, periods)
  }

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

  // ── Derived state ──
  const hasNoPeriods = (periodsByRuc[selectedRuc] ?? []).length === 0

  // First RUC (other than current) that has CSV data — used for "← Volver" button
  const fallbackRuc = allRucs.find(r => r !== selectedRuc && (periodsByRuc[r] ?? []).length > 0) ?? null
  const periodHref = (pathname: string) => buildPeriodHref(pathname, selectedRuc, selectedPeriods)

  const periodoLabel = selectedPeriods.length === 1
    ? fmtPeriodo(selectedPeriods[0])
    : selectedPeriods.length > 1
    ? `${fmtPeriodo(selectedPeriods[0])} – ${fmtPeriodo(selectedPeriods[selectedPeriods.length - 1])}`
    : '—'

  return (
    <div className={`min-h-screen bg-gray-50 transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold">FA</div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">Financial Analytics</h1>
                <p className="text-xs text-gray-500">{hasNoPeriods ? (companyNames[selectedRuc] ?? selectedRuc) : periodoLabel}</p>
              </div>
              {isPending && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Actualizando…
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PeriodSelector
                ruc={selectedRuc}
                allRucs={allRucs}
                periodsByRuc={periodsByRuc}
                selectedRuc={selectedRuc}
                selectedPeriods={selectedPeriods}
                onRucChange={handleRucChange}
                onPeriodsChange={handlePeriodsChange}
              />
              <Link
                href="/setup"
                title="Nueva empresa"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-gray-500 shadow-sm hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
              <Link
                href={periodHref('/comparativo')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <GitCompare className="h-3.5 w-3.5" />
                Comparativo
              </Link>
              <Link
                href={periodHref('/anomalies')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Anomalías
              </Link>
              <Link
                href={periodHref('/mayor')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Libro Mayor
              </Link>
              <Link
                href={periodHref('/notas')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Notas NIIF
              </Link>
              <button
                onClick={() => data && exportarExcel(selectedRuc, selectedPeriods, data.eri, data.esf, data.metricas)}
                disabled={isPending || hasNoPeriods || !data}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar Excel
              </button>
            </div>
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
          {/* ── KPI Cards ── */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard
              titulo="Ingresos"
              valor={fmtMoneda(data.eri.ingresos.total)}
              subtitulo={periodoLabel}
              estado="gray"
              Icon={DollarSign}
            />
            <KPICard
              titulo="Utilidad neta"
              valor={fmtMoneda(data.eri.utilidadNeta)}
              subtitulo={`Margen ${fmtPct(data.eri.margenNeto)}`}
              estado={data.metricas.rentabilidad.find(r => r.clave === 'margenNeto')?.estado ?? 'gray'}
              Icon={TrendingUp}
            />
            <KPICard
              titulo="Margen bruto"
              valor={fmtPct(data.eri.margenBruto)}
              subtitulo={`EBITDA ${fmtPct(data.eri.margenEbitda)}`}
              estado={data.metricas.rentabilidad.find(r => r.clave === 'margenBruto')?.estado ?? 'gray'}
              Icon={Percent}
            />
            <KPICard
              titulo="Razón corriente"
              valor={data.metricas.liquidez.find(r => r.clave === 'razonCorriente')?.valor != null
                ? fmtVeces(data.metricas.liquidez.find(r => r.clave === 'razonCorriente')!.valor!)
                : 'N/D'}
              subtitulo="Liquidez"
              estado={data.metricas.liquidez.find(r => r.clave === 'razonCorriente')?.estado ?? 'gray'}
              Icon={Activity}
            />
          </section>

          {/* ── Gráfico P&L mensual ── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">
              Ingresos · Costo de ventas · Utilidad bruta — por mes
            </h2>
            {data.monthlyChart.length > 0
              ? <PLBarChart data={data.monthlyChart} />
              : <p className="py-12 text-center text-sm text-gray-400">Sin datos para el período seleccionado</p>
            }
          </section>

          {/* ── Estados financieros en pestañas ── */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex border-b border-gray-200">
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
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
          </section>

          {/* ── Tabla de ratios ── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Ratios financieros — Sector comercial</h2>
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
    </div>
  )
}
