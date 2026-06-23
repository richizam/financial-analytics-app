import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { AppShell } from '@/components/layout/AppShell'
import { getCompaniesOverview, type CompanyOverview } from '@/app/actions'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Financial Analytics',
  description: 'Plataforma de análisis financiero bajo NIIF — Ecuador',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabaseConfigured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const supabase = supabaseConfigured ? await createClient() : null
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } }

  let companies: CompanyOverview[] = []
  if (user) {
    try {
      companies = await getCompaniesOverview()
    } catch {
      companies = []
    }
  }
  const appUser = user
    ? { name: user.user_metadata?.full_name ?? null, email: user.email ?? null }
    : null

  return (
    <html lang="es">
      <body>
        <Providers>
          <AppShell
            companies={companies}
            user={appUser}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  )
}
