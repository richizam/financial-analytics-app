import * as XLSX from 'xlsx'
import type { ESF, ERI, StatementSection } from './statements'
import type { MetricsResult, Ratio, SemaferoEstado } from './metrics'
import type { MayorData, DashboardData } from '@/app/actions'

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

// ─── Mayor Completo (todas las cuentas, una sola hoja) ───────────────────────

export function exportarMayorCompleto(ruc: string, periods: string[], majors: MayorData[]): void {
  const rows: Row[] = []

  rows.push(['Cod_Cuenta', 'Nombre_Cuenta', 'Fecha', 'N_Asiento', 'Descripcion', 'Debe', 'Haber', 'Saldo_Acumulado'])

  for (const mayor of majors) {
    // Fila de apertura
    rows.push([
      mayor.codCuenta,
      mayor.nombreCuenta,
      'Apertura',
      '—',
      'Saldo inicial del año',
      null,
      null,
      c(mayor.saldoInicial),
    ])
    // Movimientos cronológicos
    for (const e of mayor.entries) {
      rows.push([
        mayor.codCuenta,
        mayor.nombreCuenta,
        e.fecha,
        e.asiento,
        e.descripcion,
        e.debe  > 0 ? c(e.debe)  : null,
        e.haber > 0 ? c(e.haber) : null,
        c(e.saldo),
      ])
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Autofilter sobre todas las columnas y todas las filas de datos
  ws['!autofilter'] = { ref: `A1:H${rows.length}` }

  ws['!cols'] = [
    { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 20 },
    { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Mayor Completo')

  const sorted = [...periods].sort()
  const year  = sorted[0]?.substring(0, 4) ?? ''
  const range = sorted.length === 1 ? sorted[0] : `${sorted[0]}-${sorted[sorted.length - 1]}`
  const filename = `${ruc}_Mayor_Completo_${year}_${range}.xlsx`

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

// ─── Comparativo ──────────────────────────────────────────────────────────────

function buildComparativoERISheet(labelA: string, labelB: string, a: DashboardData, b: DashboardData): XLSX.WorkSheet {
  const ea = a.eri
  const eb = b.eri
  const rows: Row[] = []

  rows.push(['Concepto', labelA, labelB, 'Var $', 'Var %'])
  rows.push([])

  function addRow(concepto: string, va: number, vb: number, isMargen = false) {
    const diff = vb - va
    const pct = va !== 0 ? diff / Math.abs(va) : null
    if (isMargen) {
      rows.push([concepto, va, vb, null, pct])
    } else {
      rows.push([concepto, c(va), c(vb), c(diff), pct])
    }
  }

  addRow('Ingresos netos', ea.ingresos.total, eb.ingresos.total)
  addRow('(-) Costo de ventas', ea.costoVentas.total, eb.costoVentas.total)
  addRow('Utilidad bruta', ea.utilidadBruta, eb.utilidadBruta)
  addRow('  Margen bruto', ea.margenBruto, eb.margenBruto, true)
  addRow('(-) Gastos de operación', ea.gastosOperacion.total, eb.gastosOperacion.total)
  addRow('EBIT (Utilidad operacional)', ea.utilidadOperacional, eb.utilidadOperacional)
  addRow('EBITDA', ea.ebitda, eb.ebitda)
  addRow('  Margen EBITDA', ea.margenEbitda, eb.margenEbitda, true)
  addRow('Utilidad antes de PT e IR', ea.utilidadAntesParticipacion, eb.utilidadAntesParticipacion)
  addRow('(-) Participación trabajadores', ea.participacionTrabajadores, eb.participacionTrabajadores)
  addRow('(-) Impuesto a la renta', ea.impuestoRenta, eb.impuestoRenta)
  rows.push([])
  addRow('UTILIDAD NETA', ea.utilidadNeta, eb.utilidadNeta)
  addRow('  Margen neto', ea.margenNeto, eb.margenNeto, true)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
  return ws
}

function buildComparativoRatiosSheet(labelA: string, labelB: string, a: DashboardData, b: DashboardData): XLSX.WorkSheet {
  const rows: Row[] = []
  rows.push(['Categoría', 'Ratio', labelA, labelB, 'Var %'])
  rows.push([])

  const grupos: [string, Ratio[], Ratio[]][] = [
    ['Rentabilidad',  a.metricas.rentabilidad,  b.metricas.rentabilidad],
    ['Liquidez',      a.metricas.liquidez,       b.metricas.liquidez],
    ['Endeudamiento', a.metricas.endeudamiento,  b.metricas.endeudamiento],
    ['Eficiencia',    a.metricas.eficiencia,     b.metricas.eficiencia],
  ]

  for (const [cat, ratiosA, ratiosB] of grupos) {
    for (let i = 0; i < ratiosA.length; i++) {
      const rA = ratiosA[i]
      const rB = ratiosB[i]
      const va = rA.valor ?? 0
      const vb = rB?.valor ?? 0
      const pct = va !== 0 ? (vb - va) / Math.abs(va) : null
      rows.push([cat, rA.etiqueta, valorRatio(rA), rB ? valorRatio(rB) : 'N/D', pct])
    }
    rows.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 15 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
  return ws
}

function buildComparativoKPISheet(labelA: string, labelB: string, a: DashboardData, b: DashboardData): XLSX.WorkSheet {
  const ea = a.eri
  const eb = b.eri
  const rows: Row[] = []

  rows.push(['KPI', labelA, labelB, 'Var $', 'Var %'])
  rows.push([])

  function addKPI(nombre: string, va: number, vb: number, isMoneda = true) {
    const diff = vb - va
    const pct = va !== 0 ? diff / Math.abs(va) : null
    rows.push([nombre, isMoneda ? c(va) : va, isMoneda ? c(vb) : vb, isMoneda ? c(diff) : null, pct])
  }

  addKPI('Ingresos netos', ea.ingresos.total, eb.ingresos.total)
  addKPI('Utilidad bruta', ea.utilidadBruta, eb.utilidadBruta)
  addKPI('EBITDA', ea.ebitda, eb.ebitda)
  addKPI('Utilidad neta', ea.utilidadNeta, eb.utilidadNeta)
  addKPI('Margen bruto', ea.margenBruto, eb.margenBruto, false)
  addKPI('Margen neto', ea.margenNeto, eb.margenNeto, false)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
  return ws
}

function triggerDownload(wb: XLSX.WorkBook, filename: string): void {
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

export function exportarComparativo(
  ruc: string,
  periodosA: string[],
  periodosB: string[],
  a: DashboardData,
  b: DashboardData,
): void {
  const sortedA = [...periodosA].sort()
  const sortedB = [...periodosB].sort()
  const yearA  = sortedA[0]?.substring(0, 4) ?? ''
  const yearB  = sortedB[0]?.substring(0, 4) ?? ''
  const labelA = sortedA.length === 1 ? sortedA[0]
    : sortedA.length <= 12 && new Set(sortedA.map(p => p.substring(0, 4))).size === 1 ? yearA
    : `${sortedA[0]}-${sortedA[sortedA.length - 1]}`
  const labelB = sortedB.length === 1 ? sortedB[0]
    : sortedB.length <= 12 && new Set(sortedB.map(p => p.substring(0, 4))).size === 1 ? yearB
    : `${sortedB[0]}-${sortedB[sortedB.length - 1]}`

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildComparativoKPISheet(labelA, labelB, a, b), 'KPIs')
  XLSX.utils.book_append_sheet(wb, buildComparativoERISheet(labelA, labelB, a, b), 'ERI Comparativo')
  XLSX.utils.book_append_sheet(wb, buildComparativoRatiosSheet(labelA, labelB, a, b), 'Ratios')

  const filename = `${ruc}_Comparativo_${labelA}_vs_${labelB}.xlsx`
  triggerDownload(wb, filename)
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
