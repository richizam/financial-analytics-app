'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { DashboardData } from '@/app/actions'

// Live financial scope (active company + selected periods) shared between the
// page content and the left sidebar. The dashboard and feature views own their
// period selection in local state; they publish it here so the sidebar can build
// context-aware navigation links and power the global export without re-deriving
// the selection from the URL. `data` is only present while the dashboard is
// mounted, letting the sidebar export reuse the already-loaded statements.
export interface FinancialScope {
  ruc: string
  periodos: string[]
  data: DashboardData | null
}

interface ScopeContextValue {
  scope: FinancialScope | null
  setScope: (scope: FinancialScope | null) => void
}

const FinancialScopeContext = createContext<ScopeContextValue | null>(null)

export function FinancialScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<FinancialScope | null>(null)
  const value = useMemo<ScopeContextValue>(() => ({ scope, setScope }), [scope])
  return <FinancialScopeContext.Provider value={value}>{children}</FinancialScopeContext.Provider>
}

export function useFinancialScope(): FinancialScope | null {
  return useContext(FinancialScopeContext)?.scope ?? null
}

/**
 * Publish the current view's active company + periods (and, on the dashboard,
 * the loaded data) so the sidebar stays in sync. Safe to call outside a provider
 * (no-op), so individual views don't need to know about the layout.
 */
export function usePublishFinancialScope(
  ruc: string,
  periodos: string[],
  data: DashboardData | null = null,
): void {
  const setScope = useContext(FinancialScopeContext)?.setScope
  const key = periodos.join(',')

  useEffect(() => {
    return () => setScope?.(null)
  }, [setScope])

  useEffect(() => {
    setScope?.({ ruc, periodos, data })
    // `key` captures period membership; `periodos` itself is read from closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruc, key, data, setScope])
}
