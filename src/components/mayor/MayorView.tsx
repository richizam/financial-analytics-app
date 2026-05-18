'use client'

import { useState, useTransition } from 'react'
import { Download, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { getMayorPageData } from '@/app/actions'
import type { MayorPageData } from '@/app/actions'
import { fmtNumero, fmtContable, fmtPeriodo } from '@/lib/format'
import { exportarMayor } from '@/lib/excel-export'
import PeriodSelector from '@/components/dashboard/PeriodSelector'

interface MayorViewProps {
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  initialRuc: string
  initialPeriods: string[]
  initialData: MayorPageData
}

export default function MayorView({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriods,
  initialData,
}: MayorViewProps) {
  const [selectedRuc, setSelectedRuc]       = useState(initialRuc)
  const [selectedPeriods, setSelectedPeriods] = useState(initialPeriods)
  const [data, setData]                     = useState(initialData)
  const [isPending, startTransition]        = useTransition()

  function reload(ruc: string, periods: string[], cuenta: string | null) {
    if (periods.length === 0) return
    startTransition(async () => {
      const next = await getMayorPageData(ruc, periods, cuenta)
      setData(next)
    })
  }

  function handleRucChange(ruc: string) {
    const defaultPeriods = periodsByRuc[ruc] ?? []
    const years = [...new Set(defaultPeriods.map(p => p.substring(0, 4)))].sort()
    const lastYear = years[years.length - 1] ?? ''
    const periods = defaultPeriods.filter(p => p.startsWith(lastYear))
    setSelectedRuc(ruc)
    setSelectedPeriods(periods)
    reload(ruc, periods, null)
  }

  function handlePeriodsChange(periods: string[]) {
    setSelectedPeriods(periods)
    reload(selectedRuc, periods, data.selectedCuenta)
  }

  function handleCuentaChange(codCuenta: string) {
    reload(selectedRuc, selectedPeriods, codCuenta)
  }

  function handleExport() {
    if (data.mayor) exportarMayor(selectedRuc, selectedPeriods, data.mayor)
  }

  const { mayor, cuentas, selectedCuenta } = data

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
              <Link
                href="/"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <div className="h-4 w-px bg-gray-200" />
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white text-xs font-bold">LM</div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">Libro Mayor</h1>
                <p className="text-xs text-gray-500">{periodoLabel}</p>
              </div>
              {isPending && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Cargando…
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
              <button
                onClick={handleExport}
                disabled={isPending || !mayor}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar Excel
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
        {/* ── Selector de cuenta ── */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Cuenta:</label>
          <select
            value={selectedCuenta ?? ''}
            onChange={e => handleCuentaChange(e.target.value)}
            disabled={isPending || cuentas.length === 0}
            className="flex-1 max-w-lg rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {cuentas.map(c => (
              <option key={c.codCuenta} value={c.codCuenta}>
                {c.codCuenta} — {c.nombreCuenta}
              </option>
            ))}
            {cuentas.length === 0 && (
              <option value="">Sin cuentas disponibles</option>
            )}
          </select>
        </div>

        {/* ── Tabla del Mayor ── */}
        {mayor ? (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-5 py-3 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">
                <span className="font-mono text-gray-400 mr-2">{mayor.codCuenta}</span>
                {mayor.nombreCuenta}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Fecha</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">N° Asiento</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Descripción</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Debe</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Haber</th>
                    <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Saldo acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Fila de saldo inicial */}
                  <tr className="border-b border-blue-100 bg-blue-50">
                    <td className="py-2 px-3 text-xs font-medium text-blue-700 whitespace-nowrap">Apertura</td>
                    <td className="py-2 px-3 font-mono text-xs text-blue-400">—</td>
                    <td className="py-2 px-3 text-xs text-blue-700 italic">Saldo inicial del año</td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-blue-400">—</td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-blue-400">—</td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                      {fmtContable(mayor.saldoInicial)}
                    </td>
                  </tr>

                  {/* Movimientos */}
                  {mayor.entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                        Sin movimientos en el período seleccionado
                      </td>
                    </tr>
                  ) : (
                    mayor.entries.map((entry, i) => (
                      <tr
                        key={i}
                        className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-1.5 px-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {entry.fecha}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                          {entry.asiento}
                        </td>
                        <td className="py-1.5 px-3 text-sm text-gray-700 max-w-sm">
                          <span className="inline-block truncate max-w-xs" title={entry.descripcion}>
                            {entry.descripcion}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-sm tabular-nums text-gray-900">
                          {entry.debe > 0 ? fmtNumero(entry.debe) : ''}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-sm tabular-nums text-gray-900">
                          {entry.haber > 0 ? fmtNumero(entry.haber) : ''}
                        </td>
                        <td className={`py-1.5 px-3 text-right font-mono text-sm tabular-nums font-medium ${entry.saldo < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {fmtContable(entry.saldo)}
                        </td>
                      </tr>
                    ))
                  )}

                  {/* Fila de totales */}
                  <tr className="border-t-2 border-gray-900 bg-gray-50">
                    <td colSpan={3} className="py-2.5 px-3 text-sm font-bold text-gray-900">
                      Totales del período
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
                      {fmtNumero(mayor.totalDebe)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
                      {fmtNumero(mayor.totalHaber)}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono text-sm font-bold tabular-nums ${mayor.saldoFinal < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmtContable(mayor.saldoFinal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-sm text-gray-400 shadow-sm">
            Selecciona un período y una cuenta para ver el mayor
          </div>
        )}
      </main>
    </div>
  )
}
