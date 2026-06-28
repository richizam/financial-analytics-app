'use client'

import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Estado = 'green' | 'yellow' | 'red' | 'gray'

const ACCENT: Record<Estado, { bar: string; icon: string; spark: string }> = {
  green: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600', spark: 'var(--chart-2)' },
  yellow: { bar: 'bg-amber-400', icon: 'bg-amber-50 text-amber-600', spark: 'var(--chart-4)' },
  red: { bar: 'bg-red-500', icon: 'bg-red-50 text-red-600', spark: 'var(--chart-5)' },
  gray: { bar: 'bg-gray-300', icon: 'bg-gray-100 text-gray-500', spark: 'var(--chart-3)' },
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

  return (
    <Card className="relative overflow-hidden">
      <span className={cn('absolute inset-y-0 left-0 w-1', accent.bar)} aria-hidden />
      <CardContent className="px-4 py-3.5 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
            {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
          </div>
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        </div>

        {sparkData.length > 1 && (
          <div className="mt-2.5 h-10 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent.spark} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={accent.spark} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={accent.spark}
                  strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
