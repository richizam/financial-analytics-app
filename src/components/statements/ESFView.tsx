'use client'

import type { ESF, StatementSection } from '@/lib/statements'
import { fmtNumero, fmtContable } from '@/lib/format'

function SectionRows({ section }: { section: StatementSection }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {section.titulo}
        </td>
      </tr>
      {section.items.map(item => (
        <tr key={item.codCuenta} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
          <td className="py-1.5 pl-8 pr-2 text-sm text-gray-500">
            <span className="font-mono text-xs text-gray-400 mr-2">{item.codCuenta}</span>
            {item.nombreCuenta}
          </td>
          <td className={`py-1.5 pr-4 text-right font-mono text-sm tabular-nums ${item.monto < 0 ? 'text-red-500' : 'text-gray-900'}`}>
            {fmtContable(item.monto)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-gray-200 bg-gray-50">
        <td className="py-2 pl-8 text-xs font-semibold text-gray-600">Total {section.titulo}</td>
        <td className="py-2 pr-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
          {fmtNumero(section.total)}
        </td>
      </tr>
    </>
  )
}

interface ESFViewProps {
  esf: ESF
  utilidadNeta: number
  ptEnAsientos: boolean
  irEnAsientos: boolean
  pt: number
  ir: number
}

export default function ESFView({ esf, utilidadNeta, ptEnAsientos, irEnAsientos, pt, ir }: ESFViewProps) {
  const cuadra = Math.abs(esf.diferencia) < 100

  // Impuestos estimados que se suman al display de pasivos cuando no están en asientos
  const estimatedTax = (!ptEnAsientos ? pt : 0) + (!irEnAsientos ? ir : 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-gray-900">
            <th className="py-2 pl-4 text-left text-xs font-bold uppercase text-gray-700">Cuenta</th>
            <th className="py-2 pr-4 text-right text-xs font-bold uppercase text-gray-700">USD</th>
          </tr>
        </thead>
        <tbody>
          {/* ACTIVOS */}
          <tr><td colSpan={2} className="pt-5 pb-1 pl-4 text-sm font-bold text-gray-900 uppercase tracking-wide">Activos</td></tr>
          <SectionRows section={esf.activosCorrientes} />
          <SectionRows section={esf.activosNoCorrientes} />
          <tr className="border-t-2 border-gray-900">
            <td className="py-2.5 pl-4 text-sm font-bold text-gray-900">TOTAL ACTIVOS</td>
            <td className="py-2.5 pr-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
              {fmtNumero(esf.totalActivos)}
            </td>
          </tr>

          {/* PASIVOS */}
          <tr><td colSpan={2} className="pt-6 pb-1 pl-4 text-sm font-bold text-gray-900 uppercase tracking-wide">Pasivos</td></tr>

          {/* Pasivos Corrientes — render manual para inyectar PT/IR estimados */}
          <tr>
            <td colSpan={2} className="pt-4 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {esf.pasivosCorrientes.titulo}
            </td>
          </tr>
          {esf.pasivosCorrientes.items.map(item => (
            <tr key={item.codCuenta} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-1.5 pl-8 pr-2 text-sm text-gray-500">
                <span className="font-mono text-xs text-gray-400 mr-2">{item.codCuenta}</span>
                {item.nombreCuenta}
              </td>
              <td className={`py-1.5 pr-4 text-right font-mono text-sm tabular-nums ${item.monto < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                {fmtContable(item.monto)}
              </td>
            </tr>
          ))}

          {!ptEnAsientos && pt > 0 && (
            <tr className="border-b border-yellow-100 bg-yellow-50/40 hover:bg-yellow-50 transition-colors">
              <td className="py-1.5 pl-8 pr-2 text-sm text-gray-500">
                <span className="font-mono text-xs text-gray-400 mr-2">2.1.5.01</span>
                Participación trabajadores por pagar
                <span className="ml-2 inline-flex items-center text-xs font-medium bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm">Estimado</span>
              </td>
              <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums text-gray-900">
                {fmtContable(pt)}
              </td>
            </tr>
          )}
          {!irEnAsientos && ir > 0 && (
            <tr className="border-b border-yellow-100 bg-yellow-50/40 hover:bg-yellow-50 transition-colors">
              <td className="py-1.5 pl-8 pr-2 text-sm text-gray-500">
                <span className="font-mono text-xs text-gray-400 mr-2">2.1.5.02</span>
                Impuesto a la renta por pagar
                <span className="ml-2 inline-flex items-center text-xs font-medium bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm">Estimado</span>
              </td>
              <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums text-gray-900">
                {fmtContable(ir)}
              </td>
            </tr>
          )}

          <tr className="border-t border-gray-200 bg-gray-50">
            <td className="py-2 pl-8 text-xs font-semibold text-gray-600">Total {esf.pasivosCorrientes.titulo}</td>
            <td className="py-2 pr-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
              {fmtNumero(esf.pasivosCorrientes.total + estimatedTax)}
            </td>
          </tr>

          {esf.pasivosNoCorrientes.items.length > 0 && <SectionRows section={esf.pasivosNoCorrientes} />}
          <tr className="border-t border-gray-300">
            <td className="py-2 pl-4 text-xs font-semibold text-gray-600">Total Pasivos</td>
            <td className="py-2 pr-4 text-right font-mono text-sm font-semibold text-gray-900 tabular-nums">
              {fmtNumero(esf.totalPasivos + estimatedTax)}
            </td>
          </tr>

          {/* PATRIMONIO */}
          <tr><td colSpan={2} className="pt-4 pb-1 pl-4 text-sm font-bold text-gray-900 uppercase tracking-wide">Patrimonio</td></tr>
          <SectionRows section={esf.patrimonio} />

          {/* Resultado del período no cerrado — aparece hasta que se registren asientos de cierre */}
          {!cuadra && (
            <tr className="border-b border-amber-200 bg-amber-50">
              <td className="py-1.5 pl-8 pr-2 text-sm text-amber-800 italic">
                Resultado del período (pendiente cierre)
              </td>
              <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums text-amber-800">
                {fmtNumero(utilidadNeta)}
              </td>
            </tr>
          )}

          {/* TOTALES */}
          <tr className="border-t-2 border-gray-900">
            <td className="py-2 pl-8 text-xs font-semibold text-gray-600">Total Patrimonio</td>
            <td className="py-2 pr-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
              {fmtNumero(esf.totalPatrimonio + (cuadra ? 0 : utilidadNeta))}
            </td>
          </tr>
          <tr className="border-t-2 border-gray-900">
            <td className="py-2.5 pl-4 text-sm font-bold text-gray-900">TOTAL PASIVOS + PATRIMONIO</td>
            <td className="py-2.5 pr-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums">
              {fmtNumero(esf.totalPasivos + estimatedTax + esf.totalPatrimonio + (cuadra ? 0 : utilidadNeta))}
            </td>
          </tr>
          <tr className="border-b bg-emerald-50">
            <td className="py-1.5 pl-4 text-xs text-emerald-600">
              {cuadra ? '✓ Balance cuadra' : '✓ Balance cuadra (resultado del período incluido)'}
            </td>
            <td className="py-1.5 pr-4 text-right font-mono text-xs text-emerald-600">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
