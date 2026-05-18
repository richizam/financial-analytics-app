import * as XLSX from 'xlsx'
import type { ESF, ERI, StatementSection } from './statements'
import type { MetricsResult, Ratio, SemaferoEstado } from './metrics'
import type { MayorData } from '@/app/actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = (string | number | null)[]

function c(cents: number): number {
  return Math.round(cents) / 100
}

function estadoTexto(estado: SemaferoEstado): string {
  if (estado === 'green')  return 'Bueno'
  if (estado === 'yellow') return 'Atención'
  if (estado === 'red')    return 'Alerta'
  return 'N/D'
}

function valorRatio(r: Ratio): number | string {
  if (r.valor === null) return 'N/D'
  return r.unidad === 'moneda' ? c(r.valor) : r.valor
}

function unidadRatio(r: Ratio): string {
  if (r.valor === null) return ''
  switch (r.unidad) {
    case 'porcentaje': return '%'
    case 'veces':      return 'x'
    case 'dias':       return 'días'
    case 'moneda':     return 'USD'
  }
}

// ─── ERI ──────────────────────────────────────────────────────────────────────

function buildERISheet(eri: ERI): XLSX.WorkSheet {
  const rows: Row[] = []

  rows.push(['Concepto', 'USD', 'Margen'])
  rows.push([])

  rows.push(['INGRESOS'])
  for (const item of eri.ingresos.items) {
    rows.push([`  ${item.nombreCuenta}`, c(item.monto)])
  }
  rows.push(['Ingresos netos', c(eri.ingresos.total)])
  rows.push([])

  rows.push(['COSTO DE VENTAS'])
  for (const item of eri.costoVentas.items) {
    rows.push([`  ${item.nombreCuenta}`, -c(item.monto)])
  }
  rows.push(['UTILIDAD BRUTA', c(eri.utilidadBruta), eri.margenBruto])
  rows.push([])

  rows.push(['GASTOS DE OPERACIÓN'])
  for (const item of eri.gastosOperacion.items) {
    rows.push([`  ${item.nombreCuenta}`, -c(item.monto)])
  }
  rows.push(['UTILIDAD OPERACIONAL (EBIT)', c(eri.utilidadOperacional)])
  rows.push(['EBITDA (EBIT + Deprec. y Amort.)', c(eri.ebitda), eri.margenEbitda])
  rows.push([])

  if (eri.otrosGastos.items.length > 0) {
    rows.push(['OTROS GASTOS'])
    for (const item of eri.otrosGastos.items) {
      rows.push([`  ${item.nombreCuenta}`, -c(item.monto)])
    }
    rows.push([])
  }

  rows.push(['Utilidad antes de PT e IR', c(eri.utilidadAntesParticipacion)])
  rows.push([
    `(-) Participación trabajadores 15%${eri.ptEnAsientos ? '' : ' [Estimado]'}`,
    -c(eri.participacionTrabajadores),
  ])
  rows.push(['Utilidad antes de IR', c(eri.utilidadAntesIR)])
  rows.push([
    `(-) Impuesto a la Renta 25%${eri.irEnAsientos ? '' : ' [Estimado]'}`,
    -c(eri.impuestoRenta),
  ])
  rows.push([])
  rows.push(['UTILIDAD NETA', c(eri.utilidadNeta), eri.margenNeto])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 52 }, { wch: 16 }, { wch: 12 }]
  return ws
}

// ─── ESF ──────────────────────────────────────────────────────────────────────

function addSectionRows(rows: Row[], section: StatementSection): void {
  rows.push([section.titulo.toUpperCase()])
  for (const item of section.items) {
    rows.push([`  ${item.nombreCuenta}`, item.codCuenta, c(item.monto)])
  }
  rows.push([`Total ${section.titulo}`, null, c(section.total)])
  rows.push([])
}

function buildESFSheet(
  esf: ESF,
  utilidadNeta: number,
  ptEnAsientos: boolean,
  irEnAsientos: boolean,
  pt: number,
  ir: number,
): XLSX.WorkSheet {
  const rows: Row[] = []

  rows.push(['Concepto', 'Código', 'USD'])
  rows.push([])

  rows.push(['ACTIVOS'])
  rows.push([])
  addSectionRows(rows, esf.activosCorrientes)
  addSectionRows(rows, esf.activosNoCorrientes)
  rows.push(['TOTAL ACTIVOS', null, c(esf.totalActivos)])
  rows.push([])

  rows.push(['PASIVOS'])
  rows.push([])
  addSectionRows(rows, esf.pasivosCorrientes)
  if (!ptEnAsientos && pt > 0) rows.push([`  Participación trabajadores por pagar [Estimado]`, '2.1.5.01', c(pt)])
  if (!irEnAsientos && ir > 0) rows.push([`  Impuesto a la renta por pagar [Estimado]`, '2.1.5.02', c(ir)])
  const estimatedTax = (!ptEnAsientos ? pt : 0) + (!irEnAsientos ? ir : 0)
  if (estimatedTax > 0) rows.push([`Total ${esf.pasivosCorrientes.titulo} (con estimados)`, null, c(esf.pasivosCorrientes.total + estimatedTax)])
  if (esf.pasivosNoCorrientes.items.length > 0) {
    addSectionRows(rows, esf.pasivosNoCorrientes)
  }
  rows.push(['TOTAL PASIVOS', null, c(esf.totalPasivos + estimatedTax)])
  rows.push([])

  rows.push(['PATRIMONIO'])
  rows.push([])
  addSectionRows(rows, esf.patrimonio)
  if (Math.abs(esf.diferencia) >= 100) {
    rows.push(['  Resultado del período (pendiente cierre)', null, c(utilidadNeta)])
  }
  rows.push(['Total Patrimonio', null, c(esf.totalPatrimonio + utilidadNeta)])
  rows.push([])
  rows.push(['TOTAL PASIVOS + PATRIMONIO', null, c(esf.totalActivos)])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 16 }]
  return ws
}

