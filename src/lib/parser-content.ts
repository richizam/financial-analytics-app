/**
 * parser-content.ts
 *
 * Versión del parser que acepta el contenido CSV como string
 * en lugar de leer desde el filesystem.
 * Mismos tipos y lógica que parser.ts, pero compatible con OneDrive.
 */

import type { JournalEntry, SaldoCuenta, ParseResult, ValidationError } from './parser'
export type { JournalEntry, SaldoCuenta, ParseResult, ValidationError }

// ─── Utilidades internas (copiadas de parser.ts) ─────────────────────────────

function toCents(value: string): number {
  const n = parseFloat(value.trim())
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = '' }
    else { current += ch }
  }
  fields.push(current.trim())
  return fields
}

function normalizeLines(raw: string): string[] {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function yearFromPeriod(periodo: string): number {
  return parseInt(periodo.substring(0, 4), 10)
}

function validateDoubleEntry(entries: JournalEntry[]): ValidationError[] {
  const errors: ValidationError[] = []
  const byAsiento = new Map<string, JournalEntry[]>()
  for (const entry of entries) {
    const group = byAsiento.get(entry.asiento) ?? []
    group.push(entry)
    byAsiento.set(entry.asiento, group)
  }
  for (const [asiento, lines] of byAsiento) {
    const totalDebe  = lines.reduce((s, l) => s + l.debe,  0)
    const totalHaber = lines.reduce((s, l) => s + l.haber, 0)
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

// ─── Parseo desde string ──────────────────────────────────────────────────────

function parseCsvContent(
  content: string,
  periodo: string,
): { entries: JournalEntry[]; errors: ValidationError[] } {
  const lines   = normalizeLines(content)
  const entries: JournalEntry[]    = []
  const errors:  ValidationError[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const fields = parseCsvLine(line)
    if (fields.length < 9) {
      errors.push({ asiento: `fila ${i + 1}`, tipo: 'formato_invalido',
        detalle: `Se esperaban 9 columnas, se encontraron ${fields.length}` })
      continue
    }
    const [fecha, asiento, tipo, codCuenta, nombreCuenta, descripcion, debeStr, haberStr, centroCosto] = fields
    entries.push({ fecha, asiento, tipo, codCuenta, nombreCuenta, descripcion,
      debe: toCents(debeStr), haber: toCents(haberStr), centroCosto, periodo })
  }
  return { entries, errors }
}

export function parseOpeningBalancesContent(content: string, year: number): Map<string, SaldoCuenta> {
  const saldos = new Map<string, SaldoCuenta>()
  const lines  = normalizeLines(content)

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const fields = parseCsvLine(line)
    if (fields.length < 4) continue
    const [codCuenta, nombreCuenta, saldoStr, tipoStr] = fields
    const tipo    = tipoStr.trim().toUpperCase()
    const rawAbs  = Math.abs(toCents(saldoStr))
    const saldo   = tipo === 'A' ? -rawAbs : rawAbs
    const totalDebe  = saldo > 0 ? saldo : 0
    const totalHaber = saldo < 0 ? -saldo : 0
    saldos.set(codCuenta, { codCuenta, nombreCuenta, totalDebe, totalHaber, saldo })
  }

  // Validación
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
      `[parser-content] saldos_iniciales_${year}.csv NO cuadra: ` +
      `Activos ${(sumActivos / 100).toFixed(2)} vs Pasivo+Patrimonio ${(sumPasivoPatrimonio / 100).toFixed(2)}`
    )
  }
  return saldos
}

export function parsePeriodContent(content: string, periodo: string): ParseResult {
  const { entries, errors: parseErrors } = parseCsvContent(content, periodo)
  const validationErrors = validateDoubleEntry(entries)
  return {
    entries,
    periodosLeidos: entries.length > 0 ? [periodo] : [],
    errors: [...parseErrors, ...validationErrors],
  }
}

export function parseMultiplePeriodsContent(
  contents: { periodo: string; content: string }[],
): ParseResult {
  const allEntries:     JournalEntry[]    = []
  const allParseErrors: ValidationError[] = []
  const periodosLeidos: string[]          = []

  for (const { periodo, content } of contents) {
    const { entries, errors } = parseCsvContent(content, periodo)
    allEntries.push(...entries)
    allParseErrors.push(...errors)
    if (entries.length > 0) periodosLeidos.push(periodo)
  }

  const validationErrors = validateDoubleEntry(allEntries)
  return { entries: allEntries, periodosLeidos, errors: [...allParseErrors, ...validationErrors] }
}

// ─── Cálculos de saldos (copiados de parser.ts) ───────────────────────────────

export function calcularSaldosPorCuentaContent(entries: JournalEntry[]): Map<string, SaldoCuenta> {
  const map = new Map<string, SaldoCuenta>()
  for (const e of entries) {
    const prev = map.get(e.codCuenta) ?? {
      codCuenta: e.codCuenta, nombreCuenta: e.nombreCuenta,
      totalDebe: 0, totalHaber: 0, saldo: 0,
    }
    prev.totalDebe  += e.debe
    prev.totalHaber += e.haber
    prev.saldo       = prev.totalDebe - prev.totalHaber
    map.set(e.codCuenta, prev)
  }
  return map
}

export function calcularSaldosConAperturaContent(
  opening: Map<string, SaldoCuenta>,
  entries: JournalEntry[],
): Map<string, SaldoCuenta> {
  const saldos = new Map<string, SaldoCuenta>(
    [...opening.entries()].map(([k, v]) => [k, { ...v }])
  )
  for (const e of entries) {
    const prev = saldos.get(e.codCuenta) ?? {
      codCuenta: e.codCuenta, nombreCuenta: e.nombreCuenta,
      totalDebe: 0, totalHaber: 0, saldo: 0,
    }
    prev.totalDebe  += e.debe
    prev.totalHaber += e.haber
    prev.saldo       = prev.totalDebe - prev.totalHaber
    saldos.set(e.codCuenta, prev)
  }
  return saldos
}
