import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  let storageTest: string
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    })
    const body = await res.text()
    storageTest = `HTTP ${res.status}: ${body.slice(0, 200)}`
  } catch (e) {
    storageTest = `ERROR: ${String(e)}`
  }

  return NextResponse.json({
    SUPABASE_URL:              supabaseUrl || '❌ missing',
    SUPABASE_SERVICE_ROLE_KEY: serviceKey ? '✅ set' : '❌ missing',
    storage_connection_test:   storageTest,
  })
}
