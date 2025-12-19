import { getToken } from '@/utils/token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  options?: {
    method?: string
    body?: unknown
    auth?: boolean
  },
): Promise<T> {
  const method = options?.method ?? 'GET'
  const auth = options?.auth ?? true
  const headers: Record<string, string> = { Accept: 'application/json' }
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData
  if (method !== 'GET' && !isFormData) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(path, {
    method,
    headers,
    body:
      options?.body != null && method !== 'GET'
        ? isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body)
        : undefined,
  })
  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const msg = data?.message || res.statusText || 'Request failed'
    throw new ApiError(res.status, msg)
  }
  return data as T
}
