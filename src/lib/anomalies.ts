export interface BenfordDigit {
  digit: number
  expected: number
  observed: number
  expectedCount: number
  observedCount: number
}

export interface BenfordResult {
  chiSquare: number
  suspicious: boolean
  riskLevel: 'low' | 'medium' | 'high'
  sampleSize: number
  digits: BenfordDigit[]
}

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
  monto: number
  codCuenta: string
  nombreCuenta: string
  entries: DuplicateEntry[]
}

export interface OutlierEntry {
  fecha: string
  asiento: string
  codCuenta: string
  nombreCuenta: string
  descripcion: string
  monto: number
  deviationFactor: number
  direction: 'high' | 'low'
}

export interface RiskScore {
  score: number
  nivel: 'green' | 'yellow' | 'red'
  components: { benford: number; duplicates: number; outliers: number }
}

export interface AnomaliesData {
  riskScore: RiskScore
  benford: BenfordResult
  duplicates: DuplicateGroup[]
  outliers: OutlierEntry[]
  totalEntries: number
}
