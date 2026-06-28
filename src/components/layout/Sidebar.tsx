'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  BookOpen,
  Building2,
  CalendarRange,
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  GitCompare,
  LayoutDashboard,
  Loader2,
  type LucideIcon,
  LogOut,
  Plus,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { fmtPeriodo } from '@/lib/format'
import { buildPeriodHref, parsePeriodParam } from '@/lib/period-selection'
import { getDashboardData, type CompanyOverview } from '@/app/actions'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useFinancialScope } from './financial-scope'

const SECTOR_LABELS: Record<string, string> = {
  comercial: 'Comercial',
  servicios: 'Servicios',
  industrial: 'Industrial',
  construccion: 'Construcción',
  agricola: 'Agrícola',
  salud: 'Salud',
  educacion: 'Educación',
  tecnologia: 'Tecnología',
  transporte: 'Transporte',
  otro: 'Otro',
}

const NIIF_LABELS: Record<string, string> = {
  niif_completas: 'NIIF Completas',
  niif_pymes: 'NIIF Pymes',
  rimpe: 'RIMPE',
}

// Primary navigation — the analysis views, ordered by typical workflow.
const NAV_ITEMS: { label: string; href: string; icon: LucideIcon; isActive: (path: string) => boolean }[] = [
  { label: 'Resumen', href: '/', icon: LayoutDashboard, isActive: path => path === '/' },
  { label: 'Comparativo', href: '/comparativo', icon: GitCompare, isActive: path => path.startsWith('/comparativo') },
  { label: 'Anomalías', href: '/anomalies', icon: ShieldAlert, isActive: path => path.startsWith('/anomalies') },
  { label: 'Libro Mayor', href: '/mayor', icon: BookOpen, isActive: path => path.startsWith('/mayor') },
  { label: 'Notas NIIF', href: '/notas', icon: FileText, isActive: path => path.startsWith('/notas') },
]

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2)
  const result = parts.map(part => part[0]?.toUpperCase() ?? '').join('')
  return result || 'U'
}

function periodRangeLabel(periods: string[]): string {
  const clean = periods.filter(period => /^\d{6}$/.test(period)).sort()
  if (clean.length === 0) return ''
  if (clean.length === 1) return fmtPeriodo(clean[0])
  return `${fmtPeriodo(clean[0])} – ${fmtPeriodo(clean[clean.length - 1])}`
}