// ─── Ratios ───────────────────────────────────────────────────────────────────

function buildRatiosSheet(metricas: MetricsResult): XLSX.WorkSheet {
  const rows: Row[] = []

  rows.push(['Categoría', 'Ratio', 'Valor', 'Unidad', 'Estado'])
  rows.push([])

  const grupos: [string, Ratio[]][] = [
    ['Rentabilidad',  metricas.rentabilidad],
    ['Liquidez',      metricas.liquidez],
    ['Endeudamiento', metricas.endeudamiento],
    ['Eficiencia',    metricas.eficiencia],
  ]

  for (const [categoria, ratios] of grupos) {
    for (const r of ratios) {
      rows.push([categoria, r.etiqueta, valorRatio(r), unidadRatio(r), estadoTexto(r.estado)])
    }
    rows.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 15 }, { wch: 42 }, { wch: 12 }, { wch: 10 }, { wch: 12 }]
  return ws
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function buildFilename(ruc: string, periods: string[]): string {
  if (periods.length === 0) return `${ruc}.xlsx`
  const sorted = [...periods].sort()
  const year = sorted[0].substring(0, 4)
  const isFullYear =
    sorted.length === 12 &&
    sorted.every(p => p.startsWith(year)) &&
    sorted[0].endsWith('01') &&
    sorted[11].endsWith('12')

  const periodo = isFullYear
    ? 'Año'
    : sorted.length === 1
    ? sorted[0]
    : `${sorted[0]}-${sorted[sorted.length - 1]}`

  return `${ruc}_${year}_${periodo}.xlsx`
}

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

function buildMayorSheet(mayor: MayorData): XLSX.WorkSheet {
  const rows: Row[] = []

  rows.push([`${mayor.codCuenta} — ${mayor.nombreCuenta}`])
  rows.push([])
  rows.push(['Fecha', 'N° Asiento', 'Tipo', 'Descripción', 'Debe', 'Haber', 'Saldo acumulado'])

  // Saldo inicial
  rows.push(['Apertura', '—', '—', 'Saldo inicial del año', null, null, c(mayor.saldoInicial)])

  for (const e of mayor.entries) {
    rows.push([
      e.fecha,
      e.asiento,
      e.tipo,
      e.descripcion,
      e.debe  > 0 ? c(e.debe)  : null,
      e.haber > 0 ? c(e.haber) : null,
      c(e.saldo),
    ])
  }

  rows.push([])
  rows.push(['Totales del período', null, null, null, c(mayor.totalDebe), c(mayor.totalHaber), c(mayor.saldoFinal)])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 6 }, { wch: 48 },
    { wch: 14 }, { wch: 14 }, { wch: 16 },
  ]
  return ws
}

export function exportarMayor(ruc: string, periods: string[], mayor: MayorData): void {
  const wb = XLSX.utils.book_new()
  const sheetName = mayor.codCuenta.replace(/\./g, '-')  // evitar puntos en nombre de hoja
  XLSX.utils.book_append_sheet(wb, buildMayorSheet(mayor), sheetName)

  const sorted = [...periods].sort()
  const year = sorted[0]?.substring(0, 4) ?? ''
  const range = sorted.length === 1 ? sorted[0] : `${sorted[0]}-${sorted[sorted.length - 1]}`
  const filename = `${ruc}_Mayor_${mayor.codCuenta}_${year}_${range}.xlsx`

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportarExcel(
  ruc: string,
  periods: string[],
  eri: ERI,
  esf: ESF,
  metricas: MetricsResult,
): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildERISheet(eri), 'ERI')
  XLSX.utils.book_append_sheet(wb, buildESFSheet(esf, eri.utilidadNeta, eri.ptEnAsientos, eri.irEnAsientos, eri.participacionTrabajadores, eri.impuestoRenta), 'ESF')
  XLSX.utils.book_append_sheet(wb, buildRatiosSheet(metricas), 'Ratios')

  const filename = buildFilename(ruc, periods)

  // Browser-compatible download via Blob
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
