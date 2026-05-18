'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { BenfordDigit } from '@/lib/anomalies'

interface BenfordChartProps {
  digits: BenfordDigit[]
  suspicious: boolean
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-2 font-semibold text-gray-700">Dígito {label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mt-1">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500 w-20">{p.name}:</span>
          <span className="font-mono font-medium text-gray-900">
            {(p.value as number).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function BenfordChart({ digits, suspicious }: BenfordChartProps) {
  const data = digits.map(d => ({
    digit:    String(d.digit),
    Esperado: parseFloat((d.expected * 100).toFixed(1)),
    Observado: parseFloat((d.observed * 100).toFixed(1)),
  }))

  const observedColor = suspicious ? '#ef4444' : '#2563eb'

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="digit"
          tick={{ fontSize: 12, fill: '#6b7280' }}
          axisLine={false}
          tickLine={false}
          label={{ value: 'Primer dígito', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#9ca3af' }}
        />
        <YAxis
          tickFormatter={v => `${v}%`}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v) => <span className="text-gray-600">{v}</span>}
        />
        <Bar dataKey="Esperado"  fill="#d1d5db" radius={[3,3,0,0]} maxBarSize={32} />
        <Bar dataKey="Observado" fill={observedColor} radius={[3,3,0,0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )
}
