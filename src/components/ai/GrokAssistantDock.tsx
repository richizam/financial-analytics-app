'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import GrokAssistant from './GrokAssistant'
import type { AiUiAction } from '@/app/actions'
import { buildComparativoHref, buildPeriodHref } from '@/lib/period-selection'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

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

  return (
    <>
      {/* ── Floating launcher ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir asistente AI"
        className={`fixed bottom-6 right-6 z-40 inline-flex items-center gap-2.5 rounded-full bg-blue-600 px-5 py-4 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition-all duration-200 hover:bg-blue-700 hover:shadow-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 print:hidden ${
          open ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'
        }`}
      >
        <Sparkles className="h-6 w-6" />
        <span className="hidden text-base sm:inline">AI</span>
      </button>

      {/* ── Slide-over (Radix Dialog handles Escape, scroll-lock, focus-trap, overlay) ── */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 sm:max-w-md print:hidden"
        >
          <SheetTitle className="sr-only">Asistente AI</SheetTitle>
          <SheetDescription className="sr-only">
            Análisis financiero conversacional sobre datos calculados por el backend
          </SheetDescription>
          <GrokAssistant
            ruc={ruc}
            selectedPeriods={selectedPeriods}
            onApplyAction={handleApplyAction}
            onClose={close}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
