'use client'

interface PeriodSelectorProps {
  ruc: string
  allRucs: string[]
  periodsByRuc: Record<string, string[]>
  selectedRuc: string
  selectedPeriods: string[]
  onRucChange: (ruc: string) => void
  onPeriodsChange: (periods: string[]) => void
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function getYears(periods: string[]): string[] {
  return Array.from(new Set(periods.map(p => p.substring(0, 4)))).sort()
}

function periodsForYear(periods: string[], year: string): string[] {
  return periods.filter(p => p.startsWith(year))
}

function quarterPeriods(periods: string[], year: string, q: 1 | 2 | 3 | 4): string[] {
  const starts = { 1: ['01','02','03'], 2: ['04','05','06'], 3: ['07','08','09'], 4: ['10','11','12'] }
  return periods.filter(p => p.startsWith(year) && starts[q].includes(p.substring(4)))
}

export default function PeriodSelector({
  allRucs,
  periodsByRuc,
  selectedRuc,
  selectedPeriods,
  onRucChange,
  onPeriodsChange,
}: PeriodSelectorProps) {
  const available = periodsByRuc[selectedRuc] ?? []
  const years = getYears(available)
  // Año activo = el del primer período seleccionado, o el último disponible
  const activeYear = selectedPeriods[0]?.substring(0, 4) ?? years[years.length - 1] ?? ''

  function setYear(year: string) {
    // Al cambiar de año, seleccionar todos los meses de ese año
    onPeriodsChange(periodsForYear(available, year))
  }

  function setQuarter(q: 1 | 2 | 3 | 4) {
    const ps = quarterPeriods(available, activeYear, q)
    if (ps.length > 0) onPeriodsChange(ps)
  }

  function setFullYear() {
    onPeriodsChange(periodsForYear(available, activeYear))
  }

  function toggleMonth(p: string) {
    if (selectedPeriods.includes(p)) {
      const next = selectedPeriods.filter(x => x !== p)
      if (next.length > 0) onPeriodsChange(next)
    } else {
      onPeriodsChange([...selectedPeriods, p].sort())
    }
  }

  const monthsOfActiveYear = periodsForYear(available, activeYear)

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* RUC */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">RUC</label>
        <select
          value={selectedRuc}
          onChange={e => onRucChange(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {allRucs.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Año */}
      <div className="flex items-center gap-1">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              y === activeYear
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Presets rápidos */}
      <div className="flex items-center gap-1">
        {([1, 2, 3, 4] as const).map(q => {
          const ps = quarterPeriods(available, activeYear, q)
          const active = ps.length > 0 && ps.every(p => selectedPeriods.includes(p)) && selectedPeriods.length === ps.length
          return (
            <button
              key={q}
              disabled={ps.length === 0}
              onClick={() => setQuarter(q)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                  : ps.length === 0
                  ? 'cursor-not-allowed opacity-30 bg-gray-50 text-gray-400'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Q{q}
            </button>
          )
        })}
        <button
          onClick={setFullYear}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            selectedPeriods.length === monthsOfActiveYear.length && monthsOfActiveYear.every(p => selectedPeriods.includes(p))
              ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Año
        </button>
      </div>

      {/* Meses individuales */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 12 }, (_, i) => {
          const mm = String(i + 1).padStart(2, '0')
          const p = `${activeYear}${mm}`
          const available_ = available.includes(p)
          const selected = selectedPeriods.includes(p)
          return (
            <button
              key={p}
              disabled={!available_}
              onClick={() => available_ && toggleMonth(p)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                selected && available_
                  ? 'bg-blue-600 text-white shadow-sm'
                  : available_
                  ? 'bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300'
                  : 'cursor-not-allowed opacity-25 bg-gray-50 text-gray-400'
              }`}
            >
              {MESES[i]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
