import { getAvailableRucs, getAllPeriods, getAnomaliesData } from '@/app/actions'
import AnomaliesView from '@/components/anomalies/AnomaliesView'
import { selectRucAndPeriods } from '@/lib/period-selection'
import type { PeriodSearchParams } from '@/lib/period-selection'

export default async function AnomaliesPage({ searchParams }: { searchParams?: PeriodSearchParams }) {
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-700">No se encontraron empresas en <code>data/empresas/</code></p>
        </div>
      </main>
    )
  }

  const periodsByRuc  = await getAllPeriods(rucs)
  const { selectedRuc: defaultRuc, selectedPeriods: defaultPeriods } = selectRucAndPeriods({
    rucs,
    periodsByRuc,
    searchParams,
    defaultRuc: rucs[0],
  })

  const initialData = defaultPeriods.length > 0
    ? await getAnomaliesData(defaultRuc, defaultPeriods)
    : null

  return (
    <AnomaliesView
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriods={defaultPeriods}
      initialData={initialData}
    />
  )
}
