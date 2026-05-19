import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Cliente server-side con service role (solo usar en Server Components / Server Actions) */
export function createServerSupabase() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })
}

/** Bucket donde viven los CSV de empresas */
export const EMPRESAS_BUCKET = 'empresas'
