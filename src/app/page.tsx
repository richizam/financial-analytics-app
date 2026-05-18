import { getAvailableRucs, getAllPeriods, getDashboardData, getCompanyConfig } from './actions'
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

  // Leer nombres de empresa desde config.json de cada RUC (si existe)
  const companyNames: Record<string, string> = {}
  for (const ruc of rucs) {
    const cfg = await getCompanyConfig(ruc)
    companyNames[ruc] = cfg?.razonSocial ?? ruc
  }

  // ── Selección por defecto: preferir un RUC con datos CSV ──
  const defaultRuc = rucs.find(r => (periodsByRuc[r] ?? []).length > 0) ?? rucs[0]
  const allPeriods = periodsByRuc[defaultRuc] ?? []
  const years      = [...new Set(allPeriods.map(p => p.substring(0, 4)))].sort()
  const lastYear   = years[years.length - 1] ?? ''
  const defaultPeriods = allPeriods.filter(p => p.startsWith(lastYear))

  // null cuando no hay archivos CSV aún (el Dashboard muestra pantalla de bienvenida)
  const initialData = defaultPeriods.length > 0
    ? await getDashboardData(defaultRuc, defaultPeriods)
    : null

  // Solo error real cuando había períodos pero falló la carga
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
