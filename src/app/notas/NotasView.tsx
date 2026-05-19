'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { getNotasData } from '@/app/actions'
import type { NotasData } from '@/app/actions'
import type { StatementItem } from '@/lib/statements'
import PeriodSelector from '@/components/dashboard/PeriodSelector'
import { fmtPeriodo, fmtNumero } from '@/lib/format'

interface NotasViewProps {
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  initialRuc: string
  initialPeriods: string[]
  initialData: NotasData | null
  companyNames: Record<string, string>
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

function fmtUSD(cents: number): string {
  return `$ ${fmtNumero(Math.abs(cents))}`
}

function periodoLabel(periodos: string[]): string {
  if (periodos.length === 0) return '—'
  const sorted = [...periodos].sort()
  if (sorted.length === 1) return fmtPeriodo(sorted[0])
  return `${fmtPeriodo(sorted[0])} – ${fmtPeriodo(sorted[sorted.length - 1])}`
}

function fechaFin(periodos: string[]): string {
  if (periodos.length === 0) return '—'
  const last = [...periodos].sort().pop()!
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre']
  const year  = parseInt(last.substring(0, 4))
  const month = parseInt(last.substring(4, 6))
  // Último día del mes
  const lastDay = new Date(year, month, 0).getDate()
  return `${lastDay} de ${meses[month - 1]} de ${year}`
}

function fechaInicio(periodos: string[]): string {
  if (periodos.length === 0) return '—'
  const first = [...periodos].sort()[0]
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre']
  const year  = parseInt(first.substring(0, 4))
  const month = parseInt(first.substring(4, 6))
  return `1 de ${meses[month - 1]} de ${year}`
}

// ─── Componente de tabla de nota ──────────────────────────────────────────────

function TablaItems({ items, total, labelTotal }: {
  items: StatementItem[]
  total: number
  labelTotal?: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 italic">No hay movimientos en este período.</p>
  }
  return (
    <table className="w-full text-sm border-collapse mt-3">
      <thead>
        <tr className="border-b border-gray-300">
          <th className="text-left py-1.5 pr-4 font-semibold text-gray-600 w-20">Código</th>
          <th className="text-left py-1.5 pr-4 font-semibold text-gray-600">Cuenta</th>
          <th className="text-right py-1.5 font-semibold text-gray-600 w-36">Saldo (USD)</th>
        </tr>
      </thead>
      <tbody>
        {items.map(it => (
          <tr key={it.codCuenta} className="border-b border-gray-100">
            <td className="py-1 pr-4 text-gray-500 font-mono text-xs">{it.codCuenta}</td>
            <td className="py-1 pr-4 text-gray-700">{it.nombreCuenta}</td>
            <td className="py-1 text-right text-gray-800">{fmtUSD(it.monto)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-gray-400">
          <td colSpan={2} className="py-1.5 font-bold text-gray-800">
            {labelTotal ?? 'Total'}
          </td>
          <td className="py-1.5 text-right font-bold text-gray-800">{fmtUSD(total)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

// ─── Sección de nota ──────────────────────────────────────────────────────────

function Nota({ numero, titulo, children }: {
  numero: number
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10 print:mb-8 print:break-inside-avoid-page">
      <h2 className="text-base font-bold text-gray-900 border-b-2 border-gray-800 pb-1 mb-4">
        NOTA {numero} — {titulo.toUpperCase()}
      </h2>
      <div className="text-sm text-gray-700 space-y-3 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

// ─── Notas completas ──────────────────────────────────────────────────────────

function NotasDocumento({ data }: { data: NotasData }) {
  const { esf, eri, config, ruc, periodos } = data
  const empresa    = config?.razonSocial ?? `Empresa RUC ${ruc}`
  const framework  = config?.niifFramework === 'completas' ? 'NIIF Completas' : 'NIIF para PYMES'
  const sector     = config?.sector ?? 'comercial'
  const tieneInv   = config?.tieneInventarios ?? true
  const tieneActFj = config?.tieneActivosFijos ?? true
  const metodo     = config?.metodoInventarios ?? 'Promedio Ponderado'
  const inicio     = fechaInicio(periodos)
  const fin        = fechaFin(periodos)

  // Filtros de cuentas por grupo
  const efectivo       = esf.activosCorrientes.items.filter(i => i.codCuenta.startsWith('1.1.1'))
  const cxc            = esf.activosCorrientes.items.filter(i => i.codCuenta.startsWith('1.1.2') || i.codCuenta.startsWith('1.1.3'))
  const inventarios    = esf.activosCorrientes.items.filter(i => i.codCuenta.startsWith('1.1.4') || i.codCuenta.startsWith('1.1.5'))
  const otrosActCte    = esf.activosCorrientes.items.filter(i =>
    !i.codCuenta.startsWith('1.1.1') && !i.codCuenta.startsWith('1.1.2') &&
    !i.codCuenta.startsWith('1.1.3') && !i.codCuenta.startsWith('1.1.4') && !i.codCuenta.startsWith('1.1.5')
  )
  const ppe            = esf.activosNoCorrientes.items
  const pasivosCtes    = esf.pasivosCorrientes.items
  const pasivosLp      = esf.pasivosNoCorrientes.items
  const patrimonio     = esf.patrimonio.items

  const totalEfectivo  = efectivo.reduce((s, i) => s + i.monto, 0)
  const totalCxc       = cxc.reduce((s, i) => s + i.monto, 0)
  const totalInv       = inventarios.reduce((s, i) => s + i.monto, 0)
  const totalPpe       = ppe.reduce((s, i) => s + i.monto, 0)

  return (
    <div className="font-serif">
      {/* Encabezado del documento */}
      <div className="text-center mb-10 print:mb-8 border-b-2 border-gray-800 pb-6">
        <h1 className="text-lg font-bold text-gray-900 uppercase tracking-wide">{empresa}</h1>
        <p className="text-sm text-gray-600 mt-1">RUC: {ruc}</p>
        <p className="text-sm font-semibold text-gray-800 mt-3">
          NOTAS A LOS ESTADOS FINANCIEROS
        </p>
        <p className="text-sm text-gray-600">Por el período del {inicio} al {fin}</p>
        <p className="text-xs text-gray-500 mt-1">(Expresados en Dólares de los Estados Unidos de América)</p>
      </div>

      {/* ── Nota 1 ─────────────────────────────────────────────────────────── */}
      <Nota numero={1} titulo="Información General">
        <p>
          <strong>{empresa}</strong> (en adelante "la Empresa") es una entidad jurídica constituida y
          domiciliada en la República del Ecuador, identificada con Registro Único de Contribuyentes
          (RUC) N.° <strong>{ruc}</strong>.
        </p>
        <p>
          Los presentes estados financieros comprenden el período del <strong>{inicio}</strong> al{' '}
          <strong>{fin}</strong>, y han sido preparados de conformidad con{' '}
          <strong>{framework}</strong>, adoptadas en Ecuador mediante resolución de la
          Superintendencia de Compañías, Valores y Seguros.
        </p>
        <p>
          La actividad principal de la Empresa corresponde al sector{' '}
          <strong>{sector}</strong>. La Empresa no cotiza en bolsa de valores.
        </p>
      </Nota>

      {/* ── Nota 2 ─────────────────────────────────────────────────────────── */}
      <Nota numero={2} titulo="Bases de Preparación y Políticas Contables Significativas">
        <p className="font-semibold text-gray-800">2.1 Marco de referencia normativo</p>
        <p>
          Los estados financieros han sido preparados de conformidad con <strong>{framework}</strong>,
          emitidas por el Consejo de Normas Internacionales de Contabilidad (IASB) y adoptadas en
          Ecuador. Las políticas contables descritas en esta nota han sido aplicadas de manera uniforme
          durante todos los períodos presentados.
        </p>

        <p className="font-semibold text-gray-800">2.2 Moneda funcional y de presentación</p>
        <p>
          La moneda funcional y de presentación de la Empresa es el Dólar de los Estados Unidos de
          América (USD), que a su vez es la moneda de curso legal en Ecuador. Todos los importes
          están expresados en dólares con dos decimales.
        </p>

        <p className="font-semibold text-gray-800">2.3 Base de medición</p>
        <p>
          Los estados financieros han sido preparados sobre la base del costo histórico, excepto
          donde se indique lo contrario en notas específicas.
        </p>

        <p className="font-semibold text-gray-800">2.4 Reconocimiento de ingresos</p>
        <p>
          Los ingresos provenientes de la venta de bienes y/o prestación de servicios se reconocen
          cuando la Empresa transfiere el control de los bienes o servicios al cliente, en un monto
          que refleja la contraprestación a la que la Empresa espera tener derecho a cambio de dichos
          bienes o servicios. Los ingresos por intereses se reconocen de forma proporcional al tiempo
          transcurrido, aplicando el método del interés efectivo.
        </p>

        {tieneInv && (
          <>
            <p className="font-semibold text-gray-800">2.5 Inventarios</p>
            <p>
              Los inventarios son activos mantenidos para la venta en el curso ordinario del negocio.
              Se valoran al costo o al valor neto de realización, el que resulte menor. El método
              de asignación de costo utilizado es <strong>{metodo}</strong>. El costo incluye el
              precio de adquisición y todos los costos directamente atribuibles hasta dejar los
              inventarios en condición de uso o venta.
            </p>
          </>
        )}

        {tieneActFj && (
          <>
            <p className="font-semibold text-gray-800">{tieneInv ? '2.6' : '2.5'} Propiedad, Planta y Equipo</p>
            <p>
              Los activos de propiedad, planta y equipo se reconocen inicialmente al costo de
              adquisición o construcción, y se presentan netos de la depreciación acumulada. La
              depreciación se calcula por el método de línea recta, durante la vida útil estimada de
              cada clase de activo. Las vidas útiles se revisan al cierre de cada período. Las
              mejoras significativas que extienden la vida útil se capitalizan; los costos de
              mantenimiento ordinario se cargan a resultados cuando se incurren.
            </p>
          </>
        )}

        <p className="font-semibold text-gray-800">{tieneInv && tieneActFj ? '2.7' : tieneInv || tieneActFj ? '2.6' : '2.5'} Cuentas por cobrar comerciales</p>
        <p>
          Las cuentas por cobrar se reconocen inicialmente al importe de la transacción. La Empresa
          evalúa al cierre de cada período si existe evidencia objetiva de deterioro. Las cuentas
          consideradas incobrables se registran como gasto en el período en que se determina su
          irrecuperabilidad.
        </p>

        <p className="font-semibold text-gray-800">{tieneInv && tieneActFj ? '2.8' : tieneInv || tieneActFj ? '2.7' : '2.6'} Impuesto a la Renta y Participación de Trabajadores</p>
        <p>
          El gasto por impuesto a la renta se calcula aplicando la tasa vigente del 25% sobre
          la utilidad gravable del período, conforme a la Ley de Régimen Tributario Interno del
          Ecuador. La participación de trabajadores corresponde al 15% de las utilidades, conforme
          al Código de Trabajo.
        </p>
      </Nota>

      {/* ── Nota 3 ─────────────────────────────────────────────────────────── */}
      <Nota numero={3} titulo="Efectivo y Equivalentes de Efectivo">
        <p>
          Al <strong>{fin}</strong>, el efectivo y equivalentes de efectivo comprenden los saldos en
          caja y cuentas bancarias a la vista. Su composición es la siguiente:
        </p>
        <TablaItems
          items={efectivo}
          total={totalEfectivo}
          labelTotal="Total efectivo y equivalentes"
        />
        {efectivo.length === 0 && (
          <p className="text-xs text-gray-500 mt-2">
            No se registraron cuentas del grupo 1.1.1 en el período seleccionado.
          </p>
        )}
      </Nota>

      {/* ── Nota 4 ─────────────────────────────────────────────────────────── */}
      <Nota numero={4} titulo="Cuentas por Cobrar Comerciales y Otras Cuentas por Cobrar">
        <p>
          Las cuentas por cobrar al <strong>{fin}</strong> se detallan a continuación:
        </p>
        <TablaItems
          items={cxc}
          total={totalCxc}
          labelTotal="Total cuentas por cobrar"
        />
        <p className="text-xs text-gray-500 mt-2">
          La Empresa no ha constituido provisión por deterioro de cartera en el período presentado,
          dado que no existe evidencia objetiva de incobr abilidad en las cuentas vigentes. Esta
          evaluación se realiza al cierre de cada ejercicio fiscal.
        </p>
      </Nota>

      {/* ── Nota 5 — Inventarios (solo si tiene) ─────────────────────────── */}
      {tieneInv && (
        <Nota numero={5} titulo="Inventarios">
          <p>
            Los inventarios al <strong>{fin}</strong>, valorados al método de{' '}
            <strong>{metodo}</strong>, se presentan de la siguiente manera:
          </p>
          <TablaItems
            items={inventarios}
            total={totalInv}
            labelTotal="Total inventarios"
          />
          <p className="text-xs text-gray-500 mt-2">
            No se han identificado deterioros significativos del valor neto de realización en el
            período. Los inventarios no han sido dados en garantía de obligaciones financieras.
          </p>
        </Nota>
      )}

      {/* ── Nota 5 o 6 — Otros activos corrientes ─────────────────────────── */}
      {otrosActCte.length > 0 && (
        <Nota numero={tieneInv ? 6 : 5} titulo="Otros Activos Corrientes">
          <p>Otros activos corrientes al <strong>{fin}</strong>:</p>
          <TablaItems
            items={otrosActCte}
            total={otrosActCte.reduce((s, i) => s + i.monto, 0)}
            labelTotal="Total otros activos corrientes"
          />
        </Nota>
      )}

      {/* ── Nota PPE ───────────────────────────────────────────────────────── */}
      {tieneActFj && (
        <Nota numero={tieneInv ? (otrosActCte.length > 0 ? 7 : 6) : (otrosActCte.length > 0 ? 6 : 5)} titulo="Propiedad, Planta y Equipo">
          <p>
            Los activos de propiedad, planta y equipo netos al <strong>{fin}</strong> son los
            siguientes:
          </p>
          <TablaItems
            items={ppe}
            total={totalPpe}
            labelTotal="Total propiedad, planta y equipo (neto)"
          />
          <p className="text-xs text-gray-500 mt-2">
            Los saldos presentados corresponden al valor neto en libros (costo menos depreciación
            acumulada). La Empresa no ha constituido garantías reales sobre estos activos, salvo
            que se indique lo contrario en contratos específicos.
          </p>
        </Nota>
      )}

      {/* ── Nota Pasivos ───────────────────────────────────────────────────── */}
      <Nota numero={tieneInv && tieneActFj ? 8 : tieneInv || tieneActFj ? 7 : 6} titulo="Obligaciones y Cuentas por Pagar">
        <p className="font-semibold text-gray-800">Pasivos Corrientes</p>
        <TablaItems
          items={pasivosCtes}
          total={esf.pasivosCorrientes.total}
          labelTotal="Total pasivos corrientes"
        />
        {pasivosLp.length > 0 && (
          <>
            <p className="font-semibold text-gray-800 mt-4">Pasivos No Corrientes</p>
            <TablaItems
              items={pasivosLp}
              total={esf.pasivosNoCorrientes.total}
              labelTotal="Total pasivos no corrientes"
            />
          </>
        )}
        <p className="text-xs text-gray-500 mt-2">
          Las cuentas por pagar comerciales se liquidan generalmente en un plazo de 30 a 90 días.
          Las obligaciones financieras de largo plazo corresponden a créditos formalizados mediante
          contratos de préstamo con entidades del sistema financiero ecuatoriano.
        </p>
      </Nota>

      {/* ── Nota Patrimonio ────────────────────────────────────────────────── */}
      <Nota numero={tieneInv && tieneActFj ? 9 : tieneInv || tieneActFj ? 8 : 7} titulo="Patrimonio Neto">
        <p>
          La composición del patrimonio neto al <strong>{fin}</strong> es la siguiente:
        </p>
        <TablaItems
          items={patrimonio}
          total={esf.totalPatrimonio}
          labelTotal="Total patrimonio neto"
        />
        <p className="text-xs text-gray-500 mt-2">
          El capital suscrito y pagado se encuentra debidamente registrado en la Superintendencia
          de Compañías, Valores y Seguros del Ecuador.
        </p>
      </Nota>

      {/* ── Nota Ingresos ──────────────────────────────────────────────────── */}
      <Nota numero={tieneInv && tieneActFj ? 10 : tieneInv || tieneActFj ? 9 : 8} titulo="Ingresos de Actividades Ordinarias">
        <p>
          Los ingresos generados durante el período del <strong>{inicio}</strong> al{' '}
          <strong>{fin}</strong> se desglosan a continuación:
        </p>
        <TablaItems
          items={eri.ingresos.items}
          total={eri.ingresos.total}
          labelTotal="Total ingresos"
        />
        <p className="text-xs text-gray-500 mt-2">
          Los ingresos se reconocen en el momento en que la Empresa transfiere el control de los
          bienes o servicios al cliente, conforme a los criterios de reconocimiento establecidos
          en la Nota 2.4. No existen ingresos diferidos ni contratos con clientes con
          compromisos de desempeño pendientes de cumplimiento al cierre del período.
        </p>
      </Nota>

      {/* ── Nota Costos y Gastos ───────────────────────────────────────────── */}
      <Nota numero={tieneInv && tieneActFj ? 11 : tieneInv || tieneActFj ? 10 : 9} titulo="Costos y Gastos de Operación">
        <p className="font-semibold text-gray-800">Costo de ventas</p>
        <TablaItems
          items={eri.costoVentas.items}
          total={eri.costoVentas.total}
          labelTotal="Total costo de ventas"
        />

        {eri.gastosOperacion.items.length > 0 && (
          <>
            <p className="font-semibold text-gray-800 mt-4">Gastos de operación</p>
            <TablaItems
              items={eri.gastosOperacion.items}
              total={eri.gastosOperacion.total}
              labelTotal="Total gastos de operación"
            />
          </>
        )}

        {eri.otrosGastos.items.length > 0 && (
          <>
            <p className="font-semibold text-gray-800 mt-4">Otros gastos</p>
            <TablaItems
              items={eri.otrosGastos.items}
              total={eri.otrosGastos.total}
              labelTotal="Total otros gastos"
            />
          </>
        )}

        <p className="text-xs text-gray-500 mt-3">
          Los gastos se reconocen en el período en que se incurren, de conformidad con el principio
          de devengo. La participación de trabajadores (15%) e impuesto a la renta (25%) se calculan
          sobre la utilidad del ejercicio conforme a la legislación ecuatoriana vigente.
        </p>
      </Nota>

      {/* Firma */}
      <div className="mt-16 pt-6 border-t border-gray-300 grid grid-cols-2 gap-16 text-center text-sm text-gray-600 print:mt-12">
        <div>
          <div className="border-t border-gray-500 pt-2 mt-16">
            <p className="font-semibold text-gray-800">Representante Legal</p>
            <p className="text-xs mt-0.5">Nombre y firma</p>
          </div>
        </div>
        <div>
          <div className="border-t border-gray-500 pt-2 mt-16">
            <p className="font-semibold text-gray-800">Contador / Auditor</p>
            <p className="text-xs mt-0.5">Nombre, firma y número de matrícula</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────

export default function NotasView({
  allRucs,
  periodsByRuc,
  initialRuc,
  initialPeriods,
  initialData,
  companyNames,
}: NotasViewProps) {
  const [selectedRuc, setSelectedRuc]       = useState(initialRuc)
  const [selectedPeriods, setSelectedPeriods] = useState(initialPeriods)
  const [data, setData]                     = useState(initialData)
  const [isPending, startTransition]          = useTransition()

  function reload(ruc: string, periods: string[]) {
    if (periods.length === 0) return
    startTransition(async () => {
      const next = await getNotasData(ruc, periods)
      setData(next)
    })
  }

  function handleRucChange(ruc: string) {
    const allP = periodsByRuc[ruc] ?? []
    const years = [...new Set(allP.map(p => p.substring(0, 4)))].sort()
    const lastY = years[years.length - 1] ?? ''
    const periods = allP.filter(p => p.startsWith(lastY))
    setSelectedRuc(ruc)
    setSelectedPeriods(periods)
    reload(ruc, periods)
  }

  function handlePeriodsChange(periods: string[]) {
    setSelectedPeriods(periods)
    reload(selectedRuc, periods)
  }

  const label = periodoLabel(selectedPeriods)
  const empresa = companyNames[selectedRuc] ?? selectedRuc

  return (
    <div className={`min-h-screen bg-gray-50 transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`}>
      {/* Barra superior — se oculta al imprimir */}
      <header className="print:hidden sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 flex-wrap">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={15} /> Volver
          </Link>

          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {/* Selector de RUC */}
            <select
              value={selectedRuc}
              onChange={e => handleRucChange(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {allRucs.map(ruc => (
                <option key={ruc} value={ruc}>
                  {companyNames[ruc] ?? ruc} — {ruc}
                </option>
              ))}
            </select>

            {/* Selector de período */}
            <PeriodSelector
              allPeriods={periodsByRuc[selectedRuc] ?? []}
              selectedPeriods={selectedPeriods}
              onChange={handlePeriodsChange}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-400">{label}</span>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
            >
              <Printer size={15} />
              Imprimir / PDF
            </button>
          </div>
        </div>
      </header>

      {/* Documento */}
      <main className="mx-auto max-w-4xl px-6 py-10 print:p-0 print:max-w-none">
        {/* Encabezado pantalla */}
        <div className="print:hidden mb-6">
          <h1 className="text-xl font-bold text-gray-900">Notas a los Estados Financieros</h1>
          <p className="text-sm text-gray-500 mt-0.5">{empresa} · {label}</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white px-10 py-12 shadow-sm print:shadow-none print:border-none print:rounded-none print:px-0 print:py-0">
          {data ? (
            <NotasDocumento data={data} />
          ) : (
            <div className="text-center py-20 text-sm text-gray-400">
              Selecciona un RUC y período para generar las notas.
            </div>
          )}
        </div>
      </main>

      {/* Estilos de impresión */}
      <style jsx global>{`
        @media print {
          @page { margin: 2cm; size: A4; }
          body { font-size: 11pt; }
          header, nav { display: none !important; }
        }
      `}</style>
    </div>
  )
}
