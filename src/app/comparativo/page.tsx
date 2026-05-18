import { getAvailableRucs, getAllPeriods, getComparativoData } from '@/app/actions'
import ComparativoView from '@/components/comparativo/ComparativoView'

export default async function ComparativoPage() {
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

  const periodsByRuc = await getAllPeriods(rucs)
  const defaultRuc   = rucs[0]
  const allPeriods   = periodsByRuc[defaultRuc] ?? []
  const years        = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()

  // Período A = penúltimo año; Período B = último año (o mismo año si solo hay uno)
  const lastYear     = years[years.length - 1] ?? ''
  const prevYear     = years.length >= 2 ? years[years.length - 2] : lastYear
  const periodosA    = allPeriods.filter(p => p.startsWith(prevYear))
  const periodosB    = allPeriods.filter(p => p.startsWith(lastYear))

  const initialData = await getComparativoData(defaultRuc, periodosA, periodosB)

  return (
    <ComparativoView
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriodosA={periodosA}
      initialPeriodosB={periodosB}
      initialData={initialData}
    />
  )
}
