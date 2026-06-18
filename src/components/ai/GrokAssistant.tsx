'use client'

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react'
import { Bot, Check, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react'
import { askGrokAnalytics } from '@/app/actions'
import type { AiChatResponse, AiUiAction } from '@/app/actions'
import { fmtPeriodo } from '@/lib/format'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  response?: AiChatResponse
}

interface GrokAssistantProps {
  ruc: string
  selectedPeriods: string[]
  onApplyAction: (action: AiUiAction) => void
  onClose?: () => void
}

const EXAMPLES = [
  'Resume el periodo actual',
  'Compara Q1 vs Q2 de 2026',
  '¿Hay anomalías en este rango?',
]

const MESSAGE_STORAGE_KEY = 'financial-ai-assistant-messages-v1'
const MAX_STORED_MESSAGES = 30

function actionLabel(action: AiUiAction): string {
  if (action.dashboard_id === 'variance_analysis' && action.periodosA?.length && action.periodosB?.length) {
    return `Comparativo aplicado - ${periodLabel(action.periodosA)} vs ${periodLabel(action.periodosB)}`
  }
  const periods = action.periodos ?? []
  if (periods.length === 0) return 'Vista aplicada'
  if (periods.length === 1) return `Vista aplicada · ${fmtPeriodo(periods[0])}`
  return `Vista aplicada · ${fmtPeriodo(periods[0])} – ${fmtPeriodo(periods[periods.length - 1])}`
}

function periodLabel(periods: string[]): string {
  const sorted = [...periods].sort()
  if (sorted.length === 0) return 'sin periodo'
  if (sorted.length === 1) return fmtPeriodo(sorted[0])
  return `${fmtPeriodo(sorted[0])} - ${fmtPeriodo(sorted[sorted.length - 1])}`
}

function hasActionPeriods(action: AiUiAction): boolean {
  return (
    (action.periodos?.length ?? 0) > 0
    || (action.periodosA?.length ?? 0) > 0
    || (action.periodosB?.length ?? 0) > 0
  )
}

export default function GrokAssistant({ ruc, selectedPeriods, onApplyAction, onClose }: GrokAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MESSAGE_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        setMessages(
          parsed
            .filter(item => item?.role === 'user' || item?.role === 'assistant')
            .slice(-MAX_STORED_MESSAGES),
        )
      }
    } catch {
      // Ignore corrupt local data and start a fresh conversation.
    }
  }, [])

  function persistMessages(nextMessages: ChatMessage[]) {
    try {
      window.localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(nextMessages.slice(-MAX_STORED_MESSAGES)))
    } catch {
      // Storage is best effort only.
    }
  }

  function updateMessages(updater: (current: ChatMessage[]) => ChatMessage[]) {
    setMessages(current => {
      const next = updater(current).slice(-MAX_STORED_MESSAGES)
      persistMessages(next)
      return next
    })
  }

  function clearConversation() {
    setMessages([])
    setError(null)
    try {
      window.localStorage.removeItem(MESSAGE_STORAGE_KEY)
    } catch {
      // Storage is best effort only.
    }
  }

  const conversation = useMemo(
    () => messages.slice(-6).map(({ role, content }) => ({ role, content })),
    [messages],
  )

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const clean = input.trim()
    if (!clean || isPending) return

    setInput('')
    setError(null)
    updateMessages(current => [...current, { role: 'user', content: clean }])

    startTransition(async () => {
      try {
        const response = await askGrokAnalytics({
          message: clean,
          ruc,
          periodos: selectedPeriods,
          conversation,
        })
        updateMessages(current => [
          ...current,
          { role: 'assistant', content: response.message, response },
        ])
        // Auto-apply the suggested view — the dashboard updates without a button press.
        if (response.ui_action && hasActionPeriods(response.ui_action)) {
          onApplyAction(response.ui_action)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full flex-col bg-white">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Bot className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">AI</h2>
            <p className="truncate text-xs text-gray-500">Análisis sobre datos calculados por el backend</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Seguro
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearConversation}
              title="Limpiar conversacion"
              aria-label="Limpiar conversacion"
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Cerrar"
              aria-label="Cerrar asistente"
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Transcript / empty state ── */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!hasMessages ? (
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
              <Sparkles className="h-3.5 w-3.5" />
              Sugerencias
            </p>
            <div className="grid gap-2">
              {EXAMPLES.map(example => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => {
            const isUser = message.role === 'user'
            const action = message.response?.ui_action
            const citations = message.response?.citations ?? []
            return (
              <div key={index} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                {!isUser && (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Bot className="h-3.5 w-3.5" />
                  </span>
                )}
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    isUser
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>

                  {citations.length > 0 && (
                    <p className={`mt-2 text-[11px] ${isUser ? 'text-blue-100' : 'text-gray-500'}`}>
                      Fuente: {citations.map(c => c.source).join(', ')}
                    </p>
                  )}

                  {action && hasActionPeriods(action) && (
                    <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                      {actionLabel(action)}
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}

        {isPending && (
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
            </div>
          </div>
        )}
      </div>

      {/* ── Composer ── */}
      <div className="border-t border-gray-100 p-4">
        {error && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pregunta por ingresos, margen, comparativos o anomalías"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Enviar"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  )
}
