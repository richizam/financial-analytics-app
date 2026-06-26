'use client'

// Dev-only visual gallery for the assistant response renderer (the project has
// no Storybook/test runner). Exercises every block type plus a mobile width so
// the layouts can be eyeballed. Not linked from the app navigation.
import AssistantResponseRenderer from '@/components/ai/AssistantResponseRenderer'
import type { AiResponseBlock } from '@/app/actions'

const KEY_METRICS: AiResponseBlock = {
  type: 'key_metrics',
  title: 'Resumen financiero',
  ruc: '0990123456001',
  periods: ['202501', '202512'],
  metrics: [
    { key: 'revenue', label: 'Ingresos', value: 994418, format: 'currency' },
    { key: 'net_profit', label: 'Utilidad neta', value: 229026, format: 'currency' },
    { key: 'gross_margin', label: 'Margen bruto', value: 0.4471, format: 'percent' },
    { key: 'ebitda', label: 'EBITDA', value: 374492, format: 'currency' },
  ],
}

const MONTHLY_TABLE: AiResponseBlock = {
  type: 'table',
  title: 'Detalle por periodo',
  columns: [
    { key: 'label', label: 'Periodo' },
    { key: 'revenue', label: 'Ingresos', format: 'currency', align: 'right' },
    { key: 'net_profit', label: 'Utilidad neta', format: 'currency', align: 'right' },
  ],
  rows: [
    { label: 'Ene 2025', revenue: 70120, net_profit: 15030 },
    { label: 'Abr 2025', revenue: 98440, net_profit: 24110 },
    { label: 'Dic 2025', revenue: 154933, net_profit: 69151 },
  ],
}

const COMPARISON: AiResponseBlock = {
  type: 'comparison',
  title: 'Comparativo',
  periodsA: ['202501', '202503'],
  periodsB: ['202601', '202603'],
  rows: [
    { key: 'revenue', label: 'Ingresos', a: 220000, b: 265000, delta: 45000, deltaPct: 0.2045, format: 'currency' },
    { key: 'net_profit', label: 'Utilidad neta', a: 60000, b: 51000, delta: -9000, deltaPct: -0.15, format: 'currency' },
    { key: 'gross_margin', label: 'Margen bruto', a: 0.44, b: 0.46, delta: 0.02, deltaPct: null, format: 'percent' },
  ],
}

const CAVEAT: AiResponseBlock = {
  type: 'caveat',
  level: 'warning',
  message: 'No hay periodos disponibles que se superpongan con el rango solicitado (2024).',
}

function Case({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">{children}</div>
    </div>
  )
}

export default function AssistantPreviewPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-lg font-semibold">Assistant response renderer — preview</h1>

      <Case title="1 · Numeric answer with KPI cards">
        <AssistantResponseRenderer
          text="La rentabilidad de 2025 fue sólida. Los ingresos fueron más fuertes en abril, agosto y diciembre, y el margen neto se mantuvo saludable cerca del 23%."
          blocks={[KEY_METRICS, MONTHLY_TABLE]}
          citations={[{ source: 'getFinancialSummary', result_id: 'summary_abc123' }]}
        />
      </Case>

      <Case title="2 · Comparison answer with deltas">
        <AssistantResponseRenderer
          text="Los ingresos crecieron 20.5% interanual, pero la utilidad neta cayó por mayores costos."
          blocks={[COMPARISON]}
          citations={[{ source: 'comparePeriods', result_id: 'compare_def456' }]}
        />
      </Case>

      <Case title="3 · Missing data / caveat">
        <AssistantResponseRenderer
          text="No pude calcular el resumen solicitado."
          blocks={[CAVEAT]}
        />
      </Case>

      <Case title="4 · Plain text-only answer">
        <AssistantResponseRenderer
          text={'El **margen bruto** mide cuánto queda de cada dólar de ingresos tras los costos directos.\n\n- Útil para comparar eficiencia entre periodos.\n- No incluye gastos operativos.'}
        />
      </Case>

      <Case title="5 · Mobile width (≈360px)">
        <div className="mx-auto w-[360px] rounded-xl border border-dashed border-gray-300 p-2">
          <AssistantResponseRenderer
            text="Resumen del periodo en pantalla angosta."
            blocks={[KEY_METRICS]}
            citations={[{ source: 'getFinancialSummary', result_id: 'summary_abc123' }]}
          />
        </div>
      </Case>
    </div>
  )
}
