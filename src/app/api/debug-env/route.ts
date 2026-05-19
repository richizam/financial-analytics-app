import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    SUPABASE_URL:              process.env.SUPABASE_URL ? '✅ set' : '❌ missing',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ set' : '❌ missing',
    NODE_ENV:                  process.env.NODE_ENV,
  })
}
