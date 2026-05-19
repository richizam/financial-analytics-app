import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function testFetch(url: string, opts?: RequestInit): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts })
    return `HTTP ${res.status}`
  } catch (e) {
    return `ERROR: ${String(e)}`
  }
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  const [publicTest, supabaseApiTest, storageTest] = await Promise.all([
    // ¿Puede Vercel hacer fetch en general?
    testFetch('https://httpbin.org/get'),
    // ¿Puede alcanzar el API de Supabase?
    testFetch(`${supabaseUrl}/rest/v1/`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    }),
    // ¿Puede alcanzar Storage?
    testFetch(`${supabaseUrl}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    }),
  ])

  return NextResponse.json({
    SUPABASE_URL:        supabaseUrl || '❌ missing',
    service_role_key:    serviceKey ? '✅ set' : '❌ missing',
    test_public_url:     publicTest,
    test_supabase_api:   supabaseApiTest,
    test_supabase_storage: storageTest,
  })
}
