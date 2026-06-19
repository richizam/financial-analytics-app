'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react'
import { getAnomaliesData } from '@/app/actions'
import type { AiUiAction, AnomaliesData } from '@/app/actions'
import { fmtNumero, fmtPeriodo } from '@/lib/format'
import { buildPeriodHref } from '@/lib/period-selection'
import PeriodSelector from '@/components/dashboard/PeriodSelector'
import BenfordChart from '@/components/anomalies/BenfordChart'
import GrokAssistantDock from '@/components/ai/GrokAssistantDock'

interface AnomaliesViewProps {
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  initialRuc: string
  initialPeriods: string[]
  initialData: AnomaliesData | null
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

const NIVEL_STYLES = {
  green:  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', score: 'text-emerald-600', label: 'Riesgo bajo' },
  yellow: { bg: 'bg-yellow-50',  border: 'border-yellow-200',  text: 'text-yellow-700',  score: 'text-yellow-600',  label: 'Riesgo medio' },
  red:    { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     score: 'text-red-600',    label: 'Riesgo alto' },
}

function SectionCard({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AnomaliesView({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriods,
  initialData,
}: AnomaliesViewProps) {
  const [selectedRuc, setSelectedRuc]         = useState(initialRuc)
  const [selectedPeriods, setSelectedPeriods] = useState(initialPeriods)
  const [data, setData]                       = useState(initialData)
  const [isPending, startTransition]          = useTransition()

  function reload(ruc: string, periods: string[]) {
    if (periods.length === 0) return
    startTransition(async () => {
      const next = await getAnomaliesData(ruc, periods)
      setData(next)
    })
  }

  function handleRucChange(ruc: string) {
    const defaultPeriods = periodsByRuc[ruc] ?? []
    const years = [...new Set(defaultPeriods.map(p => p.substring(0, 4)))].sort()
    const lastYear = years[years.length - 1] ?? ''
    const periods  = defaultPeriods.filter(p => p.startsWith(lastYear))
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

  const dashboardHref = buildPeriodHref('/', selectedRuc, selectedPeriods)

  const periodoLabel = selectedPeriods.length === 1
    ? fmtPeriodo(selectedPeriods[0])
    : selectedPeriods.length > 1
    ? `${fmtPeriodo(selectedPeriods[0])} – ${fmtPeriodo(selectedPeriods[selectedPeriods.length - 1])}`
    : '—'

  return (
    <div className={`min-h-screen bg-gray-50 transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-xs">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Link href={dashboardHref} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <div className="h-4 w-px bg-gray-200" />
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white text-xs font-bold">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">Detección de Anomalías</h1>
                <p className="text-xs text-gray-500">{periodoLabel}</p>
              </div>
              {isPending && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Analizando…
                </span>
              )}
            </div>
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

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {!data ? (
          <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-sm text-gray-400 shadow-xs">
            Selecciona un período para analizar
          </div>
        ) : (
          <>
            {/* ── 1. Score de riesgo ── */}
            {(() => {
              const s = NIVEL_STYLES[data.riskScore.nivel]
              return (
                <section className={`rounded-xl border ${s.border} ${s.bg} p-6 shadow-xs`}>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`text-5xl font-black tabular-nums ${s.score}`}>
                        {data.riskScore.score}
                      </div>
                      <div>
                        <p className={`text-base font-bold ${s.text}`}>{s.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {data.totalEntries.toLocaleString()} asientos analizados · {periodoLabel}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-6 text-xs">
                      <div className="text-center">
                        <div className="font-mono font-bold text-gray-900 text-lg">{data.riskScore.components.benford}</div>
                        <div className="text-gray-500">Benford</div>
                      </div>
                      <div className="text-center">
                        <div className="font-mono font-bold text-gray-900 text-lg">{data.riskScore.components.duplicates}</div>
                        <div className="text-gray-500">Duplicados</div>
                      </div>
                      <div className="text-center">
                        <div className="font-mono font-bold text-gray-900 text-lg">{data.riskScore.components.outliers}</div>
                        <div className="text-gray-500">Outliers</div>
                      </div>
                    </div>
                  </div>
                  {/* Barra de progreso */}
                  <div className="mt-4 h-2 rounded-full bg-white/60">
                    <div
                      className={`h-2 rounded-full transition-all duration-700 ${
                        data.riskScore.nivel === 'green' ? 'bg-emerald-500' :
                        data.riskScore.nivel === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${data.riskScore.score}%` }}
                    />
                  </div>
                </section>
              )
            })()}

            {/* ── 2. Benford's Law ── */}
            <SectionCard
              title="Análisis de Benford's Law"
              badge={
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  data.benford.suspicious
                    ? 'bg-red-100 text-red-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {data.benford.suspicious
                    ? <AlertTriangle className="h-3 w-3" />
                    : <CheckCircle className="h-3 w-3" />
                  }
                  {data.benford.suspicious ? 'Distribución sospechosa' : 'Distribución normal'}
                </span>
              }
            >
              <div className="mb-3 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>Muestra: <strong className="text-gray-900">{data.benford.sampleSize.toLocaleString()}</strong> montos</span>
                <span>Chi²: <strong className={`font-mono ${data.benford.suspicious ? 'text-red-600' : 'text-gray-900'}`}>{data.benford.chiSquare.toFixed(2)}</strong></span>
                <span className="text-gray-400">Umbral sospechoso: 15.51 (p&lt;0.05)</span>
                <span className={`font-medium ${
                  data.benford.riskLevel === 'high'   ? 'text-red-600' :
                  data.benford.riskLevel === 'medium' ? 'text-yellow-600' : 'text-emerald-600'
                }`}>
                  {data.benford.riskLevel === 'high' ? 'Riesgo alto' :
                   data.benford.riskLevel === 'medium' ? 'Riesgo medio' : 'Normal'}
                </span>
              </div>
              <BenfordChart digits={data.benford.digits} suspicious={data.benford.suspicious} />
            </SectionCard>

            {/* ── 3. Duplicados ── */}
            <SectionCard
              title="Asientos con posibles duplicados"
              badge={
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  data.duplicates.length > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {data.duplicates.length} grupo{data.duplicates.length !== 1 ? 's' : ''}
                </span>
              }
            >
              {data.duplicates.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  No se encontraron asientos duplicados
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">
                    Mismo monto · misma cuenta · fecha ±3 días · distinto número de asiento
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cuenta</th>
                          <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Monto</th>
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">N° Asiento</th>
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Descripción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.duplicates.map((group, gi) => (
                          group.entries.map((entry, ei) => (
                            <tr
                              key={`${gi}-${ei}`}
                              className={`border-b border-gray-50 ${ei === 0 ? 'border-t-2 border-t-yellow-200 bg-yellow-50/30' : 'bg-yellow-50/10'}`}
                            >
                              {ei === 0 && (
                                <td rowSpan={group.entries.length} className="py-2 px-3 text-xs align-top border-r border-yellow-100">
                                  <span className="font-mono text-gray-400 block">{group.codCuenta}</span>
                                  <span className="text-gray-700">{group.nombreCuenta}</span>
                                </td>
                              )}
                              {ei === 0 && (
                                <td rowSpan={group.entries.length} className="py-2 px-3 text-right font-mono text-sm font-semibold text-gray-900 tabular-nums align-top border-r border-yellow-100">
                                  {fmtNumero(group.monto)}
                                </td>
                              )}
                              <td className="py-1.5 px-3 font-mono text-xs text-gray-500 whitespace-nowrap">{entry.fecha}</td>
                              <td className="py-1.5 px-3 font-mono text-xs text-gray-400 whitespace-nowrap">{entry.asiento}</td>
                              <td className="py-1.5 px-3 text-xs text-gray-600 max-w-xs truncate" title={entry.descripcion}>{entry.descripcion}</td>
                            </tr>
                          ))
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* ── 4. Outliers IQR ── */}
            <SectionCard
              title="Outliers por cuenta (método IQR)"
              badge={
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  data.outliers.length > 0 ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {data.outliers.length} transacción{data.outliers.length !== 1 ? 'es' : ''}
                </span>
              }
            >
              {data.outliers.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  No se encontraron valores atípicos
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                        <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cuenta</th>
                        <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Descripción</th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Monto</th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Veces rango</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outliers.slice(0, 30).map((o, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-1.5 px-3 font-mono text-xs text-gray-500 whitespace-nowrap">{o.fecha}</td>
                          <td className="py-1.5 px-3 text-xs">
                            <span className="font-mono text-gray-400 mr-1">{o.codCuenta}</span>
                            <span className="text-gray-700">{o.nombreCuenta}</span>
                          </td>
                          <td className="py-1.5 px-3 text-xs text-gray-600 max-w-xs truncate" title={o.descripcion}>{o.descripcion}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-sm tabular-nums text-gray-900">{fmtNumero(o.monto)}</td>
                          <td className="py-1.5 px-3 text-right">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                              o.deviationFactor > 5 ? 'bg-red-100 text-red-700' :
                              o.deviationFactor > 3 ? 'bg-orange-100 text-orange-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {o.direction === 'high' ? '▲' : '▼'} {o.deviationFactor.toFixed(1)}x
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.outliers.length > 30 && (
                    <p className="mt-2 text-center text-xs text-gray-400">
                      Mostrando 30 de {data.outliers.length} outliers — exporta a Excel para la lista completa
                    </p>
                  )}
                </div>
              )}
            </SectionCard>
          </>
        )}
      </main>

      <GrokAssistantDock
        ruc={selectedRuc}
        selectedPeriods={selectedPeriods}
        onApplyAction={handleAiAction}
      />
    </div>
  )
}
