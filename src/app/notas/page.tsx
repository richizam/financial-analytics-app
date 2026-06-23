export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getAvailableRucs, getAllPeriods, getNotasData, getCompanyConfig } from '@/app/actions'
import NotasView from './NotasView'
import { selectRucAndPeriods } from '@/lib/period-selection'
import type { PeriodSearchParams } from '@/lib/period-selection'
import DataAccessError from '@/components/common/DataAccessError'

export default async function NotasPage({ searchParams }: { searchParams?: PeriodSearchParams }) {
  try {
    return await renderNotasPage(searchParams)
  } catch (error) {
    console.error('Failed to render notas page', error)
    return <DataAccessError />
  }
}

async function renderNotasPage(searchParams?: PeriodSearchParams) {
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-xs">
          <p className="text-sm font-medium text-gray-700">No hay empresas cargadas.</p>
        </div>
      </main>
    )
  }

  const periodsByRuc = await getAllPeriods(rucs)
  const companyNames: Record<string, string> = {}
  for (const ruc of rucs) {
    const cfg = await getCompanyConfig(ruc)
    companyNames[ruc] = cfg?.razonSocial ?? ruc
  }

  const { selectedRuc: defaultRuc, selectedPeriods: defaultPeriods } = selectRucAndPeriods({
    rucs,
    periodsByRuc,
    searchParams,
  })

  const initialData = defaultPeriods.length > 0
    ? await getNotasData(defaultRuc, defaultPeriods)
    : null

  return (
    <NotasView
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriods={defaultPeriods}
      initialData={initialData}
      companyNames={companyNames}
    />
  )
}
