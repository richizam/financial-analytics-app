import fs from 'fs'
import path from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  fecha: string       // "2025-01-05"
  asiento: string     // "AJ-202501-001"
  tipo: string        // VT, CV, CP, GG, RP, CB, PG, …
  codCuenta: string   // "1.1.3.01"
  nombreCuenta: string
  descripcion: string
  debe: number        // centavos (integer)
  haber: number       // centavos (integer)
  centroCosto: string
  periodo: string     // YYYYMM — añadido al parsear
}

export interface SaldoCuenta {
  codCuenta: string
  nombreCuenta: string
  totalDebe: number   // centavos acumulados en la columna Debe
  totalHaber: number  // centavos acumulados en la columna Haber
  saldo: number       // totalDebe − totalHaber (centavos con signo)
}

export interface ValidationError {
  asiento: string
  tipo: 'desequilibrio' | 'formato_invalido'
  detalle: string
  diferencia?: number // centavos
}

export interface ParseResult {
  entries: JournalEntry[]
  periodosLeidos: string[]
  errors: ValidationError[]
}

export interface CierreAnualResult {
  year: number
  archivoGenerado: string | null // ruta si se generó; null si ya existía
  omitido: boolean               // true si el archivo ya existía y no se tocó
  saldosFinales: Map<string, SaldoCuenta>
  warnings: string[]
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const DATA_ROOT = path.join(process.cwd(), 'data', 'empresas')
const OPENING_BALANCE_PREFIX = 'saldos_iniciales_'

// ─── Utilidades internas ──────────────────────────────────────────────────────

/** "10751.11" → 1075111 | "-3600.00" → -360000 */
function toCents(value: string): number {
  const n = parseFloat(value.trim())
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

/** Parser de línea CSV que maneja campos entre comillas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function normalizeLines(raw: string): string[] {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/** Extrae el año de un período YYYYMM. "202503" → 2025 */
export function yearFromPeriod(periodo: string): number {
  return parseInt(periodo.substring(0, 4), 10)
}

// ─── Validación de partida doble ──────────────────────────────────────────────

function validateDoubleEntry(entries: JournalEntry[]): ValidationError[] {
  const errors: ValidationError[] = []
  const byAsiento = new Map<string, JournalEntry[]>()

  for (const entry of entries) {
    const group = byAsiento.get(entry.asiento) ?? []
    group.push(entry)
    byAsiento.set(entry.asiento, group)
  }

  for (const [asiento, lines] of byAsiento) {
    const totalDebe  = lines.reduce((s: number, l: JournalEntry) => s + l.debe,  0)
    const totalHaber = lines.reduce((s: number, l: JournalEntry) => s + l.haber, 0)
    const diferencia = totalDebe - totalHaber

    if (diferencia !== 0) {
      errors.push({
        asiento,
        tipo: 'desequilibrio',
        detalle: `Debe ${(totalDebe / 100).toFixed(2)} ≠ Haber ${(totalHaber / 100).toFixed(2)}`,
        diferencia,
      })
    }
  }

  return errors
}

// ─── Saldos de apertura ───────────────────────────────────────────────────────

function openingBalancePath(ruc: string, year: number): string {
  return path.join(DATA_ROOT, ruc, `${OPENING_BALANCE_PREFIX}${year}.csv`)
}

/**
 * Lee saldos_iniciales_YYYY.csv.
 * Formato: Cod_Cuenta,Nombre_Cuenta,Saldo_Inicial,Tipo
 *   Saldo_Inicial con signo: positivo = D (Deudor), negativo = A (Acreedor)
 * Devuelve Map vacío si el archivo no existe.
 */
export function loadOpeningBalances(ruc: string, year: number): Map<string, SaldoCuenta> {
  const filePath = openingBalancePath(ruc, year)
  const saldos = new Map<string, SaldoCuenta>()
  if (!fs.existsSync(filePath)) return saldos

  const lines = normalizeLines(fs.readFileSync(filePath, 'utf-8'))

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const fields = parseCsvLine(line)
    if (fields.length < 4) continue

    const [codCuenta, nombreCuenta, saldoStr, tipoStr] = fields
    const tipo = tipoStr.trim().toUpperCase()

    // Tipo (D/A) es la fuente autoritativa del signo; el valor numérico se toma en
    // absoluto para evitar ambigüedad cuando cierreAnual escribe activos con saldo
    // negativo (ej. inventario sobregirado al cierre del año).
    const rawAbs = Math.abs(toCents(saldoStr))
    const saldo  = tipo === 'A' ? -rawAbs : rawAbs

    const totalDebe  = saldo > 0 ? saldo : 0
    const totalHaber = saldo < 0 ? -saldo : 0

    saldos.set(codCuenta, { codCuenta, nombreCuenta, totalDebe, totalHaber, saldo })
  }

  // Validación de apertura: activos deben = pasivos + patrimonio
  let sumActivos = 0
  let sumPasivoPatrimonio = 0
  for (const s of saldos.values()) {
    const g = s.codCuenta.split('.')[0]
    if (g === '1') sumActivos += s.saldo
    else if (g === '2' || g === '3') sumPasivoPatrimonio += -s.saldo
  }
  const gapCents = Math.round(sumActivos - sumPasivoPatrimonio)
  if (Math.abs(gapCents) >= 100) {
    console.warn(
      `[parser] saldos_iniciales_${year}.csv NO cuadra: ` +
      `Activos ${(sumActivos / 100).toFixed(2)} vs Pasivo+Patrimonio ${(sumPasivoPatrimonio / 100).toFixed(2)} ` +
      `(diferencia ${(gapCents / 100).toFixed(2)}) — revisar el archivo con el contador`,
    )
  }

  return saldos
}

// ─── Parser de archivos CSV ───────────────────────────────────────────────────

function parseSingleFile(
  ruc: string,
  periodo: string,
): { entries: JournalEntry[]; errors: ValidationError[] } {
  const filePath = path.join(DATA_ROOT, ruc, `${periodo}.csv`)

  if (!fs.existsSync(filePath)) {
    return {
      entries: [],
      errors: [{
        asiento: '-',
        tipo: 'formato_invalido',
        detalle: `Archivo ${periodo}.csv no encontrado para RUC ${ruc}`,
      }],
    }
  }

  const lines = normalizeLines(fs.readFileSync(filePath, 'utf-8'))
  const entries: JournalEntry[] = []
  const errors: ValidationError[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const fields = parseCsvLine(line)
    if (fields.length < 9) {
      errors.push({
        asiento: `fila ${i + 1}`,
        tipo: 'formato_invalido',
        detalle: `Se esperaban 9 columnas, se encontraron ${fields.length}`,
      })
      continue
    }

    const [fecha, asiento, tipo, codCuenta, nombreCuenta, descripcion, debeStr, haberStr, centroCosto] = fields

    entries.push({
      fecha,
      asiento,
      tipo,
      codCuenta,
      nombreCuenta,
      descripcion,
      debe:  toCents(debeStr),
      haber: toCents(haberStr),
      centroCosto,
      periodo,
    })
  }

  return { entries, errors }
}

// ─── API pública — Lectura de períodos ───────────────────────────────────────

/**
 * Lista períodos disponibles (YYYYMM) para un RUC, ordenados cronológicamente.
 * Ignora archivos de saldos iniciales y cualquier otro archivo no YYYYMM.
 */
export function listAvailablePeriods(ruc: string): string[] {
  const dir = path.join(DATA_ROOT, ruc)
  if (!fs.existsSync(dir)) return []

  return fs.readdirSync(dir)
    .filter(f => /^\d{6}\.csv$/i.test(f))
    .map(f => f.replace(/\.csv$/i, ''))
    .sort()
}

/** Lee y valida un solo período. */
export function parsePeriod(ruc: string, periodo: string): ParseResult {
  const { entries, errors: parseErrors } = parseSingleFile(ruc, periodo)
  const validationErrors = validateDoubleEntry(entries)

  return {
    entries,
    periodosLeidos: entries.length > 0 ? [periodo] : [],
    errors: [...parseErrors, ...validationErrors],
  }
}

/**
 * Lee y consolida varios períodos en orden cronológico.
 * La validación de partida doble se aplica sobre el total consolidado.
 */
export function parseMultiplePeriods(ruc: string, periodos: string[]): ParseResult {
  const sorted = [...periodos].sort()
  const allEntries: JournalEntry[] = []
  const allParseErrors: ValidationError[] = []
  const periodosLeidos: string[] = []

  for (const periodo of sorted) {
    const { entries, errors } = parseSingleFile(ruc, periodo)
    allEntries.push(...entries)
    allParseErrors.push(...errors)
    if (entries.length > 0) periodosLeidos.push(periodo)
  }

  return {
    entries: allEntries,
    periodosLeidos,
    errors: [...allParseErrors, ...validateDoubleEntry(allEntries)],
  }
}

// ─── API pública — Cálculo de saldos ─────────────────────────────────────────

/**
 * Calcula el saldo acumulado por código de cuenta.
 * Si se pasan openingBalances, se usan como punto de partida (se clonan).
 *
 * Convención de signo en saldo = totalDebe − totalHaber:
 *   Grupo 1 (Activo) y 5 (Gastos): saldo positivo = tiene saldo
 *   Grupo 2 (Pasivo), 3 (Patrimonio), 4 (Ingresos): saldo negativo = tiene saldo
 */
export function calcularSaldosPorCuenta(
  entries: JournalEntry[],
  openingBalances?: Map<string, SaldoCuenta>,
): Map<string, SaldoCuenta> {
  const saldos = new Map<string, SaldoCuenta>()
  if (openingBalances) {
    for (const [k, v] of openingBalances) {
      saldos.set(k, { ...v })
    }
  }

  for (const entry of entries) {
    const existing = saldos.get(entry.codCuenta)
    if (existing) {
      existing.totalDebe  += entry.debe
      existing.totalHaber += entry.haber
      existing.saldo       = existing.totalDebe - existing.totalHaber
    } else {
      saldos.set(entry.codCuenta, {
        codCuenta:    entry.codCuenta,
        nombreCuenta: entry.nombreCuenta,
        totalDebe:    entry.debe,
        totalHaber:   entry.haber,
        saldo:        entry.debe - entry.haber,
      })
    }
  }

  // Validación: activos (1.x) con saldo negativo indican datos inconsistentes.
  // El saldo inicial del año podría ser insuficiente para absorber el COGS real.
  for (const [cod, s] of saldos) {
    if (cod.startsWith('1.') && s.saldo < 0) {
      console.warn(
        `[parser] Saldo negativo en cuenta activo ${cod} (${s.nombreCuenta}): ` +
        `${(s.saldo / 100).toFixed(2)} — revisar saldo inicial y movimientos del período`,
      )
    }
  }

  return saldos
}

/**
 * Carga los saldos iniciales del año y acumula los entries recibidos sobre ellos.
 */
export function calcularSaldosConApertura(
  ruc: string,
  year: number,
  entries: JournalEntry[],
): Map<string, SaldoCuenta> {
  const opening = loadOpeningBalances(ruc, year)
  return calcularSaldosPorCuenta(entries, opening)
}

// ─── API pública — Cierre anual ───────────────────────────────────────────────

/**
 * Consolida todos los meses del año, calcula saldos finales al 31-dic y genera
 * saldos_iniciales_[YYYY+1].csv con las cuentas de balance (grupos 1, 2, 3).
 * NUNCA sobreescribe un archivo existente.
 */
export function cierreAnual(ruc: string, year: number): CierreAnualResult {
  const nextYear = year + 1
  const outputPath = openingBalancePath(ruc, nextYear)

  if (fs.existsSync(outputPath)) {
    return {
      year,
      archivoGenerado: null,
      omitido: true,
      saldosFinales: new Map(),
      warnings: [`saldos_iniciales_${nextYear}.csv ya existe — no se sobreescribió`],
    }
  }

  const warnings: string[] = []

  const availablePeriods = listAvailablePeriods(ruc)
  const yearPeriods = availablePeriods.filter(p => yearFromPeriod(p) === year)

  if (yearPeriods.length === 0) {
    warnings.push(`No se encontraron archivos CSV para el año ${year}`)
  } else if (yearPeriods.length < 12) {
    const missing = 12 - yearPeriods.length
    warnings.push(`${missing} mes(es) sin datos en ${year} — saldos iniciales pueden ser parciales`)
  }

  const { entries, errors } = parseMultiplePeriods(ruc, yearPeriods)
  errors.forEach(e => warnings.push(`${e.asiento}: ${e.detalle}`))

  const saldosFinales = calcularSaldosConApertura(ruc, year, entries)

  const unclosedPnL = [...saldosFinales.values()].filter(s => {
    const g = s.codCuenta.split('.')[0]
    return (g === '4' || g === '5') && s.saldo !== 0
  })
  if (unclosedPnL.length > 0) {
    warnings.push(
      `${unclosedPnL.length} cuenta(s) 4.x/5.x con saldo ≠ 0 — no se incluyen en saldos iniciales` +
      ` (ejecute asientos de cierre antes de cierreAnual)`,
    )
  }

  const balanceRows = [...saldosFinales.values()]
    .filter(s => {
      const g = s.codCuenta.split('.')[0]
      return (g === '1' || g === '2' || g === '3') && s.saldo !== 0
    })
    .sort((a, b) => a.codCuenta.localeCompare(b.codCuenta))

  const header = 'Cod_Cuenta,Nombre_Cuenta,Saldo_Inicial,Tipo'
  const rows = balanceRows.map(s => {
    const saldoStr = (s.saldo / 100).toFixed(2)
    const tipo     = s.saldo >= 0 ? 'D' : 'A'
    return `${s.codCuenta},${s.nombreCuenta},${saldoStr},${tipo}`
  })

  fs.writeFileSync(outputPath, [header, ...rows].join('\n'), 'utf-8')

  return {
    year,
    archivoGenerado: outputPath,
    omitido: false,
    saldosFinales,
    warnings,
  }
}
