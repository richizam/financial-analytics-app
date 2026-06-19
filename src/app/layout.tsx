import type { Metadata } from 'next'
import './globals.css'
import { getServerSession } from 'next-auth'
import { Providers } from './providers'
import { AppShell } from '@/components/layout/AppShell'
import { authOptions } from '@/lib/auth'
import { getCompaniesOverview, type CompanyOverview } from '@/app/actions'

export const metadata: Metadata = {
  title: 'Financial Analytics',
  description: 'Plataforma de análisis financiero bajo NIIF — Ecuador',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Only authenticated app routes need the company list; skip the backend call
  // on public auth screens. Failures degrade gracefully to an empty sidebar.
  const session = await getServerSession(authOptions)
  let companies: CompanyOverview[] = []
  if (session) {
    try {
      companies = await getCompaniesOverview()
    } catch {
      companies = []
    }
  }

  return (
    <html lang="es">
      <body>
        <Providers>
          <AppShell companies={companies}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
