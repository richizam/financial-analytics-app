'use server'

import { postBackendJson } from '@/lib/python-backend'
import type { AiChatResponse, AiUiAction } from './types'

export async function askGrokAnalytics(input: {
  message: string
  ruc: string
  periodos: string[]
  conversation?: Array<{
    role: 'user' | 'assistant'
    content: string
    ui_action?: AiUiAction | null
    executed_tools?: string[]
  }>
  conversation_summary?: string
  conversation_id?: string
  resume?: string
}): Promise<AiChatResponse> {
  return postBackendJson<AiChatResponse>('/ai/chat', input)
}
