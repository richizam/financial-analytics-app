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
    <section className="min-w-0 rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-foreground">{block.title}</span>
        {periodLabel && <Badge variant="secondary">{periodLabel}</Badge>}
        {block.ruc && <Badge variant="outline">RUC {block.ruc}</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {block.metrics.map(metric => (
          <Card key={metric.key} className="min-w-0 shadow-none">
            <CardContent className="px-3 py-2.5">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-base font-semibold tabular-nums [overflow-wrap:anywhere]',
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
    <section className="min-w-0 overflow-hidden rounded-xl border border-border">
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
    <section className="min-w-0 overflow-hidden rounded-xl border border-border">
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
    <section className="min-w-0 rounded-xl border border-border bg-muted/30 p-3">
      <p className="mb-2 text-sm font-semibold">{block.title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {block.items.map(item => (
          <div key={item.label} className="min-w-0 rounded-lg bg-card px-2.5 py-1.5">
            <p className="truncate text-[11px] text-muted-foreground">{item.label}</p>
            <p className="text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMetric(item.value, item.format)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Caveat({ message, level }: { message: string; level: 'warning' | 'info' }) {
  return (
    <Alert variant={level} className="min-w-0">
      {level === 'warning' ? <AlertTriangle /> : <Info />}
      <AlertDescription className="[overflow-wrap:anywhere]">{message}</AlertDescription>
    </Alert>
  )
}

function Citations({ items }: { items: Citation[] }) {
  const sources = Array.from(new Set(items.map(item => item.source).filter(Boolean)))
  if (sources.length === 0) return null
  return (
    <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
      Fuente: {sources.join(', ')} · calculado por el backend
    </p>
  )
}

// --- Lightweight markdown for the assistant's prose explanation --------------
// Handles paragraphs, bullet/ordered lists, fenced code blocks and GitHub-style
// tables, plus inline **bold** and `code`. Everything wraps or scrolls inside
// the message so it can never overflow the chat bubble.

type ProseBlock =
  | { kind: 'code'; content: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'list'; items: { marker: string; text: string }[] }
  | { kind: 'para'; text: string }

const FENCE = /^\s*```/
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function listMarker(line: string): string {
  const ordered = /^\s*(\d+)[.)]\s+/.exec(line)
  return ordered ? `${ordered[1]}.` : '•'
}

function parseProse(text: string): ProseBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ProseBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (FENCE.test(line)) {
      const buffer: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        buffer.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push({ kind: 'code', content: buffer.join('\n') })
      continue
    }

    const isTableHeader =
      line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])
    if (isTableHeader) {
      const header = splitTableRow(line)
      i += 2 // header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    if (LIST_ITEM.test(line)) {
      const items: { marker: string; text: string }[] = []
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        items.push({ marker: listMarker(lines[i]), text: lines[i].replace(LIST_ITEM, '') })
        i++
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]))
    ) {
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ kind: 'para', text: para.join(' ') })
  }

  return blocks
}

function ProseText({ text }: { text: string }) {
  const blocks = parseProse(text)
  if (blocks.length === 0) return null
  return (
    <div className="min-w-0 max-w-full space-y-2 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        if (block.kind === 'code') {
          return (
            <pre key={index} className="max-w-full overflow-x-auto rounded-md bg-muted px-2.5 py-2 text-xs">
              <code>{block.content}</code>
            </pre>
          )
        }
        if (block.kind === 'table') {
          return (
            <div key={index} className="max-w-full overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {block.header.map((cell, ci) => (
                      <th key={ci} className="px-2 py-1.5 text-left font-medium text-muted-foreground [overflow-wrap:anywhere]">
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border/60 last:border-0">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1.5 align-top tabular-nums [overflow-wrap:anywhere]">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'list') {
          return (
            <ul key={index} className="space-y-1">
              {block.items.map((item, ii) => (
                <li key={ii} className="flex gap-1.5">
                  <span className="shrink-0 select-none text-muted-foreground tabular-nums">{item.marker}</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{renderInline(item.text)}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index} className="[overflow-wrap:anywhere]">
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

/** Convert **bold** and `code` spans; leave the rest as plain text. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    if (bold) return <strong key={index} className="font-semibold">{bold[1]}</strong>
    const code = /^`([^`]+)`$/.exec(part)
    if (code) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.85em] [overflow-wrap:anywhere]">
          {code[1]}
        </code>
      )
    }
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
    <div className="flex min-w-0 max-w-full flex-col gap-2.5">
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
