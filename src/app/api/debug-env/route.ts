import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  let csvCount = 'error'
  let csvSample: unknown = []
  
  try {
    csvCount = String(await prisma.csvFile.count())
    csvSample = await prisma.csvFile.findMany({
      select: { ruc: true, filename: true, updatedAt: true },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    })
  } catch (e) {
    csvCount = `ERROR: ${String(e)}`
  }

  return NextResponse.json({
    SUPABASE_URL:    process.env.SUPABASE_URL ? '✅' : '❌',
    VERCEL:          process.env.VERCEL ?? 'not set',
    csvFile_count:   csvCount,
    csvFile_sample:  csvSample,
  })
}
