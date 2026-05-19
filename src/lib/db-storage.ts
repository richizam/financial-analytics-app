/**
 * db-storage.ts — Almacena archivos CSV en PostgreSQL via Prisma.
 * Usa la misma conexión de base de datos que el login (DATABASE_URL).
 */
import { prisma } from './prisma'

/** Lista los RUC disponibles (13 dígitos, con al menos un CSV de período). */
export async function listRucsFromDb(): Promise<string[]> {
  const rows = await prisma.csvFile.findMany({
    where: { filename: { match: '^[0-9]{6}\\.csv$' } },
    select: { ruc: true },
    distinct: ['ruc'],
    orderBy: { ruc: 'asc' },
  })
  return rows.map(r => r.ruc)
}

/** Lista períodos YYYYMM disponibles para un RUC. */
export async function listPeriodsFromDb(ruc: string): Promise<string[]> {
  const rows = await prisma.csvFile.findMany({
    where: {
      ruc,
      filename: { match: '^[0-9]{6}\\.csv$' },
    },
    select: { filename: true },
    orderBy: { filename: 'asc' },
  })
  return rows.map(r => r.filename.replace(/\.csv$/i, ''))
}

/** Lee el contenido de un CSV desde la base de datos. */
export async function readCsvFromDb(ruc: string, filename: string): Promise<string | null> {
  const row = await prisma.csvFile.findUnique({
    where: { ruc_filename: { ruc, filename } },
    select: { content: true },
  })
  return row?.content ?? null
}

/** Guarda o actualiza un CSV en la base de datos. */
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
