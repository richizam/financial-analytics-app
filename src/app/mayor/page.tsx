export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getCompaniesOverview } from '@/app/actions'
import MayorView from '@/components/mayor/MayorView'
import { selectRucAndPeriods } from '@/lib/period-selection'
import type { PeriodSearchParams } from '@/lib/period-selection'
import DataAccessError from '@/components/common/DataAccessError'
import { overviewPeriodsByRuc, overviewRucs } from '@/lib/company-overview'

export default async function MayorPage({ searchParams }: { searchParams?: PeriodSearchParams }) {
  try {
    return await renderMayorPage(searchParams)
  } catch (error) {
    console.error('Failed to render mayor page', error)
    return <DataAccessError />
  }
}

async function renderMayorPage(searchParams?: PeriodSearchParams) {
  const companies = await getCompaniesOverview()
  const rucs = overviewRucs(companies)

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-xs">
          <p className="text-sm font-medium text-gray-700">No se encontraron empresas en <code>data/empresas/</code></p>
        </div>
      </main>
    )
  }

  const periodsByRuc = overviewPeriodsByRuc(companies)
  const { selectedRuc: defaultRuc, selectedPeriods: defaultPeriods } = selectRucAndPeriods({
    rucs,
    periodsByRuc,
    searchParams,
    defaultRuc: rucs[0],
  })

  return (
    <MayorView
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriods={defaultPeriods}
      initialData={null}
    />
  )
}
