export type PeriodSearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parsePeriodParam(value: string | string[] | undefined): string[] {
  const raw = firstParam(value)
  if (!raw) return []
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => /^\d{6}$/.test(part))
}

export function buildPeriodHref(pathname: string, ruc: string, periodos: string[]): string {
  const params = new URLSearchParams()
  if (ruc) params.set('ruc', ruc)
  const validPeriods = periodos.filter(period => /^\d{6}$/.test(period))
  if (validPeriods.length > 0) params.set('periodos', validPeriods.join(','))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function buildComparativoHref(pathname: string, ruc: string, periodosA: string[], periodosB: string[]): string {
  const params = new URLSearchParams()
  if (ruc) params.set('ruc', ruc)
  const validA = periodosA.filter(period => /^\d{6}$/.test(period))
  const validB = periodosB.filter(period => /^\d{6}$/.test(period))
  if (validA.length > 0) params.set('periodosA', validA.join(','))
  if (validB.length > 0) params.set('periodosB', validB.join(','))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function latestYearPeriods(periods: string[]): string[] {
  const years = [...new Set(periods.map(period => period.substring(0, 4)))].sort()
  const lastYear = years[years.length - 1] ?? ''
  return periods.filter(period => period.startsWith(lastYear))
}

function defaultComparativoPeriods(periods: string[]): { periodosA: string[]; periodosB: string[] } {
  const years = [...new Set(periods.map(period => period.substring(0, 4)))].sort()
  const lastYear = years[years.length - 1] ?? ''
  const prevYear = years.length >= 2 ? years[years.length - 2] : lastYear
  return {
    periodosA: periods.filter(period => period.startsWith(prevYear)),
    periodosB: periods.filter(period => period.startsWith(lastYear)),
  }
}

export function previousComparablePeriods(available: string[], selected: string[]): string[] {
  const sorted = [...selected].sort()
  if (sorted.length === 0) return defaultComparativoPeriods(available).periodosA

  const previousYearMatches = sorted
    .map(period => `${Number(period.substring(0, 4)) - 1}${period.substring(4, 6)}`)
    .filter(period => available.includes(period))
  if (previousYearMatches.length > 0) return previousYearMatches

  const firstSelected = sorted[0]
  const earlier = available.filter(period => period < firstSelected)
  if (earlier.length === 0) return defaultComparativoPeriods(available).periodosA
  return earlier.slice(Math.max(0, earlier.length - sorted.length))
}

export function selectRucAndPeriods({
  rucs,
  periodsByRuc,
  searchParams,
  defaultRuc,
}: {
  rucs: string[]
  periodsByRuc: Record<string, string[]>
  searchParams?: PeriodSearchParams
  defaultRuc?: string
}): { selectedRuc: string; selectedPeriods: string[] } {
  const requestedRuc = firstParam(searchParams?.ruc)
  const fallbackRuc = defaultRuc && rucs.includes(defaultRuc)
    ? defaultRuc
    : rucs.find(ruc => (periodsByRuc[ruc] ?? []).length > 0) ?? rucs[0]
  const selectedRuc = requestedRuc && rucs.includes(requestedRuc) ? requestedRuc : fallbackRuc
  const available = periodsByRuc[selectedRuc] ?? []
  const requestedPeriods = parsePeriodParam(searchParams?.periodos)
  const selectedPeriods = requestedPeriods.filter(period => available.includes(period))

  return {
    selectedRuc,
    selectedPeriods: selectedPeriods.length > 0 ? selectedPeriods : latestYearPeriods(available),
  }
}

export function selectComparativoRucAndPeriods({
  rucs,
  periodsByRuc,
  searchParams,
  defaultRuc,
}: {
  rucs: string[]
  periodsByRuc: Record<string, string[]>
  searchParams?: PeriodSearchParams
  defaultRuc?: string
}): { selectedRuc: string; periodosA: string[]; periodosB: string[] } {
  const requestedRuc = firstParam(searchParams?.ruc)
  const fallbackRuc = defaultRuc && rucs.includes(defaultRuc)
    ? defaultRuc
    : rucs.find(ruc => (periodsByRuc[ruc] ?? []).length > 0) ?? rucs[0]
  const selectedRuc = requestedRuc && rucs.includes(requestedRuc) ? requestedRuc : fallbackRuc
  const available = periodsByRuc[selectedRuc] ?? []
  const defaults = defaultComparativoPeriods(available)
  const requestedA = parsePeriodParam(searchParams?.periodosA).filter(period => available.includes(period))
  const requestedB = parsePeriodParam(searchParams?.periodosB).filter(period => available.includes(period))
  const requestedSingle = parsePeriodParam(searchParams?.periodos).filter(period => available.includes(period))

  const periodosB = requestedB.length > 0
    ? requestedB
    : requestedSingle.length > 0
    ? requestedSingle
    : defaults.periodosB
  const periodosA = requestedA.length > 0
    ? requestedA
    : requestedSingle.length > 0
    ? previousComparablePeriods(available, requestedSingle)
    : defaults.periodosA

  return { selectedRuc, periodosA, periodosB }
}
