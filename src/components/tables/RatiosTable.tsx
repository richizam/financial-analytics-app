'use client'

import type { MetricsResult, Ratio } from '@/lib/metrics'
import type { ESF, ERI } from '@/lib/statements'
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

// ─── Tooltip formulas ─────────────────────────────────────────────────────────

function sumByPrefix(items: { codCuenta: string; monto: number }[], prefix: string): number {
  return items
    .filter(i => i.codCuenta.startsWith(prefix))
    .reduce((s, i) => s + Math.abs(i.monto), 0)
}

function getTooltip(clave: string, esf: ESF, eri: ERI, diasPeriodo: number): string | null {
  const AC  = esf.activosCorrientes.total
  const PC  = esf.pasivosCorrientes.total
  const TA  = esf.totalActivos
  const TP  = esf.totalPasivos
  const PAT = esf.totalPatrimonio
  const PAT_EF = PAT + eri.utilidadNeta  // patrimonio efectivo (incluye resultado del período)

  const INV = sumByPrefix(esf.activosCorrientes.items, '1.1.5')
  const CC  = sumByPrefix(esf.activosCorrientes.items, '1.1.3')
  const CP  = sumByPrefix(esf.pasivosCorrientes.items, '2.1.1')

  const ING = eri.ingresos.total
  const CV  = eri.costoVentas.total
  const UB  = eri.utilidadBruta
  const UN  = eri.utilidadNeta
  const UOP = eri.utilidadOperacional
  const EBT = eri.ebitda

  const M = fmtMoneda
  const P = (v: number) => fmtPct(v)

  switch (clave) {
    case 'margenBruto':
      if (!ING) return null
      return `Utilidad bruta ${M(UB)} ÷ Ingresos ${M(ING)} = ${P(eri.margenBruto)}`

    case 'margenNeto':
      if (!ING) return null
      return `Utilidad neta ${M(UN)} ÷ Ingresos ${M(ING)} = ${P(eri.margenNeto)}`

    case 'margenEbitda':
      if (!ING) return null
      return `EBITDA ${M(EBT)} ÷ Ingresos ${M(ING)} = ${P(eri.margenEbitda)}`

    case 'roe':
      if (!PAT_EF) return null
      return `Utilidad neta ${M(UN)} ÷ Patrimonio efectivo ${M(PAT_EF)} = ${P(UN / PAT_EF)}`

    case 'roa':
      if (!TA) return null
      return `Utilidad neta ${M(UN)} ÷ Activos totales ${M(TA)} = ${P(UN / TA)}`

    case 'razonCorriente':
      if (!PC) return null
      return `Activos corrientes ${M(AC)} ÷ Pasivos corrientes ${M(PC)} = ${fmtVeces(AC / PC)}`

    case 'pruebaAcida':
      if (!PC) return null
      return `(Act. corrientes ${M(AC)} − Inventarios ${M(INV)}) ÷ Pasivos corrientes ${M(PC)} = ${fmtVeces((AC - INV) / PC)}`

    case 'capitalTrabajo':
      return `Activos corrientes ${M(AC)} − Pasivos corrientes ${M(PC)} = ${M(AC - PC)}`

    case 'razonEndeudamiento':
      if (!TA) return null
      return `Pasivos totales ${M(TP)} ÷ Activos totales ${M(TA)} = ${P(TP / TA)}`

    case 'apalancamiento':
      if (!PAT_EF) return null
      return `Activos totales ${M(TA)} ÷ Patrimonio efectivo ${M(PAT_EF)} = ${fmtVeces(TA / PAT_EF)}`

    case 'coberturaIntereses':
      if (UOP === 0) return null
      return `EBIT ${M(UOP)} ÷ Gastos financieros — no registrados en el período`

    case 'diasCobro':
      if (!CC || !ING) return null
      return `Cuentas por cobrar ${M(CC)} ÷ Ingresos ${M(ING)} × ${diasPeriodo} días = ${fmtDias((CC / ING) * diasPeriodo)}`

    case 'diasInventario':
      if (!INV || !CV) return null
      return `Inventarios ${M(INV)} ÷ Costo de ventas ${M(CV)} × ${diasPeriodo} días = ${fmtDias((INV / CV) * diasPeriodo)}`

    case 'diasPago':
      if (!CP || !CV) return null
      return `Cuentas por pagar ${M(CP)} ÷ Costo de ventas ${M(CV)} × ${diasPeriodo} días = ${fmtDias((CP / CV) * diasPeriodo)}`

    case 'cce': {
      if (!CC || !ING || !INV || !CV || !CP) return null
      const dc = (CC / ING) * diasPeriodo
      const di = (INV / CV) * diasPeriodo
      const dp = (CP  / CV) * diasPeriodo
      return `Días cobro ${fmtDias(dc)} + Días inventario ${fmtDias(di)} − Días pago ${fmtDias(dp)} = ${fmtDias(dc + di - dp)}`
    }

    default:
      return null
  }
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function RatioRow({ r, tooltip }: { r: Ratio; tooltip: string | null }) {
  const s = SEMAFERO[r.estado]
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
      <td className="py-2.5 pl-4 pr-2 text-sm text-gray-700">
        <span className="group relative inline-flex items-center gap-1.5 cursor-default">
          {r.etiqueta}
          {tooltip && (
            <span className="text-gray-300 text-[10px] leading-none select-none">ⓘ</span>
          )}
          {tooltip && (
            <span
              role="tooltip"
              className="
                invisible group-hover:visible
                opacity-0 group-hover:opacity-100
                transition-opacity duration-150
                absolute left-0 top-full mt-1.5 z-50
                w-72 rounded-lg border border-gray-200 bg-white
                px-3 py-2.5 shadow-xl
                text-xs font-normal text-gray-700 leading-relaxed
                whitespace-normal pointer-events-none
              "
            >
              {tooltip}
            </span>
          )}
        </span>
      </td>
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

function GrupoRatios({
  titulo, ratios, esf, eri, diasPeriodo,
}: {
  titulo: string
  ratios: Ratio[]
  esf: ESF
  eri: ERI
  diasPeriodo: number
}) {
  if (ratios.length === 0) return null
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {titulo}
        </td>
      </tr>
      {ratios.map(r => (
        <RatioRow
          key={r.clave}
          r={r}
          tooltip={getTooltip(r.clave, esf, eri, diasPeriodo)}
        />
      ))}
    </>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────

export default function RatiosTable({
  metricas,
  esf,
  eri,
  diasPeriodo,
}: {
  metricas: MetricsResult
  esf: ESF
  eri: ERI
  diasPeriodo: number
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xs">
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
          <GrupoRatios titulo="Rentabilidad"  ratios={metricas.rentabilidad}  esf={esf} eri={eri} diasPeriodo={diasPeriodo} />
          <GrupoRatios titulo="Liquidez"      ratios={metricas.liquidez}      esf={esf} eri={eri} diasPeriodo={diasPeriodo} />
          <GrupoRatios titulo="Endeudamiento" ratios={metricas.endeudamiento} esf={esf} eri={eri} diasPeriodo={diasPeriodo} />
          <GrupoRatios titulo="Eficiencia"    ratios={metricas.eficiencia}    esf={esf} eri={eri} diasPeriodo={diasPeriodo} />
        </tbody>
      </table>
    </div>
  )
}
