'use server'

import { postBackendJson } from '@/lib/python-backend'
import type {
  AnomaliesData,
  ComparativoData,
  DashboardData,
  MayorData,
  MayorPageData,
  NotasData,
} from './types'

export async function getDashboardData(
  ruc: string,
  periodos: string[],
): Promise<DashboardData | null> {
  return postBackendJson<DashboardData | null>('/dashboard', { ruc, periodos })
}

export async function getMayorPageData(
  ruc: string,
  periodos: string[],
  codCuenta: string | null,
): Promise<MayorPageData> {
  return postBackendJson<MayorPageData>('/mayor', { ruc, periodos, codCuenta })
}

export async function getMayorCompletoData(ruc: string, periodos: string[]): Promise<MayorData[]> {
  return postBackendJson<MayorData[]>('/mayor/completo', { ruc, periodos })
}

export async function getAnomaliesData(
  ruc: string,
  periodos: string[],
): Promise<AnomaliesData | null> {
  return postBackendJson<AnomaliesData | null>('/anomalies', { ruc, periodos })
}

export async function getComparativoData(
  ruc: string,
  periodosA: string[],
  periodosB: string[],
): Promise<ComparativoData | null> {
  return postBackendJson<ComparativoData | null>('/comparativo', { ruc, periodosA, periodosB })
}

export async function getNotasData(ruc: string, periodos: string[]): Promise<NotasData | null> {
  return postBackendJson<NotasData | null>('/notas', { ruc, periodos })
}
