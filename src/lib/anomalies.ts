import type { JournalEntry } from './parser'

// ─── Benford's Law ────────────────────────────────────────────────────────────

const BENFORD_EXPECTED: Record<number, number> = {
  1: 0.301, 2: 0.176, 3: 0.125, 4: 0.097,
  5: 0.079, 6: 0.067, 7: 0.058, 8: 0.051, 9: 0.046,
}

export interface BenfordDigit {
  digit: number
  expected: number      // fracción 0-1 según Benford
  observed: number      // fracción 0-1 observada
  expectedCount: number
  observedCount: number
}

export interface BenfordResult {
  chiSquare: number
  suspicious: boolean   // chi² > 15.507 (p < 0.05, 8 g.l.)
  riskLevel: 'low' | 'medium' | 'high'
  sampleSize: number
  digits: BenfordDigit[]
}

export function analyzeBenford(entries: JournalEntry[]): BenfordResult {
  const amounts: number[] = []
  for (const e of entries) {
    if (e.debe  > 0) amounts.push(e.debe)
    if (e.haber > 0) amounts.push(e.haber)
  }

  // Extraer primer dígito de cada monto (sobre el valor en dólares, no centavos)
  const digitCounts: Record<number, number> = {}
  let n = 0
  for (const a of amounts) {
    const dollars = Math.abs(a / 100)
    if (dollars < 1) continue
    const d = parseInt(String(Math.floor(dollars))[0], 10)
    if (d >= 1 && d <= 9) {
      digitCounts[d] = (digitCounts[d] ?? 0) + 1
      n++
    }
  }

  let chiSquare = 0
  const digits: BenfordDigit[] = []

  for (let d = 1; d <= 9; d++) {
    const exp = BENFORD_EXPECTED[d]
    const obsCount  = digitCounts[d] ?? 0
    const expCount  = n * exp
    if (expCount > 0) chiSquare += Math.pow(obsCount - expCount, 2) / expCount
    digits.push({
      digit: d,
      expected:      exp,
      observed:      n > 0 ? obsCount / n : 0,
      expectedCount: Math.round(expCount),
      observedCount: obsCount,
    })
  }

  return {
    chiSquare,
    suspicious: chiSquare > 15.507,
    riskLevel:  chiSquare > 20 ? 'high' : chiSquare > 15.507 ? 'medium' : 'low',
    sampleSize: n,
    digits,
  }
}

// ─── Duplicados (mismo monto + misma cuenta + ±3 días, distinto asiento) ─────

export interface DuplicateEntry {
  fecha: string
  asiento: string
  codCuenta: string
  nombreCuenta: string
  descripcion: string
  debe: number
  haber: number
}

export interface DuplicateGroup {
  monto: number           // centavos (el mayor entre debe/haber)
  codCuenta: string
  nombreCuenta: string
  entries: DuplicateEntry[]
}


export function findDuplicates(entries: JournalEntry[]): DuplicateGroup[] {
  // Clave: fecha exacta + codCuenta + monto (debe o haber) + descripción exacta
  const bySignature = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    const monto = e.debe > 0 ? e.debe : e.haber
    const key = `${e.fecha}|${e.codCuenta}|${monto}|${e.descripcion}`
    const g = bySignature.get(key) ?? []
    g.push(e)
    bySignature.set(key, g)
  }

  const groups: DuplicateGroup[] = []

  for (const [key, group] of bySignature) {
    if (group.length < 2) continue

    // Solo cuenta como duplicado si hay al menos 2 números de asiento distintos
    const uniqueAsientos = new Set(group.map(e => e.asiento))
    if (uniqueAsientos.size < 2) continue

    const parts = key.split('|')
    const codCuenta = parts[1]
    const monto = parseInt(parts[2], 10)
    groups.push({
      monto,
      codCuenta,
      nombreCuenta: group[0].nombreCuenta,
      entries: [...group]
        .sort((a, b) => a.asiento.localeCompare(b.asiento))
          .map(e => ({
            fecha:        e.fecha,
            asiento:      e.asiento,
            codCuenta:    e.codCuenta,
            nombreCuenta: e.nombreCuenta,
            descripcion:  e.descripcion,
            debe:         e.debe,
            haber:        e.haber,
          })),
    })
  }

  return groups.sort((a, b) => b.monto - a.monto)
}

