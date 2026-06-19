'use client'

import type { ERI } from '@/lib/statements'
import { fmtNumero, fmtPct } from '@/lib/format'

function Row({ label, monto, indent = false, bold = false, topBorder = false }: {
  label: string; monto: number; indent?: boolean; bold?: boolean; topBorder?: boolean
}) {
  return (
    <tr className={`${topBorder ? 'border-t border-gray-300' : 'border-b border-gray-50'} hover:bg-gray-50 transition-colors`}>
      <td className={`py-1.5 ${indent ? 'pl-10' : 'pl-4'} pr-2 text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {label}
      </td>
      <td className={`py-1.5 pr-4 text-right font-mono text-sm tabular-nums ${bold ? 'font-bold text-gray-900' : monto < 0 ? 'text-red-500' : 'text-gray-900'}`}>
        {monto < 0 ? `(${fmtNumero(-monto)})` : fmtNumero(monto)}
      </td>
    </tr>
  )
}

function SubRow({ label, cod }: { label: string; cod: string }) {
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50">
      <td className="py-1.5 pl-10 pr-2 text-sm text-gray-500">
        <span className="font-mono text-xs text-gray-400 mr-2">{cod}</span>{label}
      </td>
      <td />
    </tr>
  )
}

function TotalRow({ label, monto, margen, highlight = false }: {
  label: string; monto: number; margen?: number; highlight?: boolean
}) {
  return (
    <tr className={`border-t-2 border-gray-900 ${highlight ? 'bg-blue-50' : ''}`}>
      <td className="py-2.5 pl-4 text-sm font-bold text-gray-900">{label}</td>
      <td className="py-2.5 pr-4 text-right">
        <span className="font-mono text-sm font-bold text-gray-900 tabular-nums">{fmtNumero(monto)}</span>
        {margen !== undefined && (
          <span className="ml-2 text-xs text-gray-400">[{fmtPct(margen)}]</span>
        )}
      </td>
    </tr>
  )
}

export default function ERIView({ eri }: { eri: ERI }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-gray-900">
            <th className="py-2 pl-4 text-left text-xs font-bold uppercase text-gray-700">Concepto</th>
            <th className="py-2 pr-4 text-right text-xs font-bold uppercase text-gray-700">USD</th>
          </tr>
        </thead>
        <tbody>
          {/* INGRESOS */}
          <tr><td colSpan={2} className="pt-5 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Ingresos</td></tr>
          {eri.ingresos.items.map(i => (
            <Row key={i.codCuenta} label={i.nombreCuenta} monto={i.monto} indent />
          ))}
          <Row label="Ingresos netos" monto={eri.ingresos.total} bold topBorder />

          {/* COSTO DE VENTAS */}
          <tr><td colSpan={2} className="pt-3 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Costo de ventas</td></tr>
          {eri.costoVentas.items.map(i => (
            <Row key={i.codCuenta} label={i.nombreCuenta} monto={-i.monto} indent />
          ))}
          <TotalRow label="UTILIDAD BRUTA" monto={eri.utilidadBruta} margen={eri.margenBruto} />

          {/* GASTOS OPERACION */}
          <tr><td colSpan={2} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Gastos de operación</td></tr>
          {eri.gastosOperacion.items.map(i => (
            <Row key={i.codCuenta} label={i.nombreCuenta} monto={i.monto} indent />
          ))}
          <TotalRow label="UTILIDAD OPERACIONAL (EBIT)" monto={eri.utilidadOperacional} />
          <tr className="bg-gray-50 border-b border-gray-100">
            <td className="py-1.5 pl-4 text-xs text-gray-500">EBITDA (EBIT + Deprec. y Amort.)</td>
            <td className="py-1.5 pr-4 text-right font-mono text-xs text-gray-700 tabular-nums">
              {fmtNumero(eri.ebitda)} <span className="text-gray-400">[{fmtPct(eri.margenEbitda)}]</span>
            </td>
          </tr>

          {/* OTROS GASTOS */}
          {eri.otrosGastos.items.length > 0 && (
            <>
              <tr><td colSpan={2} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Otros gastos</td></tr>
              {eri.otrosGastos.items.map(i => (
                <Row key={i.codCuenta} label={i.nombreCuenta} monto={i.monto} indent />
              ))}
            </>
          )}

          {/* CASCADA FISCAL */}
          <tr className="border-t border-gray-200">
            <td className="py-1.5 pl-4 text-sm text-gray-700 font-medium">Utilidad antes de PT e IR</td>
            <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums">{fmtNumero(eri.utilidadAntesParticipacion)}</td>
          </tr>

          {/* Advertencia si PT/IR no están registrados en asientos */}
          {(!eri.ptEnAsientos || !eri.irEnAsientos) && (
            <tr>
              <td colSpan={2} className="px-4 py-2">
                <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                  ⚠ Pendiente registrar provisión{!eri.ptEnAsientos && !eri.irEnAsientos ? ' PT e IR' : !eri.ptEnAsientos ? ' PT' : ' IR'} en asientos de cierre — diferencia estimada:{' '}
                  <span className="font-semibold font-mono">
                    {fmtNumero((!eri.ptEnAsientos ? eri.participacionTrabajadores : 0) + (!eri.irEnAsientos ? eri.impuestoRenta : 0))}
                  </span>
                </div>
              </td>
            </tr>
          )}

          <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td className={`py-1.5 pl-10 pr-2 text-sm text-gray-600`}>
              (-) Participación trabajadores 15%
              {!eri.ptEnAsientos && (
                <span className="ml-2 text-xs font-medium bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm">Estimado</span>
              )}
            </td>
            <td className={`py-1.5 pr-4 text-right font-mono text-sm tabular-nums ${eri.participacionTrabajadores > 0 ? 'text-red-500' : 'text-gray-900'}`}>
              {eri.participacionTrabajadores > 0 ? `(${fmtNumero(eri.participacionTrabajadores)})` : fmtNumero(0)}
            </td>
          </tr>

          <tr className="border-b border-gray-100">
            <td className="py-1.5 pl-4 text-sm text-gray-700 font-medium">Utilidad antes de IR</td>
            <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums">{fmtNumero(eri.utilidadAntesIR)}</td>
          </tr>

          <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td className="py-1.5 pl-10 pr-2 text-sm text-gray-600">
              (-) Impuesto a la Renta 25%
              {!eri.irEnAsientos && (
                <span className="ml-2 text-xs font-medium bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm">Estimado</span>
              )}
            </td>
            <td className={`py-1.5 pr-4 text-right font-mono text-sm tabular-nums ${eri.impuestoRenta > 0 ? 'text-red-500' : 'text-gray-900'}`}>
              {eri.impuestoRenta > 0 ? `(${fmtNumero(eri.impuestoRenta)})` : fmtNumero(0)}
            </td>
          </tr>

          {/* RESULTADO FINAL */}
          <TotalRow label="UTILIDAD NETA" monto={eri.utilidadNeta} margen={eri.margenNeto} highlight />
        </tbody>
      </table>
    </div>
  )
}
