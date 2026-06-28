export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getCompaniesOverview } from './actions'
import Dashboard from '@/components/dashboard/Dashboard'
import Link from 'next/link'
import { Upload } from 'lucide-react'
import { selectRucAndPeriods } from '@/lib/period-selection'
import type { PeriodSearchParams } from '@/lib/period-selection'
import DataAccessError from '@/components/common/DataAccessError'
import { overviewCompanyNames, overviewPeriodsByRuc, overviewRucs } from '@/lib/company-overview'

export default async function Home({ searchParams }: { searchParams?: PeriodSearchParams }) {
  try {
    return await renderHome(searchParams)
  } catch (error) {
    console.error('Failed to render dashboard page', error)
    return <DataAccessError />
  }
}

async function renderHome(searchParams?: PeriodSearchParams) {
  const companies = await getCompaniesOverview()
  const rucs = overviewRucs(companies)

  if (rucs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-xs max-w-md">
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

  const periodsByRuc = overviewPeriodsByRuc(companies)
  const companyNames = overviewCompanyNames(companies)

  const { selectedRuc: defaultRuc, selectedPeriods: defaultPeriods } = selectRucAndPeriods({
    rucs,
    periodsByRuc,
    searchParams,
  })

  return (
    <Dashboard
      allRucs={rucs}
      periodsByRuc={periodsByRuc}
      initialRuc={defaultRuc}
      initialPeriods={defaultPeriods}
      initialData={null}
      companyNames={companyNames}
    />
  )
}
