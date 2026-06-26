'use client'

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangle, ArrowLeftRight, Bot, Check, Loader2, Send, Sparkles, Trash2, TrendingUp, X } from 'lucide-react'
import { askGrokAnalytics } from '@/app/actions'
import type { AiChatResponse, AiUiAction } from '@/app/actions'
import { fmtPeriodo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

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
  { icon: TrendingUp, text: 'Resume el periodo actual' },
  { icon: ArrowLeftRight, text: 'Compara Q1 vs Q2 de 2026' },
  { icon: AlertTriangle, text: '¿Hay anomalías en este rango?' },
]

const MESSAGE_STORAGE_KEY_PREFIX = 'financial-ai-assistant-messages-v1'
const MEMORY_STORAGE_KEY_PREFIX = 'financial-ai-assistant-memory-v1'
const THREAD_STORAGE_KEY_PREFIX = 'financial-ai-assistant-thread-v1'
const MAX_STORED_MESSAGES = 30
const ACTIVE_CONTEXT_MESSAGES = 10
const MAX_MEMORY_ITEMS = 18
const MAX_MEMORY_ENTRY_CHARS = 240
const MAX_MEMORY_SUMMARY_CHARS = 2400

const DASHBOARD_MEMORY_LABELS: Record<string, string> = {
  financial_summary: 'Dashboard principal',
  profit_and_loss: 'Estado de resultados',
  balance_sheet: 'Estado de situacion financiera',
  revenue_breakdown: 'Detalle de ingresos',
  expense_breakdown: 'Detalle de gastos',
  variance_analysis: 'Comparativo',
  anomalies: 'Anomalias',
  general_ledger: 'Libro Mayor',
  notes: 'Notas NIIF',
}

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

function compactText(value: string, maxChars = MAX_MEMORY_ENTRY_CHARS): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length <= maxChars) return compacted
  return `${compacted.slice(0, maxChars - 1).trim()}...`
}

function periodMemoryLabel(periods: string[] | undefined): string {
  const clean = (periods ?? []).filter(period => /^\d{6}$/.test(period)).sort()
  if (clean.length === 0) return ''
  if (clean.length === 1) return fmtPeriodo(clean[0])
  return `${fmtPeriodo(clean[0])} - ${fmtPeriodo(clean[clean.length - 1])}`
}

function actionMemoryEntry(action: AiUiAction, executedTools: string[] | undefined): string {
  const view = DASHBOARD_MEMORY_LABELS[action.dashboard_id] ?? action.dashboard_id ?? 'Vista'
  const parts = [`Vista: ${view}`]

  if (action.ruc) parts.push(`RUC ${action.ruc}`)

  const periodosA = periodMemoryLabel(action.periodosA)
  const periodosB = periodMemoryLabel(action.periodosB)
  const periodos = periodMemoryLabel(action.periodos)
  if (periodosA || periodosB) {
    if (periodosA) parts.push(`Periodo A ${periodosA}`)
    if (periodosB) parts.push(`Periodo B ${periodosB}`)
  } else if (periodos) {
    parts.push(`Periodo ${periodos}`)
  }

  const tools = (executedTools ?? []).filter(Boolean)
  if (tools.length > 0) parts.push(`Herramientas ${tools.join(', ')}`)

  return compactText(parts.join('. '))
}

function memoryEntriesFromMessages(messages: ChatMessage[]): string[] {
  return messages
    .map(message => {
      if (message.role === 'user') {
        return compactText(`Usuario pidio: ${message.content}`)
      }

      const action = message.response?.ui_action
      if (action) {
        return actionMemoryEntry(action, message.response?.executed_tools)
      }

      return compactText(`Asistente respondio: ${message.content}`)
    })
    .filter(Boolean)
}

function mergeMemory(current: string[], additions: string[]): string[] {
  const merged = [...current]
  for (const addition of additions) {
    const clean = compactText(addition)
    if (clean && !merged.includes(clean)) merged.push(clean)
  }
  return merged.slice(-MAX_MEMORY_ITEMS)
}

function buildConversationSummary(messages: ChatMessage[], storedMemory: string[]): string | undefined {
  const olderExactMessages = messages.slice(0, Math.max(0, messages.length - ACTIVE_CONTEXT_MESSAGES))
  const merged = mergeMemory(storedMemory, memoryEntriesFromMessages(olderExactMessages))
  if (merged.length === 0) return undefined
  return compactText(merged.map(item => `- ${item}`).join('\n'), MAX_MEMORY_SUMMARY_CHARS)
}

function scopedStorageKey(prefix: string, ruc: string): string {
  return `${prefix}:${ruc || 'unknown'}`
}

