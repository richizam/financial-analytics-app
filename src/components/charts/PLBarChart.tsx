'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
  costoVentas: { label: 'Costo de ventas', color: 'var(--chart-5)' },
  utilidadBruta: { label: 'Utilidad bruta', color: 'var(--chart-2)' },
}

export default function PLBarChart({ data }: { data: MonthBar[] }) {
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
        <YAxis tickFormatter={fmtCompacto} tickLine={false} axisLine={false} width={56} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmtMoneda(Number(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="ingresos" fill="var(--color-ingresos)" radius={[4, 4, 0, 0]} maxBarSize={38} />
        <Bar dataKey="costoVentas" fill="var(--color-costoVentas)" radius={[4, 4, 0, 0]} maxBarSize={38} />
        <Bar dataKey="utilidadBruta" fill="var(--color-utilidadBruta)" radius={[4, 4, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ChartContainer>
  )
}
