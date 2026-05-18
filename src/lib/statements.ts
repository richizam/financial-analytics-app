import type { SaldoCuenta } from './parser'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatementItem {
  codCuenta: string
  nombreCuenta: string
  /** Valor para mostrar: positivo para activos, pasivos, ingresos, gastos normales.
   *  Negativo solo para contra-cuentas (ej. depreciación acumulada dentro de activos). */
  monto: number // centavos
  saldo: number // centavos — valor matemático raw (para cálculos internos)
}

export interface StatementSection {
  titulo: string
  items: StatementItem[]
  total: number // centavos (siempre positivo para mostrar)
}

export interface ESF {
  // Activos
  activosCorrientes: StatementSection
  activosNoCorrientes: StatementSection
  totalActivos: number
  // Pasivos
  pasivosCorrientes: StatementSection
  pasivosNoCorrientes: StatementSection
  totalPasivos: number
  // Patrimonio
  patrimonio: StatementSection
  totalPatrimonio: number
  // Verificación
  totalPasivosMasPatrimonio: number
  /** Diferencia vs totalActivos en centavos. 0 = cuadra perfectamente. */
  diferencia: number
}

/** Tasas impositivas. Hardcodeadas por ahora; vendrán de company-setup más adelante. */
export interface TaxConfig {
  participacionTrabajadores: number // 0.15 — Código de Trabajo Ecuador
  tasaImpuestoRenta: number         // 0.25 — tasa general IR Ecuador
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  participacionTrabajadores: 0.15,
  tasaImpuestoRenta:         0.25,
}

export interface ERI {
  ingresos: StatementSection
  costoVentas: StatementSection
  utilidadBruta: number
  margenBruto: number              // 0.0–1.0
  gastosOperacion: StatementSection
  utilidadOperacional: number      // EBIT
  ebitda: number                   // EBIT + depreciación + amortización
  margenEbitda: number             // 0.0–1.0
  otrosGastos: StatementSection
  utilidadAntesParticipacion: number
  participacionTrabajadores: number // 15%
  utilidadAntesIR: number
  impuestoRenta: number             // 25% sobre utilidad antes de IR
  utilidadNeta: number
  margenNeto: number               // 0.0–1.0
  /** true = el contador ya registró la provisión en asientos → no estimar */
  ptEnAsientos: boolean
  irEnAsientos: boolean
}

// ─── Clasificación de cuentas ──────────────────────────────────────────────────

type AccountGroup =
  | 'activo_corriente'
  | 'activo_no_corriente'
  | 'pasivo_corriente'
  | 'pasivo_no_corriente'
  | 'patrimonio'
  | 'ingreso'
  | 'costo_ventas'
  | 'gasto_operacion'
  | 'gasto_otro'
  | 'desconocido'

/**
 * Clasifica una cuenta según el código jerárquico:
 *   1.1.x = activo corriente      1.2.x = activo no corriente
 *   2.1.x = pasivo corriente      2.2.x = pasivo no corriente
 *   3.x.x = patrimonio
 *   4.x.x = ingresos
 *   5.1.x = costo de ventas       5.2.x = gastos operación    5.3.x+ = otros
 */
export function clasificarCuenta(codCuenta: string): AccountGroup {
  const partes = codCuenta.split('.')
  const n1 = partes[0]
  const n2 = partes[1] ?? '1'

  switch (n1) {
    case '1': return n2 === '1' ? 'activo_corriente' : 'activo_no_corriente'
    case '2': return n2 === '1' ? 'pasivo_corriente' : 'pasivo_no_corriente'
    case '3': return 'patrimonio'
    case '4': return 'ingreso'
    case '5':
      if (n2 === '1') return 'costo_ventas'
      if (n2 === '2') return 'gasto_operacion'
      return 'gasto_otro'
    default:  return 'desconocido'
  }
}

