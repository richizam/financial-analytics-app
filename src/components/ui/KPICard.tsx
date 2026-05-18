'use client'

import type { LucideIcon } from 'lucide-react'

type Estado = 'green' | 'yellow' | 'red' | 'gray'

interface KPICardProps {
  titulo: string
  valor: string
  subtitulo?: string
  estado?: Estado
  Icon: LucideIcon
}

const estadoBorder: Record<Estado, string> = {
  green:  'border-l-emerald-500',
  yellow: 'border-l-amber-400',
  red:    'border-l-red-500',
  gray:   'border-l-gray-300',
}

const estadoIconBg: Record<Estado, string> = {
  green:  'bg-emerald-50 text-emerald-600',
  yellow: 'bg-amber-50  text-amber-600',
  red:    'bg-red-50    text-red-600',
  gray:   'bg-gray-100  text-gray-400',
}

export default function KPICard({ titulo, valor, subtitulo, estado = 'gray', Icon }: KPICardProps) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${estadoBorder[estado]} p-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{titulo}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 font-mono tabular-nums">{valor}</p>
          {subtitulo && <p className="mt-1 text-xs text-gray-400">{subtitulo}</p>}
        </div>
        <div className={`shrink-0 rounded-lg p-2 ${estadoIconBg[estado]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}