export default function GrokAssistant({ ruc, selectedPeriods, onApplyAction, onClose }: GrokAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationMemory, setConversationMemory] = useState<string[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const memoryRef = useRef<string[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Server-side conversation thread (LangGraph path); null until the backend assigns one.
  const conversationIdRef = useRef<string | null>(null)
  // True while the assistant is waiting for the user's answer to a clarification.
  const [awaitingClarification, setAwaitingClarification] = useState(false)
  const messageStorageKey = useMemo(() => scopedStorageKey(MESSAGE_STORAGE_KEY_PREFIX, ruc), [ruc])
  const memoryStorageKey = useMemo(() => scopedStorageKey(MEMORY_STORAGE_KEY_PREFIX, ruc), [ruc])
  const threadStorageKey = useMemo(() => scopedStorageKey(THREAD_STORAGE_KEY_PREFIX, ruc), [ruc])

  useEffect(() => {
    messagesRef.current = []
    memoryRef.current = []
    conversationIdRef.current = null
    setMessages([])
    setConversationMemory([])
    setAwaitingClarification(false)
    setError(null)

    try {
      const stored = window.localStorage.getItem(messageStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          const cleanMessages = parsed
            .filter(item => item?.role === 'user' || item?.role === 'assistant')
            .slice(-MAX_STORED_MESSAGES)
          messagesRef.current = cleanMessages
          setMessages(cleanMessages)
        }
      }

      const storedThread = window.localStorage.getItem(threadStorageKey)
      if (storedThread) conversationIdRef.current = storedThread

      const storedMemory = window.localStorage.getItem(memoryStorageKey)
      if (storedMemory) {
        const parsedMemory = JSON.parse(storedMemory)
        if (Array.isArray(parsedMemory)) {
          const cleanMemory = parsedMemory
            .filter(item => typeof item === 'string' && item.trim())
            .map(item => compactText(item))
            .slice(-MAX_MEMORY_ITEMS)
          memoryRef.current = cleanMemory
          setConversationMemory(cleanMemory)
        }
      }
    } catch {
      // Ignore corrupt local data and start a fresh conversation.
    }
  }, [memoryStorageKey, messageStorageKey, threadStorageKey])

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isPending])

  function persistMessages(nextMessages: ChatMessage[]) {
    try {
      window.localStorage.setItem(messageStorageKey, JSON.stringify(nextMessages.slice(-MAX_STORED_MESSAGES)))
    } catch {
      // Storage is best effort only.
    }
  }

  function persistMemory(nextMemory: string[]) {
    try {
      window.localStorage.setItem(memoryStorageKey, JSON.stringify(nextMemory.slice(-MAX_MEMORY_ITEMS)))
    } catch {
      // Storage is best effort only.
    }
  }

  function updateMessages(updater: (current: ChatMessage[]) => ChatMessage[]) {
    const rawMessages = updater(messagesRef.current)
    const overflowCount = Math.max(0, rawMessages.length - MAX_STORED_MESSAGES)
    const overflow = rawMessages.slice(0, overflowCount)
    const nextMessages = rawMessages.slice(-MAX_STORED_MESSAGES)

    if (overflow.length > 0) {
      const nextMemory = mergeMemory(memoryRef.current, memoryEntriesFromMessages(overflow))
      memoryRef.current = nextMemory
      setConversationMemory(nextMemory)
      persistMemory(nextMemory)
    }

    messagesRef.current = nextMessages
    setMessages(nextMessages)
    persistMessages(nextMessages)
  }

  function clearConversation() {
    messagesRef.current = []
    memoryRef.current = []
    conversationIdRef.current = null
    setMessages([])
    setConversationMemory([])
    setAwaitingClarification(false)
    setError(null)
    try {
      window.localStorage.removeItem(messageStorageKey)
      window.localStorage.removeItem(memoryStorageKey)
      window.localStorage.removeItem(threadStorageKey)
    } catch {
      // Storage is best effort only.
    }
  }

  const conversation = useMemo(
    () => messages.slice(-ACTIVE_CONTEXT_MESSAGES).map(({ role, content, response }) => ({
      role,
      content,
      ui_action: response?.ui_action ?? undefined,
      executed_tools: response?.executed_tools ?? undefined,
    })),
    [messages],
  )

  const conversationSummary = useMemo(
    () => buildConversationSummary(messages, conversationMemory),
    [messages, conversationMemory],
  )

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const clean = input.trim()
    if (!clean || isPending) return

    setInput('')
    setError(null)
    updateMessages(current => [...current, { role: 'user', content: clean }])

    // If the assistant is waiting on a clarification, this message is the answer.
    const resume = awaitingClarification ? clean : undefined

    startTransition(async () => {
      try {
        const response = await askGrokAnalytics({
          message: clean,
          ruc,
          periodos: selectedPeriods,
          conversation,
          conversation_summary: conversationSummary,
          conversation_id: conversationIdRef.current ?? undefined,
          resume,
        })
        if (response.conversation_id) {
          conversationIdRef.current = response.conversation_id
          try {
            window.localStorage.setItem(threadStorageKey, response.conversation_id)
          } catch {
            // Storage is best effort only.
          }
        }
        setAwaitingClarification(Boolean(response.clarification))
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

  function answerClarification(option: string) {
    if (isPending) return
    setInput('')
    setError(null)
    updateMessages(current => [...current, { role: 'user', content: option }])

    startTransition(async () => {
      try {
        const response = await askGrokAnalytics({
          message: option,
          ruc,
          periodos: selectedPeriods,
          conversation,
          conversation_summary: conversationSummary,
          conversation_id: conversationIdRef.current ?? undefined,
          resume: option,
        })
        if (response.conversation_id) {
          conversationIdRef.current = response.conversation_id
          try {
            window.localStorage.setItem(threadStorageKey, response.conversation_id)
          } catch {
            // Storage is best effort only.
          }
        }
        setAwaitingClarification(Boolean(response.clarification))
        updateMessages(current => [
          ...current,
          { role: 'assistant', content: response.message, response },
        ])
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
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-white">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-600/30">
            <Bot className="h-5 w-5" />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-gray-900">Asistente financiero</h2>
            <p className="truncate text-xs text-gray-500">Conectado a tus datos</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {hasMessages && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={clearConversation}
              title="Limpiar conversación"
              aria-label="Limpiar conversación"
              className="text-gray-400 hover:text-gray-700"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Cerrar"
              aria-label="Cerrar asistente"
              className="text-gray-400 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {/* ── Transcript / empty state ── */}
      <ScrollArea className="min-h-0 flex-1 bg-gray-50/70">
        <div className="flex min-h-full flex-col gap-4 px-4 py-5">
          {!hasMessages ? (
            <div className="m-auto flex w-full max-w-xs flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-600/25">
                <Sparkles className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-gray-900">¿En qué puedo ayudarte?</h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">
                Pregúntame sobre ingresos, márgenes, comparativos o anomalías de tus periodos.
              </p>
              <div className="mt-5 grid w-full gap-2">
                {EXAMPLES.map(({ icon: Icon, text }) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => setInput(text)}
                    className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-sm text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:border-blue-300 hover:shadow-md"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isUser = message.role === 'user'
                const action = message.response?.ui_action
                const citations = message.response?.citations ?? []
                const clarification = message.response?.clarification
                const isLastMessage = index === messages.length - 1
                const clarificationOptions =
                  isLastMessage && awaitingClarification ? clarification?.options ?? [] : []
                return (
                  <div key={index} className={`flex w-full items-end gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                    {!isUser && (
                      <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm ring-1 ring-gray-200">
                        <Bot className="h-4 w-4" />
                      </span>
                    )}
                    <div
                      className={`flex min-w-0 max-w-[82%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                        isUser
                          ? 'rounded-br-md bg-blue-600 text-white'
                          : 'rounded-bl-md border border-gray-200 bg-white text-gray-800'
                      }`}
                    >
                      <p className="break-words whitespace-pre-wrap leading-relaxed">{message.content}</p>

                      {citations.length > 0 && (
                        <p className={`text-[11px] ${isUser ? 'text-blue-100' : 'text-gray-400'}`}>
                          Fuente: {citations.map(c => c.source).join(', ')}
                        </p>
                      )}

                      {action && hasActionPeriods(action) && (
                        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/70">
                          <Check className="h-3.5 w-3.5" />
                          {actionLabel(action)}
                        </span>
                      )}

                      {clarificationOptions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {clarificationOptions.map(option => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => answerClarification(option)}
                              disabled={isPending}
                              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {isPending && (
                <div className="flex items-end gap-2.5">
                  <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm ring-1 ring-gray-200">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300" />
                  </div>
                </div>
              )}

              <div ref={endRef} />
            </>
          )}
        </div>
      </ScrollArea>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-gray-100 bg-white px-3 py-3">
        {error && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribe tu pregunta…"
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-hidden"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isPending || !input.trim()}
            title="Enviar"
            aria-label="Enviar"
            className="size-9 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  )
}
