import { getAvailableRucs, getAllPeriods, getAnomaliesData } from '@/app/actions'
import AnomaliesView from '@/components/anomalies/AnomaliesView'

export default async function AnomaliesPage() {
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
  const defaultRuc    = rucs[0]
  const allPeriods    = periodsByRuc[defaultRuc] ?? []
  const years         = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()
  const lastYear      = years[years.length - 1] ?? ''
  const defaultPeriods = allPeriods.filter(p => p.startsWith(lastYear))

  const initialData = await getAnomaliesData(defaultRuc, defaultPeriods)

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
