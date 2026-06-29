'use client'

import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Estado = 'green' | 'yellow' | 'red' | 'gray'

const ACCENT: Record<Estado, { icon: string; spark: string }> = {
  green:  { icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100', spark: 'var(--chart-2)' },
  yellow: { icon: 'bg-amber-50 text-amber-600 ring-amber-100',       spark: 'var(--chart-4)' },
  red:    { icon: 'bg-red-50 text-red-600 ring-red-100',             spark: 'var(--chart-5)' },
  gray:   { icon: 'bg-gray-50 text-gray-500 ring-gray-100',          spark: 'var(--chart-3)' },
}

interface StatCardProps {
  label: string
  value: string
  sub?: string
  estado?: Estado
  Icon: LucideIcon
  /** Optional series for a mini sparkline (auto-scaled). */
  spark?: number[]
}

export default function StatCard({ label, value, sub, estado = 'gray', Icon, spark }: StatCardProps) {
  const accent = ACCENT[estado]
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }))
  const gradientId = `spark-${label.replace(/\s+/g, '-')}-${estado}`
  const hasSpark = sparkData.length > 1

  return (
    <Card className="group relative flex flex-col overflow-hidden border-border/70 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md">
      <div className="flex-1 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value}</p>
            {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
          </div>
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', accent.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        </div>
      </div>

      {/* Sparkline bleeds to the card's bottom edge. Space is reserved even when
          absent so every card in the row keeps the same height. */}
      <div className="h-11 w-full opacity-90 transition-opacity group-hover:opacity-100">
        {hasSpark && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent.spark} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={accent.spark} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={accent.spark}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
