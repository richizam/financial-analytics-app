import type { ESF, ERI, StatementSection } from './statements'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SemaferoEstado = 'green' | 'yellow' | 'red' | 'gray'
export type UnidadRatio    = 'porcentaje' | 'veces' | 'dias' | 'moneda'

/** Umbrales del semáforo. Para ratios donde más alto es peor, aplicar invertidos. */
interface Umbral {
  bueno:  number
  normal: number
  alerta: number
}

export interface Ratio {
  clave:     string
  etiqueta:  string
  valor:     number | null      // null = no calculable (datos insuficientes)
  unidad:    UnidadRatio
  estado:    SemaferoEstado
  umbral?:   Umbral             // referencia para mostrar en UI
}

export interface MetricsResult {
  rentabilidad:  Ratio[]
  liquidez:      Ratio[]
  endeudamiento: Ratio[]
  eficiencia:    Ratio[]
}

// ─── Umbrales por sector (skill company-setup) ────────────────────────────────

type SectorKey = 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro'

interface SectorUmbrales {
  margenBruto:        Umbral
  margenNeto:         Umbral
  margenEbitda:       Umbral
  razonCorriente:     Umbral
  pruebaAcida:        Umbral
  razonEndeudamiento: Umbral   // invertido: más alto = peor
  coberturaIntereses: Umbral
  rotacionCartera:    Umbral   // días, invertido
  rotacionInventario: Umbral   // días, invertido
}

