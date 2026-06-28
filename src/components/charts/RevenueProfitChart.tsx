'use client'

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import type { MonthBar } from '@/app/actions'
import { fmtCompacto, fmtMoneda } from '@/lib/format'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const config: ChartConfig = {
  ingresos: { label: 'Ingresos', color: 'var(--chart-1)' },
  utilidadNeta: { label: 'Utilidad neta', color: 'var(--chart-2)' },
}

export default function RevenueProfitChart({ data }: { data: MonthBar[] }) {
  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillIngresos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-ingresos)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-ingresos)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
        <YAxis tickFormatter={fmtCompacto} tickLine={false} axisLine={false} width={56} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmtMoneda(Number(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area dataKey="ingresos" type="monotone" stroke="var(--color-ingresos)" strokeWidth={2} fill="url(#fillIngresos)" />
        <Line dataKey="utilidadNeta" type="monotone" stroke="var(--color-utilidadNeta)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartContainer>
  )
}
