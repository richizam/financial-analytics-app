/**
 * db-storage.ts — Almacena archivos CSV en PostgreSQL via Prisma.
 */
import { prisma } from './prisma'

/** Lista los RUC disponibles (con al menos un CSV de período YYYYMM). */
export async function listRucsFromDb(): Promise<string[]> {
  const rows = await prisma.csvFile.findMany({
    select: { ruc: true, filename: true },
    orderBy: { ruc: 'asc' },
  })
  const rucsConPeriodos = new Set(
    rows
      .filter(r => /^\d{6}\.csv$/i.test(r.filename))
      .map(r => r.ruc)
  )
  return [...rucsConPeriodos].sort()
}

/** Lista períodos YYYYMM disponibles para un RUC. */
export async function listPeriodsFromDb(ruc: string): Promise<string[]> {
  const rows = await prisma.csvFile.findMany({
    where: { ruc },
    select: { filename: true },
    orderBy: { filename: 'asc' },
  })
  return rows
    .map(r => r.filename)
    .filter(f => /^\d{6}\.csv$/i.test(f))
    .map(f => f.replace(/\.csv$/i, ''))
}

/** Lee el contenido de un archivo desde la base de datos. */
export async function readCsvFromDb(ruc: string, filename: string): Promise<string | null> {
  const row = await prisma.csvFile.findUnique({
    where: { ruc_filename: { ruc, filename } },
    select: { content: true },
  })
  return row?.content ?? null
}

/** Guarda o actualiza un archivo en la base de datos. */
export async function upsertCsvToDb(
  ruc: string,
  filename: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.csvFile.upsert({
      where:  { ruc_filename: { ruc, filename } },
      update: { content, updatedAt: new Date() },
      create: { ruc, filename, content },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
