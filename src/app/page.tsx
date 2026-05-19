import { getAvailableRucs, getAllPeriods, getDashboardData, getCompanyConfig } from './actions'
import Dashboard from '@/components/dashboard/Dashboard'
import Link from 'next/link'
import { Upload } from 'lucide-react'

export default async function Home() {
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm max-w-md">
          <div className="mb-4 text-4xl">📊</div>
          <p className="text-base font-semibold text-gray-800">No hay empresas cargadas aún</p>
          <p className="mt-2 text-sm text-gray-500">
            Sube los archivos CSV de tu empresa para comenzar a ver el dashboard financiero.
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Upload size={16} /> Subir archivos CSV
          </Link>
          <p className="mt-4 text-xs text-gray-400">
            Formato: <code>YYYYMM.csv</code> con columnas de asientos contables
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