export function Sidebar({
  companies,
  user,
  onNavigate,
}: {
  companies: CompanyOverview[]
  user: { name: string | null; email: string | null } | null
  onNavigate?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const scope = useFinancialScope()
  const [isExporting, setIsExporting] = useState(false)

  // Live scope wins (the dashboard/feature views publish their selection); the
  // URL is the fallback so links stay correct before any view has mounted.
  const activeRuc = scope?.ruc || searchParams.get('ruc') || companies[0]?.ruc || ''
  const periodos = scope?.periodos.length
    ? scope.periodos
    : parsePeriodParam(searchParams.get('periodos') ?? undefined)
  const active = companies.find(company => company.ruc === activeRuc) ?? companies[0]

  const contextLabel = useMemo(() => {
    const selected = periodRangeLabel(periodos)
    if (selected) return selected
    if (active?.firstPeriod && active?.lastPeriod) {
      return periodRangeLabel([active.firstPeriod, active.lastPeriod])
    }
    return 'Sin periodo seleccionado'
  }, [periodos, active])

  const canExport = Boolean(activeRuc) && periodos.length > 0

  function selectCompany(ruc: string) {
    onNavigate?.()
    router.push(buildPeriodHref('/', ruc, []))
  }

  function goTo(href: string) {
    onNavigate?.()
    router.push(href)
  }

  async function handleExport() {
    if (!canExport || isExporting) return
    setIsExporting(true)
    try {
      // Reuse the dashboard's loaded statements when available; otherwise fetch.
      const data =
        scope?.data && scope.ruc === activeRuc
          ? scope.data
          : await getDashboardData(activeRuc, periodos)
      if (data) {
        const { exportarExcel } = await import('@/lib/excel-export')
        exportarExcel(activeRuc, periodos, data.eri, data.esf, data.metricas)
      }
    } catch (error) {
      console.error('No se pudo exportar el resumen financiero', error)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    onNavigate?.()
    router.push('/auth/signin')
    router.refresh()
  }

  const userName = user?.name ?? user?.email ?? 'Usuario'
  const userEmail = user?.email ?? ''

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      {/* ── Brand ── */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-600/30">
          FA
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">Financial Analytics</p>
          <p className="truncate text-xs text-gray-500">NIIF · Ecuador</p>
        </div>
      </div>

      <Separator />

      {/* ── Company switcher + active context ── */}
      <div className="space-y-2.5 px-3 py-3">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Empresa</p>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2.5 text-left shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">
                  {active?.razonSocial ?? 'Sin empresa'}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {active ? `RUC ${active.ruc}` : 'Añade una empresa para empezar'}
                </span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Empresas ({companies.length})</DropdownMenuLabel>
            {companies.map(company => (
              <DropdownMenuItem key={company.ruc} className="gap-2" onClick={() => selectCompany(company.ruc)}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{company.razonSocial}</span>
                  <span className="block truncate text-xs text-muted-foreground">{company.ruc}</span>
                </span>
                {company.ruc === activeRuc && <Check className="h-4 w-4 text-blue-600" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => goTo('/setup')}>
              <Plus className="h-4 w-4" /> Añadir empresa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {active && (
          <div className="space-y-2 rounded-xl bg-white/60 p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {active.niifFramework && (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 font-medium text-blue-700">
                  {NIIF_LABELS[active.niifFramework] ?? active.niifFramework}
                </Badge>
              )}
              {active.sector && (
                <Badge variant="outline" className="text-gray-600">
                  {SECTOR_LABELS[active.sector] ?? active.sector}
                </Badge>
              )}
              {active.isDemo && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">
                  Demo
                </Badge>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <CalendarRange className="h-3.5 w-3.5 shrink-0" />
              {contextLabel}
            </p>
            <p className="text-xs text-gray-400">
              {active.periodCount} periodo{active.periodCount === 1 ? '' : 's'} cargado
              {active.periodCount === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </div>

      <Separator />

      {/* ── Primary navigation ── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Análisis</p>
        {NAV_ITEMS.map(item => {
          const activeItem = item.isActive(pathname)
          return (
            <Link
              key={item.href}
              href={buildPeriodHref(item.href, activeRuc, periodos)}
              // Pages are force-dynamic, so prefetch would trigger a full
              // server render (rucs + periods + per-company config + data) of
              // every route in the background. Disable it — navigate on click.
              prefetch={false}
              onClick={() => onNavigate?.()}
              aria-current={activeItem ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                activeItem
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-white hover:text-blue-700',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  activeItem ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30' : 'bg-blue-50 text-blue-600',
                )}
              >
                <item.icon className="h-4 w-4" />
              </span>
              {item.label}
            </Link>
          )
        })}

        <Separator className="my-2.5" />

        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Acciones</p>
        <SidebarButton
          icon={isExporting ? Loader2 : Download}
          iconClassName={isExporting ? 'animate-spin' : undefined}
          label={isExporting ? 'Exportando…' : 'Exportar a Excel'}
          onClick={handleExport}
          disabled={!canExport || isExporting}
        />
        <SidebarButton icon={Upload} label="Importar CSV" onClick={() => goTo('/upload')} />
        <SidebarButton icon={Plus} label="Nueva empresa" onClick={() => goTo('/setup')} />
      </nav>

      <Separator />

      {/* ── User footer ── */}
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition hover:bg-white"
            >
              <Avatar>
                <AvatarFallback className="bg-blue-600 text-xs font-semibold text-white">
                  {initials(userName)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{userName}</span>
                {userEmail && <span className="block truncate text-xs text-gray-500">{userEmail}</span>}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate">{userEmail || userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function SidebarButton({
  icon: Icon,
  iconClassName,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  iconClassName?: string
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-white hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-700"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <Icon className={cn('h-4 w-4', iconClassName)} />
      </span>
      {label}
    </button>
  )
}
