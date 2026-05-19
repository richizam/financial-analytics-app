/**
 * storage.ts — Operaciones de Supabase Storage para archivos CSV de empresas.
 *
 * Estructura del bucket "empresas":
 *   [RUC de 13 dígitos]/
 *     YYYYMM.csv
 *     saldos_iniciales_YYYY.csv
 */

import { createServerSupabase, EMPRESAS_BUCKET } from './supabase'

/** Lista los RUC disponibles (carpetas en el bucket). */
export async function listRucsFromStorage(): Promise<string[]> {
  const sb = createServerSupabase()
  const { data, error } = await sb.storage.from(EMPRESAS_BUCKET).list('', {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error || !data) {
    console.error('[storage] listRucs error:', error)
    return []
  }
  return data
    .filter(item => item.id === null && /^\d{13}$/.test(item.name)) // carpetas
    .map(item => item.name)
    .sort()
}

/** Lista períodos YYYYMM disponibles para un RUC. */
export async function listPeriodsFromStorage(ruc: string): Promise<string[]> {
  const sb = createServerSupabase()
  const { data, error } = await sb.storage.from(EMPRESAS_BUCKET).list(ruc, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error || !data) return []
  return data
    .filter(item => /^\d{6}\.csv$/i.test(item.name))
    .map(item => item.name.replace(/\.csv$/i, ''))
    .sort()
}

/** Descarga el contenido de un CSV como string. */
export async function readCsvFromStorage(ruc: string, filename: string): Promise<string | null> {
  const sb = createServerSupabase()
  const { data, error } = await sb.storage
    .from(EMPRESAS_BUCKET)
    .download(`${ruc}/${filename}`)
  if (error || !data) {
    console.error(`[storage] readCsv ${ruc}/${filename}:`, error)
    return null
  }
  return data.text()
}

/** Sube un archivo CSV al bucket. */
export async function uploadCsvToStorage(
  ruc: string,
  filename: string,
  content: string | ArrayBuffer,
): Promise<{ ok: boolean; error?: string }> {
  const sb = createServerSupabase()
  const blob = typeof content === 'string'
    ? new Blob([content], { type: 'text/csv' })
    : new Blob([content], { type: 'text/csv' })

  const { error } = await sb.storage
    .from(EMPRESAS_BUCKET)
    .upload(`${ruc}/${filename}`, blob, { upsert: true, contentType: 'text/csv' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Elimina un archivo CSV del bucket. */
export async function deleteCsvFromStorage(ruc: string, filename: string): Promise<boolean> {
  const sb = createServerSupabase()
  const { error } = await sb.storage
    .from(EMPRESAS_BUCKET)
    .remove([`${ruc}/${filename}`])
  return !error
}