/** Detecta cuentas de depreciación o amortización por nombre o código (5.2.3.x). */
function esDepreciacionOAmortizacion(s: SaldoCuenta): boolean {
  const nombre = s.nombreCuenta.toLowerCase()
  const n3 = s.codCuenta.split('.')[2] ?? ''
  return (
    nombre.includes('depreci') ||
    nombre.includes('amortiz') ||
    (s.codCuenta.startsWith('5.2.3') || s.codCuenta.startsWith('5.2.4'))
  )
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Filtra y agrupa cuentas por grupo, retorna los items listos para mostrar.
 * `montoFn` determina cómo convertir el saldo al valor de display.
 */
function buildSection(
  saldos: Map<string, SaldoCuenta>,
  grupo: AccountGroup,
  titulo: string,
  montoFn: (saldo: number) => number,
): StatementSection {
  const items: StatementItem[] = [...saldos.values()]
    .filter(s => clasificarCuenta(s.codCuenta) === grupo)
    .sort((a, b) => a.codCuenta.localeCompare(b.codCuenta))
    .map(s => ({
      codCuenta:    s.codCuenta,
      nombreCuenta: s.nombreCuenta,
      monto:        montoFn(s.saldo),
      saldo:        s.saldo,
    }))

  // El total suma los saldos matemáticos y aplica montoFn al resultado.
  // Para activos: sum(saldos) ya incluye contra-cuentas negativas.
  // Para pasivos/patrimonio/ingresos: negamos para que el total sea positivo.
  const rawTotal = items.reduce((acc, i) => acc + i.saldo, 0)
  const total    = Math.abs(montoFn(rawTotal))

  return { titulo, items, total }
}

// ─── Generador ESF ────────────────────────────────────────────────────────────

/**
 * Genera el Estado de Situación Financiera a partir de los saldos acumulados.
 *
 * Recibe el resultado de calcularSaldosConApertura (o calcularSaldosPorCuenta).
 * Las cuentas 4.x y 5.x se ignoran — son cuentas de resultado, no de balance.
 *
 * Convención de signo en monto (display):
 *   Activos: saldo tal cual (D > 0, contra-cuentas A < 0, se muestra negativo)
 *   Pasivos, Patrimonio: -saldo (las cuentas A tienen saldo < 0, se invierte para mostrar positivo)
 */
export function generarESF(saldos: Map<string, SaldoCuenta>): ESF {
  // Activos: monto = saldo (los activos normales son positivos; contra-cuentas, negativos)
  const activosCorrientes    = buildSection(saldos, 'activo_corriente',    'Activos Corrientes',    s => s)
  const activosNoCorrientes  = buildSection(saldos, 'activo_no_corriente', 'Activos No Corrientes', s => s)

  const totalActivos =
    activosCorrientes.items.reduce((a, i) => a + i.saldo, 0) +
    activosNoCorrientes.items.reduce((a, i) => a + i.saldo, 0)

  // Pasivos/Patrimonio: monto = -saldo (las cuentas acreedoras tienen saldo < 0)
  const pasivosCorrientes   = buildSection(saldos, 'pasivo_corriente',   'Pasivos Corrientes',   s => -s)
  const pasivosNoCorrientes = buildSection(saldos, 'pasivo_no_corriente', 'Pasivos No Corrientes', s => -s)
  const patrimonio          = buildSection(saldos, 'patrimonio',          'Patrimonio',            s => -s)

  const totalPasivos    = pasivosCorrientes.total + pasivosNoCorrientes.total
  const totalPatrimonio = patrimonio.total

  // Verificación: totalActivos = totalPasivos + totalPatrimonio + utilidadDelPeriodo
  // Si los asientos de cierre NO se han ejecutado, la diferencia equivale a
  // la utilidad acumulada del período (cuentas 4.x/5.x aún no cerradas).
  const totalPasivosMasPatrimonio = totalPasivos + totalPatrimonio
  const diferencia = Math.abs(totalActivos) - totalPasivosMasPatrimonio

  return {
    activosCorrientes,
    activosNoCorrientes,
    totalActivos: Math.abs(totalActivos),
    pasivosCorrientes,
    pasivosNoCorrientes,
    totalPasivos,
    patrimonio,
    totalPatrimonio,
    totalPasivosMasPatrimonio,
    diferencia,
  }
}

// ─── Generador ERI ────────────────────────────────────────────────────────────

/**
 * Genera el Estado de Resultado Integral a partir de los saldos del período.
 *
 * Para el ERI usar SOLO los movimientos del período (no el ESF acumulado).
 * Típicamente: calcularSaldosPorCuenta(entries) sin apertura,
 * o calcularSaldosConApertura cuando las cuentas 4.x/5.x no tienen saldo inicial.
 *
 * Convención de signo en monto (display):
 *   Ingresos: -saldo (las cuentas A tienen saldo < 0 → se invierte a positivo)
 *   Costos y Gastos: saldo (las cuentas D tienen saldo > 0)
 */
export function generarERI(
  saldos: Map<string, SaldoCuenta>,
  taxConfig: TaxConfig = DEFAULT_TAX_CONFIG,
): ERI {
  // Ingresos: -saldo para mostrar positivo
  const ingresos        = buildSection(saldos, 'ingreso',          'Ingresos de actividades ordinarias', s => -s)
  const costoVentas     = buildSection(saldos, 'costo_ventas',     'Costo de ventas',                    s => s)
  const gastosOperacion = buildSection(saldos, 'gasto_operacion',  'Gastos de operación',                s => s)
  const otrosGastos     = buildSection(saldos, 'gasto_otro',       'Otros gastos',                       s => s)

  const totalIngresos    = ingresos.total
  const utilidadBruta    = totalIngresos - costoVentas.total
  const utilidadOperacional = utilidadBruta - gastosOperacion.total   // EBIT

  // EBITDA = EBIT + depreciación y amortización del período
  const depreciacion = [...saldos.values()]
    .filter(s => clasificarCuenta(s.codCuenta) === 'gasto_operacion' && esDepreciacionOAmortizacion(s))
    .reduce((acc, s) => acc + s.saldo, 0)

  const ebitda = utilidadOperacional + depreciacion

  // Detectar si el contador ya registró provisiones fiscales en asientos
  // 2.1.4.03 = Participación trabajadores por pagar
  // 2.1.5    = Impuesto a la renta por pagar (cualquier subcuenta)
  const ptEnAsientos = [...saldos.keys()].some(k => k.startsWith('2.1.4.03'))
  const irEnAsientos = [...saldos.keys()].some(k => k.startsWith('2.1.5'))

  // Cascada de impuestos (Ecuador) — redondeado a centavos enteros
  // Si ya está en asientos → 0 (el ESF ya lo refleja; no duplicar)
  const utilidadAntesParticipacion = utilidadOperacional - otrosGastos.total
  const participacionTrabajadores  = ptEnAsientos
    ? 0
    : Math.round(Math.max(0, utilidadAntesParticipacion) * taxConfig.participacionTrabajadores)
  const utilidadAntesIR            = utilidadAntesParticipacion - participacionTrabajadores
  const impuestoRenta              = irEnAsientos
    ? 0
    : Math.round(Math.max(0, utilidadAntesIR) * taxConfig.tasaImpuestoRenta)
  const utilidadNeta               = utilidadAntesIR - impuestoRenta

  const safeMargen = (v: number) => totalIngresos !== 0 ? v / totalIngresos : 0

  return {
    ingresos,
    costoVentas,
    utilidadBruta,
    margenBruto:              safeMargen(utilidadBruta),
    gastosOperacion,
    utilidadOperacional,
    ebitda,
    margenEbitda:             safeMargen(ebitda),
    otrosGastos,
    utilidadAntesParticipacion,
    participacionTrabajadores,
    utilidadAntesIR,
    impuestoRenta,
    utilidadNeta,
    margenNeto:               safeMargen(utilidadNeta),
    ptEnAsientos,
    irEnAsientos,
  }
}
