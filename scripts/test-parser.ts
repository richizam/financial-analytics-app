import {
  listAvailablePeriods,
  parsePeriod,
  parseMultiplePeriods,
  loadOpeningBalances,
  calcularSaldosPorCuenta,
  calcularSaldosConApertura,
  cierreAnual,
  yearFromPeriod,
} from '../src/lib/parser'

const RUC = '0990123456001'

// ── 1. Listar períodos ────────────────────────────────────────────────────────
const periodos = listAvailablePeriods(RUC)
console.log(`\nPeríodos disponibles (${periodos.length}): ${periodos.join(' | ')}`)

// ── 2. Saldos de apertura 2025 ────────────────────────────────────────────────
const apertura2025 = loadOpeningBalances(RUC, 2025)
console.log(`\nApertura 2025 (${apertura2025.size} cuentas):`)
for (const [, s] of apertura2025) {
  const tipo = s.saldo >= 0 ? 'D' : 'A'
  console.log(`  ${s.codCuenta.padEnd(12)} ${s.nombreCuenta.padEnd(35)} ${tipo}  ${(s.saldo / 100).toFixed(2).padStart(12)}`)
}

// ── 3. Enero con apertura ─────────────────────────────────────────────────────
const enero = parsePeriod(RUC, '202501')
console.log(`\nEnero 2025 — ${enero.entries.length} entries | ${enero.errors.length} errores`)

const saldosEneroConApertura = calcularSaldosConApertura(RUC, 2025, enero.entries)
const inventarioEnero = saldosEneroConApertura.get('1.1.5.01')
console.log(`  Inventario con apertura: ${inventarioEnero ? (inventarioEnero.saldo / 100).toFixed(2) : 'n/d'}`)
const inventarioSinApertura = calcularSaldosPorCuenta(enero.entries).get('1.1.5.01')
console.log(`  Inventario sin apertura: ${inventarioSinApertura ? (inventarioSinApertura.saldo / 100).toFixed(2) : 'n/d'}`)

// ── 4. Q1 2025 consolidado con apertura ───────────────────────────────────────
const q1 = parseMultiplePeriods(RUC, ['202501', '202502', '202503'])
const saldosQ1 = calcularSaldosConApertura(RUC, 2025, q1.entries)
console.log(`\nQ1 2025 con apertura (${saldosQ1.size} cuentas, ${q1.errors.length} errores):`)
for (const [, s] of [...saldosQ1.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const tipo = s.saldo >= 0 ? 'D' : 'A'
  console.log(`  ${s.codCuenta.padEnd(12)} ${s.nombreCuenta.padEnd(35)} ${tipo}  ${(s.saldo / 100).toFixed(2).padStart(12)}`)
}

// ── 5. Cierre anual 2025 ──────────────────────────────────────────────────────
console.log(`\nEjecutando cierreAnual(2025)...`)
const cierre = cierreAnual(RUC, 2025)
if (cierre.omitido) {
  console.log(`  Omitido: ${cierre.warnings[0]}`)
} else {
  console.log(`  Archivo generado: ${cierre.archivoGenerado}`)
  console.log(`  Cuentas en saldos iniciales 2026: ${[...cierre.saldosFinales.values()].filter(s => ['1','2','3'].includes(s.codCuenta.split('.')[0]) && s.saldo !== 0).length}`)
  if (cierre.warnings.length > 0) {
    cierre.warnings.forEach(w => console.log(`  ⚠ ${w}`))
  }
}

// ── 6. Intentar cierre de nuevo (no debe sobreescribir) ───────────────────────
console.log(`\nReintento cierreAnual(2025) — debe omitir:`)
const cierre2 = cierreAnual(RUC, 2025)
console.log(`  Omitido: ${cierre2.omitido} | Warning: ${cierre2.warnings[0]}`)

// ── 7. Verificar yearFromPeriod ───────────────────────────────────────────────
console.log(`\nyearFromPeriod('202503') = ${yearFromPeriod('202503')}`)
console.log(`yearFromPeriod('202601') = ${yearFromPeriod('202601')}`)
