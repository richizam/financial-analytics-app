/**
 * storage.ts — Supabase Storage via REST API directa.
 */
import { getSupabaseConfig, EMPRESAS_BUCKET } from './supabase'

function storageBase(): string {
  const { url } = getSupabaseConfig()
  return `${url}/storage/v1`
}

function authHeaders(): Record<string, string> {
  const { key } = getSupabaseConfig()
  return { Authorization: `Bearer ${key}`, apikey: key }
}

async function listItems(prefix: string): Promise<{ name: string; id: string | null }[]> {
  const res = await fetch(`${storageBase()}/object/list/${EMPRESAS_BUCKET}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, delimiter: '/', limit: 1000 }),
  })
  if (!res.ok) throw new Error(`Storage list error ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function listRucsFromStorage(): Promise<string[]> {
  const items = await listItems('')
  return items
    .filter(i => i.id === null && /^\d{13}\/?$/.test(i.name))
    .map(i => i.name.replace(/\/$/, ''))
    .sort()
}

export async function listPeriodsFromStorage(ruc: string): Promise<string[]> {
  const items = await listItems(`${ruc}/`)
  return items
    .filter(i => i.id !== null && /^\d{6}\.csv$/i.test(i.name))
    .map(i => i.name.replace(/\.csv$/i, ''))
    .sort()
}

export async function readCsvFromStorage(ruc: string, filename: string): Promise<string | null> {
  const res = await fetch(
    `${storageBase()}/object/${EMPRESAS_BUCKET}/${ruc}/${filename}`,
    { headers: authHeaders() },
  )
  if (res.status === 404) return null
  if (!res.ok) { console.error(`[storage] read ${ruc}/${filename}: ${res.status}`); return null }
  return res.text()
}

export async function uploadCsvToStorage(
  ruc: string,
  filename: string,
  content: ArrayBuffer | string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { key, url } = getSupabaseConfig()
    const endpoint = `${url}/storage/v1/object/${EMPRESAS_BUCKET}/${ruc}/${filename}`

    const bodyBytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : new Uint8Array(content)

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'text/csv',
        'x-upsert': 'true',
      },
      body: bodyBytes,
    })

    if (!res.ok) {
      const errText = await res.text()
      return { ok: false, error: `HTTP ${res.status}: ${errText}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
