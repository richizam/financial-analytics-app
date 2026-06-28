'use client'

// Lightweight shadcn-style chart wrapper around Recharts: injects per-series
// `--color-<key>` CSS variables from a config (driven by the theme's --chart-*
// tokens) and provides themed tooltip/legend content. Recharts v3 compatible.
import * as React from 'react'
import * as Recharts from 'recharts'

import { cn } from '@/lib/utils'

export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

type ChartContextValue = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart(): ChartContextValue {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />')
  return ctx
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ReactElement
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${(id || uniqueId).replace(/:/g, '')}`
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          'w-full text-xs',
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line]:stroke-border/60",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
          '[&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none [&_.recharts-sector]:outline-none [&_.recharts-dot]:stroke-transparent',
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <Recharts.ResponsiveContainer>{children}</Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, c]) => c.color)
  if (colorConfig.length === 0) return null
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig
          .map(([key, c]) => `  --color-${key}: ${c.color};`)
          .join('\n')}\n}`,
      }}
    />
  )
}

const ChartTooltip = Recharts.Tooltip

interface TooltipContentProps {
  active?: boolean
  payload?: any[]
  label?: React.ReactNode
  formatter?: (value: number, name: string) => React.ReactNode
  hideLabel?: boolean
  className?: string
}

function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  hideLabel = false,
  className,
}: TooltipContentProps) {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  return (
    <div className={cn('min-w-[8rem] rounded-lg border border-border bg-background px-2.5 py-1.5 shadow-xl', className)}>
      {!hideLabel && <div className="mb-1 font-medium text-foreground">{label}</div>}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const cfg = config[key]
          const color = item.color || `var(--color-${key})`
          return (
            <div key={key + index} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                {cfg?.label ?? item.name ?? key}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatter ? formatter(Number(item.value), key) : item.value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ChartLegend = Recharts.Legend

function ChartLegendContent({ payload, className }: { payload?: any[]; className?: string }) {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3', className)}>
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.value ?? index)
        const cfg = config[key]
        return (
          <span key={key + index} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: item.color }} />
            {cfg?.label ?? item.value}
          </span>
        )
      })}
    </div>
  )
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, useChart }
