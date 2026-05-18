/** Centavos → "$175,021.34" */
export function fmtMoneda(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

/** Centavos → "175,021.34" (sin símbolo, para tablas) */
export function fmtNumero(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

/** Centavos negativos → "(175,021.34)" en rojo contable */
export function fmtContable(cents: number): string {
  if (cents < 0) return `(${fmtNumero(-cents)})`
  return fmtNumero(cents)
}

/** 0.392 → "39.2%" */
export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/** 3.31 → "3.31x" */
export function fmtVeces(n: number): string {
  return `${n.toFixed(2)}x`
}

/** 84.3 → "84 días" */
export function fmtDias(n: number): string {
  return `${Math.round(n)} días`
}

/** "202503" → "Mar 2025" */
export function fmtPeriodo(p: string): string {
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const month = parseInt(p.substring(4, 6), 10)
  return `${meses[month - 1]} ${p.substring(0, 4)}`
}

/** Centavos → "$175K" o "$1.2M" para ejes de gráfico */
export function fmtCompacto(cents: number): string {
  const n = cents / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
