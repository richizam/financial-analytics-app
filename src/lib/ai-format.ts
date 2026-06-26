// Number formatting for AI assistant blocks. The backend sends plain numbers
// (USD dollars, ratios 0-1, "times") plus a `format` hint; the frontend owns the
// presentation so financial figures look consistent and professional — never raw
// markdown like **994,418 USD**.
import { fmtPeriodo } from '@/lib/format'

export type MetricFormat = 'currency' | 'percent' | 'ratio' | 'number' | 'integer'

const usd = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimal2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export function formatMetric(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  switch (format) {
    case 'currency':
      return `USD ${usd.format(value)}`
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    case 'ratio':
      return `${decimal2.format(value)}x`
    case 'integer':
      return usd.format(Math.round(value))
    default:
      return decimal2.format(value)
  }
}

// Signed variant for deltas (e.g. "+USD 50,000", "-3.2%").
export function formatDelta(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  switch (format) {
    case 'currency':
      return `${value < 0 ? '-' : '+'}USD ${usd.format(Math.abs(value))}`
    case 'percent':
      return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
    case 'ratio':
      return `${value >= 0 ? '+' : ''}${decimal2.format(value)}x`
    default:
      return `${value >= 0 ? '+' : ''}${decimal2.format(value)}`
  }
}

export function deltaTone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === undefined || value === 0 || Number.isNaN(value)) return 'neutral'
  return value > 0 ? 'positive' : 'negative'
}

// Turn a list of YYYYMM periods into a compact label, e.g. "Ene 2025 – Dic 2025".
export function formatPeriodRange(periods: string[] | undefined): string {
  const clean = (periods ?? []).filter(p => /^\d{6}$/.test(p)).sort()
  if (clean.length === 0) return ''
  if (clean.length === 1) return fmtPeriodo(clean[0])
  return `${fmtPeriodo(clean[0])} – ${fmtPeriodo(clean[clean.length - 1])}`
}
