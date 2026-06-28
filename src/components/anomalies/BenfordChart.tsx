'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { BenfordDigit } from '@/lib/anomalies'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

interface BenfordChartProps {
  digits: BenfordDigit[]
  suspicious: boolean
}

export default function BenfordChart({ digits, suspicious }: BenfordChartProps) {
  const data = digits.map(d => ({
    digit: String(d.digit),
    esperado: parseFloat((d.expected * 100).toFixed(1)),
    observado: parseFloat((d.observed * 100).toFixed(1)),
  }))

  const config: ChartConfig = {
    esperado: { label: 'Esperado', color: 'var(--chart-3)' },
    observado: { label: 'Observado', color: suspicious ? 'var(--chart-5)' : 'var(--chart-1)' },
  }

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="digit" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="esperado" fill="var(--color-esperado)" radius={[3, 3, 0, 0]} maxBarSize={30} />
        <Bar dataKey="observado" fill="var(--color-observado)" radius={[3, 3, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ChartContainer>
  )
}
