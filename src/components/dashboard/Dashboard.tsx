'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { TrendingUp, DollarSign, Percent, Activity, Download, BookOpen, ShieldAlert, GitCompare } from 'lucide-react'
import { getDashboardData } from '@/app/actions'
import type { DashboardData } from '@/app/actions'
import { fmtMoneda, fmtPct, fmtVeces, fmtPeriodo } from '@/lib/format'
import { exportarExcel } from '@/lib/excel-export'
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
  initialData: DashboardData
}

type TabId = 'esf' | 'eri'

export default function Dashboard({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriods,
  initialData,
}: DashboardProps) {
  const [selectedRuc, setSelectedRuc]       = useState(initialRuc)
  const [selectedPeriods, setSelectedPeriods] = useState(initialPeriods)
  const [data, setData]                     = useState(initialData)
  const [activeTab, setActiveTab]           = useState<TabId>('eri')
  const [isPending, startTransition]        = useTransition()

  function reload(ruc: string, periods: string[]) {
    if (periods.length === 0) return
    startTransition(async () => {
      const next = await getDashboardData(ruc, periods)
      if (next) setData(next)
    })
  }

  function handleRucChange(ruc: string) {
    const defaultPeriods = periodsByRuc[ruc] ?? []
    // Default: último año disponible completo
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

  function handleExport() {
    exportarExcel(selectedRuc, selectedPeriods, eri, esf, metricas)
  }

  // ── Etiqueta del período seleccionado ──
  const periodoLabel = selectedPeriods.length === 1
    ? fmtPeriodo(selectedPeriods[0])
    : selectedPeriods.length > 1
    ? `${fmtPeriodo(selectedPeriods[0])} – ${fmtPeriodo(selectedPeriods[selectedPeriods.length - 1])}`
    : '—'

  // ── KPIs ──
  const { eri, esf, metricas, monthlyChart } = data
  const rcRatio = metricas.liquidez.find(r => r.clave === 'razonCorriente')
  const mbRatio = metricas.rentabilidad.find(r => r.clave === 'margenBruto')

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
                <p className="text-xs text-gray-500">{periodoLabel}</p>
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
                href="/comparativo"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <GitCompare className="h-3.5 w-3.5" />
                Comparativo
              </Link>
              <Link
                href="/anomalies"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Anomalías
              </Link>
              <Link
                href="/mayor"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Libro Mayor
              </Link>
              <button
                onClick={handleExport}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar Excel
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* ── KPI Cards ── */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KPICard
            titulo="Ingresos"
            valor={fmtMoneda(eri.ingresos.total)}
            subtitulo={periodoLabel}
            estado="gray"
            Icon={DollarSign}
          />
          <KPICard
            titulo="Utilidad neta"
            valor={fmtMoneda(eri.utilidadNeta)}
            subtitulo={`Margen ${fmtPct(eri.margenNeto)}`}
            estado={metricas.rentabilidad.find(r => r.clave === 'margenNeto')?.estado ?? 'gray'}
            Icon={TrendingUp}
          />
          <KPICard
            titulo="Margen bruto"
            valor={fmtPct(eri.margenBruto)}
            subtitulo={`EBITDA ${fmtPct(eri.margenEbitda)}`}
            estado={mbRatio?.estado ?? 'gray'}
            Icon={Percent}
          />
          <KPICard
            titulo="Razón corriente"
            valor={rcRatio?.valor != null ? fmtVeces(rcRatio.valor) : 'N/D'}
            subtitulo="Liquidez"
            estado={rcRatio?.estado ?? 'gray'}
            Icon={Activity}
          />
        </section>

        {/* ── Gráfico P&L mensual ── */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">
            Ingresos · Costo de ventas · Utilidad bruta — por mes
          </h2>
          {monthlyChart.length > 0
            ? <PLBarChart data={monthlyChart} />
            : <p className="py-12 text-center text-sm text-gray-400">Sin datos para el período seleccionado</p>
          }
        </section>

        {/* ── Estados financieros en pestañas ── */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Tabs */}
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
            {activeTab === 'eri' ? <ERIView eri={eri} /> : (
              <ESFView
                esf={esf}
                utilidadNeta={eri.utilidadNeta}
                ptEnAsientos={eri.ptEnAsientos}
                irEnAsientos={eri.irEnAsientos}
                pt={eri.participacionTrabajadores}
                ir={eri.impuestoRenta}
              />
            )}
          </div>
        </section>

        {/* ── Tabla de ratios ── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Ratios financieros — Sector comercial</h2>
          <RatiosTable
            metricas={metricas}
            esf={esf}
            eri={eri}
            diasPeriodo={
              selectedPeriods.length === 1 ? 30
              : selectedPeriods.length <= 3  ? 90
              : selectedPeriods.length <= 6  ? 180
              : 365
            }
          />
        </section>
      </main>
    </div>
  )
}
