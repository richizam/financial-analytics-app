export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getAvailableRucs, getAllPeriods, getNotasData, getCompanyConfig } from '@/app/actions'
import NotasView from './NotasView'

export default async function NotasPage() {
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
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

  const defaultRuc     = rucs.find(r => (periodsByRuc[r] ?? []).length > 0) ?? rucs[0]
  const allPeriods     = periodsByRuc[defaultRuc] ?? []
  const years          = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()
  const lastYear       = years[years.length - 1] ?? ''
  const defaultPeriods = allPeriods.filter(p => p.startsWith(lastYear))

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
