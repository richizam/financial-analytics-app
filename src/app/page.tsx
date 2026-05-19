import { getAvailableRucs, getAllPeriods, getDashboardData, getCompanyConfig } from './actions'
import Dashboard from '@/components/dashboard/Dashboard'

export default async function Home() {
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm max-w-md">
          <div className="mb-4 text-4xl">📁</div>
          <p className="text-base font-semibold text-gray-800">No se encontraron empresas</p>
          <p className="mt-2 text-sm text-gray-500">
            En tu <strong>OneDrive</strong>, crea la siguiente estructura de carpetas:
          </p>
          <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4 text-left font-mono text-xs text-gray-700">
            <p>📁 financial-analytics/</p>
            <p className="ml-4">📁 [RUC de 13 dígitos]/</p>
            <p className="ml-8">📄 202501.csv</p>
            <p className="ml-8">📄 202502.csv</p>
            <p className="ml-8">📄 saldos_iniciales_2025.csv</p>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Luego recarga esta página. El app lee los archivos directamente desde tu OneDrive.
          </p>
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
    ? await getDashboardData(defaultRuc, defaultPeriods)
    : null

  if (defaultPeriods.length > 0 && !initialData) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Error al cargar los datos iniciales.</p>
      </main>
    )
  }

  return (
    <Dashboard
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriods={defaultPeriods}
      initialData={initialData}
      companyNames={companyNames}
    />
  )
}
