/** URL base y key del proyecto Supabase — leídos en cada llamada para evitar problemas de inicialización */
export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL no está configurado')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurado')
  return { url: url.replace(/\/$/, ''), key }
}

export const EMPRESAS_BUCKET = 'empresas'
