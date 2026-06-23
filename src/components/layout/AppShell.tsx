'use client'

import { Suspense, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import type { CompanyOverview } from '@/app/actions'

export function AppShell({
  companies,
  user,
  children,
}: {
  companies: CompanyOverview[]
  user: { name: string | null; email: string | null } | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Public auth screens render without the app chrome.
  if (pathname?.startsWith('/auth')) return <>{children}</>

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 md:block">
        <Suspense fallback={null}>
          <Sidebar companies={companies} user={user} />
        </Suspense>
      </aside>

      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menú"
        className="fixed left-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-600 shadow-sm backdrop-blur transition hover:text-gray-900 md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <SheetDescription className="sr-only">Empresas y acciones</SheetDescription>
          <Suspense fallback={null}>
            <Sidebar companies={companies} user={user} onNavigate={() => setMobileOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
