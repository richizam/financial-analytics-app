'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  Building2,
  CalendarRange,
  Check,
  ChevronsUpDown,
  FlaskConical,
  type LucideIcon,
  LogOut,
  Plus,
  Upload,
} from 'lucide-react'
import { fmtPeriodo } from '@/lib/format'
import { buildPeriodHref } from '@/lib/period-selection'
import { seedDemoCompanies, type CompanyOverview } from '@/app/actions'
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
  onNavigate,
}: {
  companies: CompanyOverview[]
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [isSeeding, startSeed] = useTransition()
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const activeRuc = searchParams.get('ruc') ?? companies[0]?.ruc ?? ''
  const periodos = (searchParams.get('periodos') ?? '').split(',').filter(Boolean)
  const active = companies.find(company => company.ruc === activeRuc) ?? companies[0]

  const contextLabel = useMemo(() => {
    const selected = periodRangeLabel(periodos)
    if (selected) return selected
    if (active?.firstPeriod && active?.lastPeriod) {
      return periodRangeLabel([active.firstPeriod, active.lastPeriod])
    }
    return 'Sin periodo seleccionado'
  }, [periodos, active])

  function selectCompany(ruc: string) {
    onNavigate?.()
    router.push(buildPeriodHref('/', ruc, []))
  }

  function goTo(href: string) {
    onNavigate?.()
    router.push(href)
  }

  function handleSeed() {
    setSeedMsg(null)
    startSeed(async () => {
      try {
        const result = await seedDemoCompanies()
        if (!result.ok) {
          setSeedMsg(result.error ?? 'No se pudieron cargar los datos demo')
          return
        }
        setSeedMsg(
          result.created.length > 0
            ? `Listo · ${result.created.length} empresa(s) demo añadida(s)`
            : 'Las empresas demo ya existían',
        )
        router.refresh()
      } catch (error) {
        setSeedMsg(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const userName = session?.user?.name ?? session?.user?.email ?? 'Usuario'
  const userEmail = session?.user?.email ?? ''

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
            <DropdownMenuItem onClick={handleSeed} disabled={isSeeding}>
              <FlaskConical className="h-4 w-4" /> {isSeeding ? 'Cargando…' : 'Cargar empresas demo'}
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

      {/* ── Data actions ── */}
      <div className="px-3 py-3">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Datos</p>
        <nav className="space-y-1">
          <SidebarAction icon={Plus} label="Nueva empresa" onClick={() => goTo('/setup')} />
          <SidebarAction icon={Upload} label="Importar CSV" onClick={() => goTo('/upload')} />
          <SidebarAction
            icon={FlaskConical}
            label={isSeeding ? 'Cargando demo…' : 'Cargar empresas demo'}
            onClick={handleSeed}
            disabled={isSeeding}
          />
        </nav>
        {seedMsg && <p className="mt-2 px-1 text-xs text-gray-500">{seedMsg}</p>}
      </div>

      <div className="mt-auto" />
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
            <DropdownMenuItem variant="destructive" onClick={() => signOut({ callbackUrl: '/auth/signin' })}>
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function SidebarAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-700 transition hover:bg-white hover:text-blue-700 disabled:opacity-60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <Icon className="h-4 w-4" />
      </span>
      {label}
    </button>
  )
}