// ─── Outliers por cuenta (método IQR) ────────────────────────────────────────

export interface OutlierEntry {
  fecha: string
  asiento: string
  codCuenta: string
  nombreCuenta: string
  descripcion: string
  monto: number           // centavos positivo
  deviationFactor: number // cuántas veces supera el límite IQR (> 0)
  direction: 'high' | 'low'
}

export function findOutliers(entries: JournalEntry[]): OutlierEntry[] {
  const byAccount = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    const g = byAccount.get(e.codCuenta) ?? []
    g.push(e)
    byAccount.set(e.codCuenta, g)
  }

  const outliers: OutlierEntry[] = []

  for (const accountEntries of byAccount.values()) {
    const amounts = accountEntries
      .map(e => Math.max(e.debe, e.haber))
      .filter(a => a > 0)
      .sort((a, b) => a - b)

    if (amounts.length < 4) continue

    const q1  = amounts[Math.floor(amounts.length * 0.25)]
    const q3  = amounts[Math.floor(amounts.length * 0.75)]
    const iqr = q3 - q1
    if (iqr === 0) continue

    const lower = q1 - 1.5 * iqr
    const upper = q3 + 1.5 * iqr

    for (const e of accountEntries) {
      const monto = Math.max(e.debe, e.haber)
      if (monto <= 0) continue

      if (monto > upper) {
        outliers.push({
          fecha:           e.fecha,
          asiento:         e.asiento,
          codCuenta:       e.codCuenta,
          nombreCuenta:    e.nombreCuenta,
          descripcion:     e.descripcion,
          monto,
          deviationFactor: Math.round((monto - upper) / iqr * 10) / 10,
          direction:       'high',
        })
      } else if (lower > 0 && monto < lower) {
        outliers.push({
          fecha:           e.fecha,
          asiento:         e.asiento,
          codCuenta:       e.codCuenta,
          nombreCuenta:    e.nombreCuenta,
          descripcion:     e.descripcion,
          monto,
          deviationFactor: Math.round((lower - monto) / iqr * 10) / 10,
          direction:       'low',
        })
      }
    }
  }

  return outliers.sort((a, b) => b.deviationFactor - a.deviationFactor)
}

// ─── Score de riesgo (0-100) ──────────────────────────────────────────────────

export interface RiskScore {
  score: number
  nivel: 'green' | 'yellow' | 'red'
  components: { benford: number; duplicates: number; outliers: number }
}

export function calcularRiskScore(
  benford: BenfordResult,
  duplicates: DuplicateGroup[],
  outliers: OutlierEntry[],
): RiskScore {
  const benfordPts    = benford.chiSquare > 20 ? 40 : benford.chiSquare > 15.507 ? 25 : 0
  const duplicatePts  = Math.min(30, duplicates.length * 8)
  const severeOutliers = outliers.filter(o => o.deviationFactor > 3).length
  const outlierPts    = Math.min(30, severeOutliers * 6)

  const score = Math.min(100, benfordPts + duplicatePts + outlierPts)
  return {
    score,
    nivel: score < 30 ? 'green' : score < 60 ? 'yellow' : 'red',
    components: { benford: benfordPts, duplicates: duplicatePts, outliers: outlierPts },
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface AnomaliesData {
  riskScore:    RiskScore
  benford:      BenfordResult
  duplicates:   DuplicateGroup[]
  outliers:     OutlierEntry[]
  totalEntries: number
}

export function analyzeAnomalies(entries: JournalEntry[]): AnomaliesData {
  const benford    = analyzeBenford(entries)
  const duplicates = findDuplicates(entries)
  const outliers   = findOutliers(entries)
  const riskScore  = calcularRiskScore(benford, duplicates, outliers)
  return { riskScore, benford, duplicates, outliers, totalEntries: entries.length }
}
