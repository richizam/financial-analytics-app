'use client'

import type { MetricsResult, Ratio } from '@/lib/metrics'
import { fmtPct, fmtVeces, fmtDias, fmtMoneda } from '@/lib/format'

const SEMAFERO: Record<string, { dot: string; bg: string; text: string }> = {
  green:  { dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  yellow: { dot: 'bg-amber-400',   bg: 'bg-amber-50',    text: 'text-amber-700'   },
  red:    { dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-700'     },
  gray:   { dot: 'bg-gray-300',    bg: 'bg-gray-50',     text: 'text-gray-400'    },
}

function formatValor(r: Ratio): string {
  if (r.valor === null) return 'N/D'
  switch (r.unidad) {
    case 'porcentaje': return fmtPct(r.valor)
    case 'veces':      return fmtVeces(r.valor)
    case 'dias':       return fmtDias(r.valor)
    case 'moneda':     return fmtMoneda(r.valor)
    default:           return String(r.valor)
  }
}

function RatioRow({ r }: { r: Ratio }) {
  const s = SEMAFERO[r.estado]
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
      <td className="py-2.5 pl-4 pr-2 text-sm text-gray-700">{r.etiqueta}</td>
      <td className="py-2.5 px-2 text-right font-mono text-sm font-medium text-gray-900 tabular-nums">
        {formatValor(r)}
      </td>
      <td className="py-2.5 pl-2 pr-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {r.estado === 'green' ? 'Bueno' : r.estado === 'yellow' ? 'Normal' : r.estado === 'red' ? 'Alerta' : 'S/D'}
        </span>
      </td>
      {r.umbral && (
        <td className="py-2.5 pr-4 text-xs text-gray-400 hidden xl:table-cell">
          alerta {r.unidad === 'porcentaje' ? fmtPct(r.umbral.alerta) : r.unidad === 'dias' ? fmtDias(r.umbral.alerta) : r.umbral.alerta.toFixed(2)}
          {' · '}bueno {r.unidad === 'porcentaje' ? fmtPct(r.umbral.bueno) : r.unidad === 'dias' ? fmtDias(r.umbral.bueno) : r.umbral.bueno.toFixed(2)}
        </td>
      )}
      {!r.umbral && <td className="hidden xl:table-cell" />}
    </tr>
  )
}

function GrupoRatios({ titulo, ratios }: { titulo: string; ratios: Ratio[] }) {
  if (ratios.length === 0) return null
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {titulo}
        </td>
      </tr>
      {ratios.map(r => <RatioRow key={r.clave} r={r} />)}
    </>
  )
}

export default function RatiosTable({ metricas }: { metricas: MetricsResult }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="py-3 pl-4 pr-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ratio</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
            <th className="py-3 pl-2 pr-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
            <th className="py-3 pr-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Referencia</th>
          </tr>
        </thead>
        <tbody>
          <GrupoRatios titulo="Rentabilidad"  ratios={metricas.rentabilidad}  />
          <GrupoRatios titulo="Liquidez"      ratios={metricas.liquidez}      />
          <GrupoRatios titulo="Endeudamiento" ratios={metricas.endeudamiento} />
          <GrupoRatios titulo="Eficiencia"    ratios={metricas.eficiencia}    />
        </tbody>
      </table>
    </div>
  )
}
