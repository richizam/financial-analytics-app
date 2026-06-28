'use client'

import { Fragment } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import type {
  AiComparisonBlock,
  AiInsightBlock,
  AiKeyMetricsBlock,
  AiResponseBlock,
  AiTableBlock,
} from '@/app/actions'
import { deltaTone, formatDelta, formatMetric, formatPeriodRange, type MetricFormat } from '@/lib/ai-format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Citation {
  source: string
  result_id: string
}

interface Props {
  text: string
  blocks?: AiResponseBlock[]
  citations?: Citation[]
}

const NUMERIC_FORMATS: MetricFormat[] = ['currency', 'number', 'integer']

function isNegative(value: number | null | undefined, format: MetricFormat): boolean {
  return typeof value === 'number' && value < 0 && NUMERIC_FORMATS.includes(format)
}

/** Hero KPI cards + period/company badges. */
function KeyMetrics({ block }: { block: AiKeyMetricsBlock }) {
  const periodLabel = formatPeriodRange(block.periods)
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-foreground">{block.title}</span>
        {periodLabel && <Badge variant="secondary">{periodLabel}</Badge>}
        {block.ruc && <Badge variant="outline">RUC {block.ruc}</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {block.metrics.map(metric => (
          <Card key={metric.key} className="shadow-none">
            <CardContent className="px-3 py-2.5">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-base font-semibold tabular-nums',
                  isNegative(metric.value, metric.format) ? 'text-red-600' : 'text-foreground',
                )}
              >
                {formatMetric(metric.value, metric.format)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function DeltaCell({
  value,
  deltaPct,
  format,
  metricKey,
}: {
  value: number | null
  deltaPct: number | null
  format: MetricFormat
  metricKey?: string | null
}) {
  const tone = deltaTone(value, metricKey)
  const Icon = tone === 'positive' ? ArrowUpRight : tone === 'negative' ? ArrowDownRight : Minus
  const color = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center justify-end gap-1 tabular-nums', color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{formatDelta(value, format)}</span>
      {deltaPct !== null && deltaPct !== undefined && (
        <span className="text-[11px] opacity-80">({formatDelta(deltaPct, 'percent')})</span>
      )}
    </span>
  )
}

/** Period-over-period comparison with signed deltas and trend arrows. */
function Comparison({ block }: { block: AiComparisonBlock }) {
  const labelA = formatPeriodRange(block.periodsA) || 'Periodo A'
  const labelB = formatPeriodRange(block.periodsB) || 'Periodo B'
  return (
    <section className="rounded-xl border border-border">
      <div className="px-3 py-2 text-sm font-semibold">{block.title}</div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Métrica</TableHead>
            <TableHead className="text-right">{labelA}</TableHead>
            <TableHead className="text-right">{labelB}</TableHead>
            <TableHead className="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {block.rows.map(row => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMetric(row.a, row.format)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMetric(row.b, row.format)}</TableCell>
              <TableCell className="text-right">
                <DeltaCell value={row.delta} deltaPct={row.deltaPct} format={row.format} metricKey={row.key} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function DataTable({ block }: { block: AiTableBlock }) {
  return (
    <section className="rounded-xl border border-border">
      <div className="px-3 py-2 text-sm font-semibold">{block.title}</div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            {block.columns.map(col => (
              <TableHead key={col.key} className={cn(col.align === 'right' && 'text-right')}>
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {block.rows.map((row, index) => (
            <TableRow key={index}>
              {block.columns.map(col => {
                const raw = row[col.key]
                const isNum = typeof raw === 'number'
                const rendered = col.format && isNum ? formatMetric(raw as number, col.format) : raw ?? '—'
                return (
                  <TableCell
                    key={col.key}
                    className={cn(
                      col.align === 'right' && 'text-right tabular-nums',
                      isNegative(isNum ? (raw as number) : null, col.format ?? 'number') && 'text-red-600',
                    )}
                  >
                    {rendered}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function Insight({ block }: { block: AiInsightBlock }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="mb-2 text-sm font-semibold">{block.title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {block.items.map(item => (
          <div key={item.label} className="rounded-lg bg-card px-2.5 py-1.5">
            <p className="truncate text-[11px] text-muted-foreground">{item.label}</p>
            <p className="text-sm font-semibold tabular-nums">{formatMetric(item.value, item.format)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Caveat({ message, level }: { message: string; level: 'warning' | 'info' }) {
  return (
    <Alert variant={level}>
      {level === 'warning' ? <AlertTriangle /> : <Info />}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function Citations({ items }: { items: Citation[] }) {
  const sources = Array.from(new Set(items.map(item => item.source).filter(Boolean)))
  if (sources.length === 0) return null
  return (
    <p className="text-[11px] text-muted-foreground">
      Fuente: {sources.join(', ')} · calculado por el backend
    </p>
  )
}

/** Minimal markdown for the explanation: **bold** + bullet lines + paragraphs.
 *  Numbers belong in the structured blocks above, not in raw markdown. */
function ProseText({ text }: { text: string }) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-foreground">
      {lines.map((line, index) => {
        const bullet = /^[-*•]\s+/.test(line)
        const content = bullet ? line.replace(/^[-*•]\s+/, '') : line
        return (
          <p key={index} className={cn('break-words', bullet && 'flex gap-1.5 pl-1')}>
            {bullet && <span className="select-none text-muted-foreground">•</span>}
            <span>{renderInline(content)}</span>
          </p>
        )
      })}
    </div>
  )
}

/** Convert **bold** spans to <strong>; leaves the rest as plain text. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part)
    if (match) return <strong key={index} className="font-semibold">{match[1]}</strong>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function BlockView({ block }: { block: AiResponseBlock }) {
  switch (block.type) {
    case 'key_metrics':
      return <KeyMetrics block={block} />
    case 'comparison':
      return <Comparison block={block} />
    case 'table':
      return <DataTable block={block} />
    case 'insight':
      return <Insight block={block} />
    case 'caveat':
      return <Caveat message={block.message} level={block.level} />
    default:
      return null
  }
}

export default function AssistantResponseRenderer({ text, blocks, citations }: Props) {
  const list = blocks ?? []
  const primary = list.filter(b => b.type === 'key_metrics' || b.type === 'comparison' || b.type === 'insight')
  const tables = list.filter((b): b is AiTableBlock => b.type === 'table')
  const caveats = list.filter(b => b.type === 'caveat')

  // No structured blocks → plain chat answer (generic responses stay simple).
  if (list.length === 0) {
    return <ProseText text={text} />
  }

  return (
    <div className="flex flex-col gap-2.5">
      {primary.map((block, index) => (
        <BlockView key={`p${index}`} block={block} />
      ))}
      {text && <ProseText text={text} />}
      {tables.map((block, index) => (
        <BlockView key={`t${index}`} block={block} />
      ))}
      {caveats.map((block, index) => (
        <BlockView key={`c${index}`} block={block} />
      ))}
      {citations && citations.length > 0 && <Citations items={citations} />}
    </div>
  )
}
