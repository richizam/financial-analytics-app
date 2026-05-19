/**
 * onedrive.ts — Cliente para Microsoft Graph API (OneDrive).
 *
 * Lee archivos CSV desde una carpeta en OneDrive con esta estructura:
 *   financial-analytics/          ← nombre configurable en ONEDRIVE_FOLDER
 *     [RUC 13 dígitos]/
 *       YYYYMM.csv
 *       saldos_iniciales_YYYY.csv
 *
 * Requiere scope: Files.Read (obtenido con Azure AD OAuth).
 */

const GRAPH_API = 'https://graph.microsoft.com/v1.0'

// Nombre de la carpeta raíz en OneDrive (configurable en env vars)
function rootFolder(): string {
  return process.env.ONEDRIVE_FOLDER ?? 'financial-analytics'
}

interface GraphItem {
  id: string
  name: string
  folder?: object
  file?: object
}

interface GraphListResponse {
  value: GraphItem[]
}

/** Refresca el access token de Microsoft usando el refresh token. */
async function refreshMsToken(refreshToken: string): Promise<string | null> {
  try {
    const tenantId = process.env.AZURE_AD_TENANT_ID ?? 'common'
    const res = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.AZURE_AD_CLIENT_ID!,
          client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
          scope:         'Files.Read User.Read offline_access',
        }),
      },
    )
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

/** Lista hijos de una ruta en OneDrive del usuario. */
async function listChildren(token: string, path: string): Promise<GraphItem[]> {
  const encoded = encodeURIComponent(path)
  const url = `${GRAPH_API}/me/drive/root:/${encoded}:/children?$select=id,name,folder,file&$top=1000`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[onedrive] listChildren error', res.status, body)
    return []
  }
  const data = await res.json() as GraphListResponse
  return data.value ?? []
}

/** Descarga el contenido de un archivo como texto. */
async function downloadFile(token: string, path: string): Promise<string | null> {
  const encoded = encodeURIComponent(path)
  const url = `${GRAPH_API}/me/drive/root:/${encoded}:/content`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[onedrive] downloadFile error', res.status, path)
    return null
  }
  return res.text()
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface OneDriveClient {
  listRucs: () => Promise<string[]>
  listPeriods: (ruc: string) => Promise<string[]>
  readCsv: (ruc: string, filename: string) => Promise<string | null>
}

/**
 * Crea un cliente de OneDrive usando el access token del usuario (Azure AD).
 */
export function createOneDriveClient(
  accessToken: string,
  refreshToken?: string,
): OneDriveClient {
  let token = accessToken

  async function ensureToken(): Promise<string> {
    return token
  }

  async function tryRefresh(): Promise<boolean> {
    if (!refreshToken) return false
    const newToken = await refreshMsToken(refreshToken)
    if (newToken) { token = newToken; return true }
    return false
  }

  /** Lista carpetas RUC (13 dígitos) dentro de la carpeta raíz */
  async function listRucs(): Promise<string[]> {
    const t = await ensureToken()
    let items = await listChildren(t, rootFolder())

    // Si está vacío, intentar refrescar el token
    if (items.length === 0) {
      const refreshed = await tryRefresh()
      if (refreshed) items = await listChildren(token, rootFolder())
    }

    return items
      .filter(i => i.folder !== undefined && /^\d{13}$/.test(i.name))
      .map(i => i.name)
      .sort()
  }

  /** Lista períodos YYYYMM disponibles para un RUC */
  async function listPeriods(ruc: string): Promise<string[]> {
    const t = await ensureToken()
    const items = await listChildren(t, `${rootFolder()}/${ruc}`)
    return items
      .filter(i => i.file !== undefined && /^\d{6}\.csv$/i.test(i.name))
      .map(i => i.name.replace(/\.csv$/i, ''))
      .sort()
  }

  /** Descarga un CSV (YYYYMM.csv o saldos_iniciales_YYYY.csv) como string */
  async function readCsv(ruc: string, filename: string): Promise<string | null> {
    const t = await ensureToken()
    return downloadFile(t, `${rootFolder()}/${ruc}/${filename}`)
  }

  return { listRucs, listPeriods, readCsv }
}
