'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { MonthBar } from '@/app/actions'
import { fmtPct } from '@/lib/format'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const config: ChartConfig = {
  margenBruto: { label: 'Margen bruto', color: 'var(--chart-1)' },
  margenNeto: { label: 'Margen neto', color: 'var(--chart-2)' },
}

export default function MarginTrendChart({ data }: { data: MonthBar[] }) {
  const rows = data.map(month => ({
    label: month.label,
    margenBruto: month.ingresos > 0 ? month.utilidadBruta / month.ingresos : 0,
    margenNeto: month.ingresos > 0 ? month.utilidadNeta / month.ingresos : 0,
  }))

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <LineChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
        <YAxis tickFormatter={(value) => fmtPct(Number(value))} tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmtPct(Number(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="margenBruto" type="monotone" stroke="var(--color-margenBruto)" strokeWidth={2} dot={false} />
        <Line dataKey="margenNeto" type="monotone" stroke="var(--color-margenNeto)" strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  )
}
