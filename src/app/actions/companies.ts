'use server'

import { revalidatePath } from 'next/cache'
import { getBackendJson, postBackendJson } from '@/lib/python-backend'
import type { CompanyCloneResult, CompanyConfig, CompanyOverview } from './types'

export async function getAvailableRucs(): Promise<string[]> {
  return getBackendJson<string[]>('/rucs')
}

export async function getAllPeriods(rucs: string[]): Promise<Record<string, string[]>> {
  return postBackendJson<Record<string, string[]>>('/periods', { rucs })
}

export async function saveCompanyConfig(config: CompanyConfig): Promise<{ ok: boolean; error?: string }> {
  return postBackendJson<{ ok: boolean; error?: string }>('/company-config', { config })
}

export async function getCompanyConfig(ruc: string): Promise<CompanyConfig | null> {
  return getBackendJson<CompanyConfig | null>(`/company-config/${encodeURIComponent(ruc)}`)
}

// Enriched company list for the sidebar (friendly name + framework + data coverage).
export async function getCompaniesOverview(): Promise<CompanyOverview[]> {
  const rucs = await getAvailableRucs()
  if (rucs.length === 0) return []
  const periodsByRuc = await getAllPeriods(rucs)
  const overviews: CompanyOverview[] = []
  for (const ruc of rucs) {
    const cfg = await getCompanyConfig(ruc)
    const periods = periodsByRuc[ruc] ?? []
    overviews.push({
      ruc,
      razonSocial: cfg?.razonSocial?.trim() || ruc,
      sector: cfg?.sector ?? '',
      niifFramework: cfg?.niifFramework ?? '',
      isDemo: Boolean(cfg?.isDemo),
      periodCount: periods.length,
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods.length ? periods[periods.length - 1] : null,
    })
  }
  return overviews
}

export async function cloneCompany(input: {
  sourceRuc: string
  destRuc: string
  config?: Partial<CompanyConfig>
}): Promise<CompanyCloneResult> {
  return postBackendJson<CompanyCloneResult>('/companies/clone', input)
}

interface DemoPreset {
  destRuc: string
  razonSocial: string
  sector: string
  niifFramework: string
  clasificacion: string
}

const DEMO_PRESETS: DemoPreset[] = [
  { destRuc: '0992222222001', razonSocial: 'Comercial Andina S.A.', sector: 'comercial', niifFramework: 'niif_pymes', clasificacion: 'mediana' },
  { destRuc: '0993333333001', razonSocial: 'Servicios Quito Cía. Ltda.', sector: 'servicios', niifFramework: 'niif_pymes', clasificacion: 'pequena' },
]

function buildCompanyConfig(
  overrides: Partial<CompanyConfig> & { ruc: string; razonSocial: string },
): CompanyConfig {
  const base: CompanyConfig = {
    razonSocial: overrides.razonSocial,
    ruc: overrides.ruc,
    tipoContribuyente: 'sociedad',
    clasificacion: 'mediana',
    niifFramework: 'niif_pymes',
    cotizaEnBolsa: false,
    esEntidadFinanciera: false,
    regimenTributario: 'general',
    agenteRetencion: false,
    contribuyenteEspecial: false,
    sector: 'comercial',
    tieneInventarios: true,
    tieneActivosFijos: true,
    tieneArrendamientos: false,
    mesInicioEjercicio: 1,
    fuenteDatos: 'excel',
    createdAt: new Date().toISOString(),
  }
  return { ...base, ...overrides }
}

// One-click demo: clone the existing dataset into two preset companies and give
// the original a friendly name. Idempotent — skips presets that already exist.
export async function seedDemoCompanies(): Promise<{ ok: boolean; created: string[]; error?: string }> {
  const rucs = await getAvailableRucs()
  const periodsByRuc = await getAllPeriods(rucs)
  const source = rucs.find(ruc => (periodsByRuc[ruc] ?? []).length > 0)
  if (!source) return { ok: false, created: [], error: 'No hay una empresa con datos para clonar' }

  // Name the existing bare-RUC company so the switcher reads nicely.
  const existing = await getCompanyConfig(source)
  if (!existing?.razonSocial) {
    await saveCompanyConfig(
      buildCompanyConfig({
        ruc: source,
        razonSocial: 'Distribuidora del Guayas S.A.',
        sector: 'comercial',
        niifFramework: 'niif_pymes',
      }),
    )
  }

  const created: string[] = []
  for (const preset of DEMO_PRESETS) {
    if (rucs.includes(preset.destRuc)) continue
    const result = await cloneCompany({
      sourceRuc: source,
      destRuc: preset.destRuc,
      config: buildCompanyConfig({
        ruc: preset.destRuc,
        razonSocial: preset.razonSocial,
        sector: preset.sector,
        niifFramework: preset.niifFramework,
        clasificacion: preset.clasificacion,
        isDemo: true,
      }),
    })
    if (result.ok && result.ruc) created.push(result.ruc)
  }

  revalidatePath('/', 'layout')
  return { ok: true, created }
}
