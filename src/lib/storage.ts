/**
 * storage.ts — Operaciones de Supabase Storage usando REST API directamente.
 * No depende del paquete @supabase/supabase-js para evitar problemas de compatibilidad.
 *
 * Estructura del bucket "empresas":
 *   [RUC de 13 dígitos]/
 *     YYYYMM.csv
 *     saldos_iniciales_YYYY.csv
 */

import { getSupabaseConfig, EMPRESAS_BUCKET } from './supabase'

function storageUrl(path: string): string {
  const { url } = getSupabaseConfig()
  return `${url}/storage/v1/object/${path}`
}

function storageHeaders(): Record<string, string> {
  const { key } = getSupabaseConfig()
  return {
    'Authorization': `Bearer ${key}`,
    'apikey': key,
  }
}

/** Lista archivos/carpetas dentro de una ruta del bucket. */
async function listItems(prefix: string): Promise<{ name: string; id: string | null }[]> {
  const { url, key } = getSupabaseConfig()
  const endpoint = `${url}/storage/v1/object/list/${EMPRESAS_BUCKET}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix, delimiter: '/', limit: 1000 }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Storage list error ${res.status}: ${body}`)
  }

  const data = await res.json() as { name: string; id: string | null }[]
  return data
}

/** Lista los RUC disponibles (subcarpetas de 13 dígitos en el bucket). */
export async function listRucsFromStorage(): Promise<string[]> {
  const items = await listItems('')
  return items
    .filter(i => i.id === null && /^\d{13}\/?$/.test(i.name)) // carpetas (id === null)
    .map(i => i.name.replace(/\/$/, ''))
    .sort()
}

/** Lista períodos YYYYMM disponibles para un RUC. */
export async function listPeriodsFromStorage(ruc: string): Promise<string[]> {
  const items = await listItems(`${ruc}/`)
  return items
    .filter(i => i.id !== null && /^\d{6}\.csv$/i.test(i.name))
    .map(i => i.name.replace(/\.csv$/i, ''))
    .sort()
}

/** Descarga el contenido de un archivo CSV como string. */
export async function readCsvFromStorage(ruc: string, filename: string): Promise<string | null> {
  const url = storageUrl(`${EMPRESAS_BUCKET}/${ruc}/${filename}`)
  const res = await fetch(url, { headers: storageHeaders() })
  if (res.status === 404) return null
  if (!res.ok) {
    console.error(`[storage] readCsv ${ruc}/${filename}: HTTP ${res.status}`)
    return null
  }
  return res.text()
}

/** Sube un archivo CSV al bucket (upsert). */
export async function uploadCsvToStorage(
  ruc: string,
  filename: string,
  content: ArrayBuffer | string,
): Promise<{ ok: boolean; error?: string }> {
  const { key } = getSupabaseConfig()
  const url = storageUrl(`${EMPRESAS_BUCKET}/${ruc}/${filename}`)

  const body = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : new Uint8Array(content)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'text/csv',
      'x-upsert': 'true',
    },
    body,
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `HTTP ${res.status}: ${body}` }
  }
  return { ok: true }
}
