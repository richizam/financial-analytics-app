'use client'

import { FormEvent, useMemo, useState, useTransition } from 'react'
import { Bot, Loader2, Send, Sparkles } from 'lucide-react'
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
}

function actionLabel(action: AiUiAction): string {
  const periods = action.periodos ?? []
  if (periods.length === 0) return 'Aplicar vista'
  if (periods.length === 1) return `Aplicar ${fmtPeriodo(periods[0])}`
  return `Aplicar ${fmtPeriodo(periods[0])} - ${fmtPeriodo(periods[periods.length - 1])}`
}

export default function GrokAssistant({ ruc, selectedPeriods, onApplyAction }: GrokAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
    setMessages(current => [...current, { role: 'user', content: clean }])

    startTransition(async () => {
      try {
        const response = await askGrokAnalytics({
          message: clean,
          ruc,
          periodos: selectedPeriods,
          conversation,
        })
        setMessages(current => [
          ...current,
          { role: 'assistant', content: response.message, response },
        ])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Grok AI</h2>
            <p className="text-xs text-gray-500">Usa datos calculados por el backend</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
          <Sparkles className="h-3 w-3" />
          Seguro
        </span>
      </div>

      <div className="space-y-3 px-4 py-3">
        {messages.length === 0 ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              'Resume el periodo actual',
              'Compara Q1 vs Q2 de 2026',
              'Hay anomalias en este rango?',
            ].map(example => (
              <button
                key={example}
                type="button"
                onClick={() => setInput(example)}
                className="rounded-md border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                {example}
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`rounded-md px-3 py-2 text-sm ${
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] bg-blue-600 text-white'
                    : 'mr-auto max-w-[92%] border border-gray-200 bg-gray-50 text-gray-800'
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                {message.response?.citations.length ? (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Fuente: {message.response.citations.map(c => c.source).join(', ')}
                  </p>
                ) : null}
                {message.response?.ui_action?.periodos?.length ? (
                  <button
                    type="button"
                    onClick={() => message.response?.ui_action && onApplyAction(message.response.ui_action)}
                    className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                  >
                    {actionLabel(message.response.ui_action)}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pregunta por ingresos, margen, comparativos o anomalias"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Enviar"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </section>
  )
}
