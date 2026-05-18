'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { MonthBar } from '@/app/actions'
import { fmtCompacto, fmtMoneda } from '@/lib/format'

interface PLBarChartProps {
  data: MonthBar[]
}

const COLORS = {
  ingresos:      '#2563eb', // azul
  costoVentas:   '#f87171', // rojo suave
  utilidadBruta: '#16a34a', // verde
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-2 font-semibold text-gray-700">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500 w-24">{p.name}:</span>
          <span className="font-mono font-medium text-gray-900">
            {fmtMoneda(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function PLBarChart({ data }: PLBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtCompacto}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v) => <span className="text-gray-600">{v}</span>}
        />
        <Bar dataKey="ingresos"      name="Ingresos"       fill={COLORS.ingresos}      radius={[3,3,0,0]} maxBarSize={40} />
        <Bar dataKey="costoVentas"   name="Costo de ventas" fill={COLORS.costoVentas}  radius={[3,3,0,0]} maxBarSize={40} />
        <Bar dataKey="utilidadBruta" name="Utilidad bruta"  fill={COLORS.utilidadBruta} radius={[3,3,0,0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}
