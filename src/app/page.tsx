import { getAvailableRucs, getAllPeriods, getDashboardData } from './actions'
import Dashboard from '@/components/dashboard/Dashboard'

export default async function Home() {
  // ── Leer RUC y períodos disponibles (filesystem, server-side) ──
  const rucs = await getAvailableRucs()

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-700">No se encontraron empresas en <code>data/empresas/</code></p>
          <p className="mt-1 text-xs text-gray-400">Crea una carpeta con el RUC y archivos YYYYMM.csv</p>
        </div>
      </main>
    )
  }

  const periodsByRuc = await getAllPeriods(rucs)

  // ── Selección por defecto: primer RUC, último año con todos los meses disponibles ──
  const defaultRuc = rucs[0]
  const allPeriods = periodsByRuc[defaultRuc] ?? []
  const years      = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()
  const lastYear   = years[years.length - 1] ?? ''
  const defaultPeriods = allPeriods.filter(p => p.startsWith(lastYear))

  // ── Pre-calcular datos iniciales (SSR) ──
  const initialData = await getDashboardData(defaultRuc, defaultPeriods)

  if (!initialData) {
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
    />
  )
}