const UMBRALES: Record<SectorKey, SectorUmbrales> = {
  comercial: {
    margenBruto:        { alerta: 0.10, normal: 0.20, bueno: 0.35 },
    margenNeto:         { alerta: 0.02, normal: 0.05, bueno: 0.10 },
    margenEbitda:       { alerta: 0.05, normal: 0.12, bueno: 0.20 },
    razonCorriente:     { alerta: 1.0,  normal: 1.3,  bueno: 1.8  },
    pruebaAcida:        { alerta: 0.6,  normal: 0.9,  bueno: 1.2  },
    razonEndeudamiento: { alerta: 0.70, normal: 0.55, bueno: 0.40 },
    coberturaIntereses: { alerta: 1.5,  normal: 2.5,  bueno: 4.0  },
    rotacionCartera:    { alerta: 90,   normal: 60,   bueno: 30   },
    rotacionInventario: { alerta: 90,   normal: 45,   bueno: 30   },
  },
  servicios: {
    margenBruto:        { alerta: 0.30, normal: 0.45, bueno: 0.60 },
    margenNeto:         { alerta: 0.05, normal: 0.12, bueno: 0.20 },
    margenEbitda:       { alerta: 0.10, normal: 0.18, bueno: 0.28 },
    razonCorriente:     { alerta: 1.0,  normal: 1.5,  bueno: 2.0  },
    pruebaAcida:        { alerta: 0.8,  normal: 1.2,  bueno: 1.6  },
    razonEndeudamiento: { alerta: 0.65, normal: 0.50, bueno: 0.35 },
    coberturaIntereses: { alerta: 2.0,  normal: 3.0,  bueno: 5.0  },
    rotacionCartera:    { alerta: 60,   normal: 40,   bueno: 25   },
    rotacionInventario: { alerta: 0,    normal: 0,    bueno: 0    }, // no aplica
  },
  industrial: {
    margenBruto:        { alerta: 0.15, normal: 0.28, bueno: 0.40 },
    margenNeto:         { alerta: 0.03, normal: 0.07, bueno: 0.15 },
    margenEbitda:       { alerta: 0.08, normal: 0.15, bueno: 0.25 },
    razonCorriente:     { alerta: 1.1,  normal: 1.5,  bueno: 2.0  },
    pruebaAcida:        { alerta: 0.7,  normal: 1.0,  bueno: 1.4  },
    razonEndeudamiento: { alerta: 0.70, normal: 0.55, bueno: 0.40 },
    coberturaIntereses: { alerta: 2.0,  normal: 3.5,  bueno: 5.0  },
    rotacionCartera:    { alerta: 75,   normal: 50,   bueno: 30   },
    rotacionInventario: { alerta: 120,  normal: 60,   bueno: 30   },
  },
  construccion: {
    margenBruto:        { alerta: 0.12, normal: 0.22, bueno: 0.35 },
    margenNeto:         { alerta: 0.04, normal: 0.08, bueno: 0.15 },
    margenEbitda:       { alerta: 0.08, normal: 0.14, bueno: 0.22 },
    razonCorriente:     { alerta: 1.2,  normal: 1.6,  bueno: 2.2  },
    pruebaAcida:        { alerta: 0.8,  normal: 1.1,  bueno: 1.5  },
    razonEndeudamiento: { alerta: 0.75, normal: 0.60, bueno: 0.45 },
    coberturaIntereses: { alerta: 1.5,  normal: 2.5,  bueno: 4.0  },
    rotacionCartera:    { alerta: 90,   normal: 60,   bueno: 40   },
    rotacionInventario: { alerta: 0,    normal: 0,    bueno: 0    }, // no aplica
  },
  otro: {
    margenBruto:        { alerta: 0.15, normal: 0.25, bueno: 0.40 },
    margenNeto:         { alerta: 0.03, normal: 0.08, bueno: 0.15 },
    margenEbitda:       { alerta: 0.07, normal: 0.14, bueno: 0.22 },
    razonCorriente:     { alerta: 1.0,  normal: 1.4,  bueno: 1.8  },
    pruebaAcida:        { alerta: 0.7,  normal: 1.0,  bueno: 1.4  },
    razonEndeudamiento: { alerta: 0.70, normal: 0.55, bueno: 0.40 },
    coberturaIntereses: { alerta: 1.5,  normal: 2.5,  bueno: 4.0  },
    rotacionCartera:    { alerta: 75,   normal: 50,   bueno: 30   },
    rotacionInventario: { alerta: 90,   normal: 45,   bueno: 30   },
  },
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

/**
 * Evalúa un valor contra los umbrales.
 * invertido = true para ratios donde más alto es peor (días, endeudamiento).
 */
function semafero(
  valor: number | null,
  umbral: Umbral,
  invertido = false,
): SemaferoEstado {
  if (valor === null) return 'gray'

  if (!invertido) {
    if (valor >= umbral.bueno)  return 'green'
    if (valor >= umbral.normal) return 'yellow'
    return 'red'
  } else {
    if (valor <= umbral.bueno)  return 'green'
    if (valor <= umbral.normal) return 'yellow'
    return 'red'
  }
}

function ratio(
  clave: string,
  etiqueta: string,
  valor: number | null,
  unidad: UnidadRatio,
  umbral: Umbral | undefined,
  invertido = false,
): Ratio {
  const estado: SemaferoEstado = umbral
    ? semafero(valor, umbral, invertido)
    : valor === null ? 'gray' : 'green'

  return { clave, etiqueta, valor, unidad, estado, umbral }
}

// ─── Helpers de extracción desde ESF/ERI ─────────────────────────────────────

/** Suma los montos de items de una sección cuyo código empieza con un prefijo. */
function sumByPrefix(section: StatementSection, prefix: string): number {
  return section.items
    .filter(i => i.codCuenta.startsWith(prefix))
    .reduce((s, i) => s + Math.abs(i.monto), 0)  // abs: monto puede ser negativo en contra-cuentas
}

/** División segura — retorna null si el denominador es 0. */
function safeDiv(num: number, den: number): number | null {
  if (den === 0) return null
  return num / den
}

// ─── Calculador principal ─────────────────────────────────────────────────────

/**
 * Calcula todos los ratios financieros y devuelve el semáforo por ratio.
 *
 * @param esf          Estado de Situación Financiera generado por generarESF()
 * @param eri          Estado de Resultado Integral generado por generarERI()
 * @param sector       Sector económico de la empresa (determina los umbrales)
 * @param diasPeriodo  Número de días del período analizado (365 = año, 90 = Q1, 31 = mes)
 */
export function calcularMetricas(
  esf: ESF,
  eri: ERI,
  sector: SectorKey = 'comercial',
  diasPeriodo: number = 365,
): MetricsResult {
  const U = UMBRALES[sector] ?? UMBRALES['otro']

  // ── Valores base extraídos del ESF ──────────────────────────────────────────
  const activosCorrientes    = esf.activosCorrientes.total
  const pasivosCorrientes    = esf.pasivosCorrientes.total
  const totalActivos         = esf.totalActivos
  const totalPasivos         = esf.totalPasivos
  const totalPatrimonio      = esf.totalPatrimonio

  // Cuentas específicas
  const efectivo         = sumByPrefix(esf.activosCorrientes,  '1.1.1')
  const cuentasCobrar    = sumByPrefix(esf.activosCorrientes,  '1.1.3')
  const inventarios      = sumByPrefix(esf.activosCorrientes,  '1.1.5')
  const cuentasPagar     = sumByPrefix(esf.pasivosCorrientes,  '2.1.1')

  // ── Valores base del ERI ────────────────────────────────────────────────────
  const ingresos             = eri.ingresos.total
  const costoVentas          = eri.costoVentas.total
  const utilidadNeta         = eri.utilidadNeta
  const utilidadOperacional  = eri.utilidadOperacional    // EBIT
  const ebitda               = eri.ebitda

  // ── RENTABILIDAD ────────────────────────────────────────────────────────────

  // Patrimonio efectivo = histórico (3.x) + utilidad del período aún no cerrada.
  // Las cuentas 4.x/5.x no se cierran con asientos dentro del período seleccionado,
  // por lo que totalPatrimonio solo refleja el equity histórico; sin este ajuste el
  // denominador del ROE está subestimado y el ratio se infla artificialmente.
  const patrimonioEfectivo = totalPatrimonio + utilidadNeta

  const rentabilidad: Ratio[] = [
    ratio(
      'margenBruto', 'Margen bruto',
      ingresos ? eri.margenBruto : null,
      'porcentaje', U.margenBruto,
    ),
    ratio(
      'margenNeto', 'Margen neto',
      ingresos ? eri.margenNeto : null,
      'porcentaje', U.margenNeto,
    ),
    ratio(
      'margenEbitda', 'Margen EBITDA',
      ingresos ? eri.margenEbitda : null,
      'porcentaje', U.margenEbitda,
    ),
    ratio(
      'roe', 'ROE (Retorno sobre patrimonio)',
      safeDiv(utilidadNeta, patrimonioEfectivo),
      'porcentaje', undefined,
    ),
    ratio(
      'roa', 'ROA (Retorno sobre activos)',
      safeDiv(utilidadNeta, totalActivos),
      'porcentaje', undefined,
    ),
  ]

  // ── LIQUIDEZ ────────────────────────────────────────────────────────────────
  const activosCorrSinInventario = activosCorrientes - inventarios
  const razonCorrienteVal = safeDiv(activosCorrientes, pasivosCorrientes)
  const pruebaAcidaVal    = safeDiv(activosCorrSinInventario, pasivosCorrientes)
  const capitalTrabajo    = activosCorrientes - pasivosCorrientes

  const liquidez: Ratio[] = [
    ratio('razonCorriente', 'Razón corriente',  razonCorrienteVal, 'veces', U.razonCorriente),
    ratio('pruebaAcida',    'Prueba ácida',      pruebaAcidaVal,    'veces', U.pruebaAcida),
    ratio('capitalTrabajo', 'Capital de trabajo (neto)', capitalTrabajo, 'moneda', undefined),
  ]

  // ── ENDEUDAMIENTO ────────────────────────────────────────────────────────────
  const razonEndeudamientoVal  = safeDiv(totalPasivos, totalActivos)
  const apalancamientoVal      = safeDiv(totalActivos, patrimonioEfectivo)
  // coberturaIntereses = EBIT / gastoIntereses — los intereses suelen ser cuentas 5.4.x o 5.5.x
  // No aparecen en los datos de prueba → null (gray en semáforo)
  const coberturaInteresesVal: number | null = null

  const endeudamiento: Ratio[] = [
    ratio('razonEndeudamiento', 'Razón de endeudamiento', razonEndeudamientoVal, 'porcentaje', U.razonEndeudamiento, true),
    ratio('apalancamiento',     'Apalancamiento financiero', apalancamientoVal,  'veces', undefined),
    ratio('coberturaIntereses', 'Cobertura de intereses', coberturaInteresesVal, 'veces', U.coberturaIntereses),
  ]

  // ── EFICIENCIA ────────────────────────────────────────────────────────────────
  // Los ratios de rotación se anualizan respecto al período real.
  // rotacionCartera = (cuentasCobrar / ingresos) * diasPeriodo
  // rotacionInventario = (inventarios / costoVentas) * diasPeriodo
  // rotacionProveedores = (cuentasPagar / costoVentas) * diasPeriodo
  //   (usamos costoVentas como proxy de compras cuando no tenemos compras separadas)

  const rotacionCarteraVal    = cuentasCobrar  && ingresos   ? safeDiv(cuentasCobrar, ingresos)   : null
  const rotacionInventarioVal = inventarios    && costoVentas ? safeDiv(inventarios,   costoVentas) : null
  const rotacionProveedorVal  = cuentasPagar   && costoVentas ? safeDiv(cuentasPagar,  costoVentas) : null

  const diasCobro       = rotacionCarteraVal    !== null ? rotacionCarteraVal    * diasPeriodo : null
  const diasInventario  = rotacionInventarioVal !== null ? rotacionInventarioVal * diasPeriodo : null
  const diasPago        = rotacionProveedorVal  !== null ? rotacionProveedorVal  * diasPeriodo : null

  // CCE = diasCobro + diasInventario - diasPago
  const cce = diasCobro !== null && diasInventario !== null && diasPago !== null
    ? diasCobro + diasInventario - diasPago
    : null

  // El sector servicios no maneja inventarios — omitir ratios de inventario
  const incluyeInventario = sector !== 'servicios' && sector !== 'construccion' && inventarios > 0

  const eficiencia: Ratio[] = [
    ratio('diasCobro',      'Días de cobro (DSO)',         diasCobro,      'dias', U.rotacionCartera, true),
    ...(incluyeInventario ? [
      ratio('diasInventario', 'Días de inventario (DIO)',   diasInventario, 'dias', U.rotacionInventario, true),
    ] : []),
    ratio('diasPago',       'Días de pago a proveedores',  diasPago,       'dias', undefined),
    ...(incluyeInventario ? [
      ratio('cce', 'Ciclo de conversión de efectivo', cce, 'dias', undefined, true),
    ] : []),
  ]

  return { rentabilidad, liquidez, endeudamiento, eficiencia }
}
