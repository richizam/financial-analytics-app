function backendBaseUrl(): string {
  const raw =
    process.env.PYTHON_BACKEND_URL ??
    process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL ??
    'http://127.0.0.1:8000'

  return raw.replace(/\/+$/, '')
}

function backendPath(path: string): string {
  if (path === '/health') return path
  return `/api/v1${path.startsWith('/') ? path : `/${path}`}`
}

function backendHeaders(): HeadersInit {
  const apiKey = process.env.BACKEND_API_KEY
  return apiKey ? { 'X-Backend-Api-Key': apiKey } : {}
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'detail' in data
      ? JSON.stringify(data.detail)
      : text
    throw new Error(`Python backend ${path} failed (${response.status}): ${detail}`)
  }

  return data as T
}

export async function getBackendJson<T>(path: string): Promise<T> {
  const apiPath = backendPath(path)
  const response = await fetch(`${backendBaseUrl()}${apiPath}`, {
    headers: backendHeaders(),
    cache: 'no-store',
  })
  return readJson<T>(response, apiPath)
}

export async function postBackendJson<T>(path: string, body: unknown): Promise<T> {
  const apiPath = backendPath(path)
  const response = await fetch(`${backendBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: { ...backendHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  return readJson<T>(response, apiPath)
}

export async function postBackendForm<T>(path: string, body: FormData): Promise<T> {
  const apiPath = backendPath(path)
  const response = await fetch(`${backendBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: backendHeaders(),
    body,
    cache: 'no-store',
  })
  return readJson<T>(response, apiPath)
}
