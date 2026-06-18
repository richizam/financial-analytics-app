'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import GrokAssistant from './GrokAssistant'
import type { AiUiAction } from '@/app/actions'
import { buildComparativoHref, buildPeriodHref } from '@/lib/period-selection'

interface GrokAssistantDockProps {
  ruc: string
  selectedPeriods: string[]
  onApplyAction: (action: AiUiAction) => void
}

const DOCK_OPEN_KEY = 'financial-ai-assistant-open-v1'

function actionHref(action: AiUiAction): string | null {
  if (!action.href) return null
  const targetPath = action.href.split('?')[0]
  if (targetPath === '/comparativo' && action.periodosA?.length && action.periodosB?.length) {
    return buildComparativoHref(targetPath, action.ruc, action.periodosA, action.periodosB)
  }
  return buildPeriodHref(targetPath, action.ruc, action.periodos)
}

export default function GrokAssistantDock({ ruc, selectedPeriods, onApplyAction }: GrokAssistantDockProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(DOCK_OPEN_KEY) === 'true')
    } catch {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_OPEN_KEY, String(open))
    } catch {
      // Ignore storage failures; the assistant still works for the current page.
    }
  }, [open])

  const handleApplyAction = useCallback((action: AiUiAction) => {
    const target = actionHref(action)
    const targetPath = action.href?.split('?')[0]
    if (target && targetPath) {
      if (targetPath !== pathname) {
        router.push(target)
        return
      }
      onApplyAction(action)
      router.replace(target)
      return
    }
    onApplyAction(action)
  }, [onApplyAction, pathname, router])

  // Keep the off-screen panel out of the tab order; on open, trap basics: focus,
  // Escape to close, and lock background scroll. Restored on close/unmount.
  useEffect(() => {
    const el = panelRef.current
    if (el) el.inert = !open
    if (!open) return

    el?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, close])

  return (
    <>
      {/* ── Floating launcher ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir asistente AI"
        className={`fixed bottom-6 right-6 z-40 inline-flex items-center gap-2.5 rounded-full bg-blue-600 px-5 py-4 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition-all duration-200 hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 print:hidden ${
          open ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'
        }`}
      >
        <Sparkles className="h-6 w-6" />
        <span className="hidden text-base sm:inline">AI</span>
      </button>

      {/* ── Overlay + slide-over ── */}
      <div className={`fixed inset-0 z-50 overflow-hidden print:hidden ${open ? '' : 'pointer-events-none'}`}>
        {/* backdrop */}
        <div
          onClick={close}
          aria-hidden="true"
          className={`absolute inset-0 bg-gray-900/25 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Asistente AI"
          tabIndex={-1}
          className={`absolute right-0 top-0 h-full w-full max-w-md transform bg-white shadow-2xl outline-none transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <GrokAssistant
            ruc={ruc}
            selectedPeriods={selectedPeriods}
            onApplyAction={handleApplyAction}
            onClose={close}
          />
        </div>
      </div>
    </>
  )
}
