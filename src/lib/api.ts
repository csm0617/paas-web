import { useAuthStore } from '@/stores/auth'

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'

export class ApiError extends Error {
  code: number
  payload: unknown

  constructor(message: string, code = -1, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.payload = payload
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  params?: Query
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  raw?: boolean
}

function buildUrl(path: string, params?: Query) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!params) return url
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.append(key, String(value))
  })
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function handleUnauthorized() {
  const { token, clear } = useAuthStore.getState()
  if (token) clear()
  if (typeof window === 'undefined') return
  const isLogin = window.location.pathname.startsWith('/user/login')
  if (isLogin) return
  const redirect = `${window.location.pathname}${window.location.search}`
  window.location.replace(`/user/login?r=${encodeURIComponent(redirect)}`)
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', params, body, signal, headers, raw } = options
  const token = useAuthStore.getState().token
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(25_000)
      : undefined
  const init: RequestInit = {
    method,
    signal: signal ?? timeoutSignal,
    credentials: 'include',
    headers: {
      'time-format': stamp(),
      ...(token ? { token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)

  let response: Response
  try {
    response = await fetch(buildUrl(path, params), init)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    if ((error as Error).name === 'TimeoutError') {
      throw new ApiError('请求超时，服务或监控指标暂不可用', -3, error)
    }
    throw new ApiError('无法连接平台服务，请检查网络或后端状态', -2, error)
  }

  const contentType = response.headers.get('Content-Type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')

  if (response.ok && payload === '') return null as T

  const code = payload && typeof payload === 'object' && 'code' in payload ? Number(payload.code) : undefined
  const message =
    (payload && typeof payload === 'object' && ('msg' in payload ? String(payload.msg) : '')) ||
    (response.status === 401 ? '登录状态已失效，请重新登录' : `请求失败 (${response.status})`)

  if (response.status === 401 || code === 401) {
    handleUnauthorized()
    throw new ApiError('登录状态已失效，请重新登录', 401, payload)
  }
  if (!response.ok) throw new ApiError(message, response.status, payload)
  if (code !== undefined && code !== 0) throw new ApiError(message, code, payload)

  if (raw) return payload as T
  if (payload && typeof payload === 'object' && 'data' in payload) return (payload as { data: T }).data
  return payload as T
}

export const api = {
  get: <T>(path: string, params?: Query, options?: Omit<RequestOptions, 'method' | 'params'>) =>
    request<T>(path, { ...options, method: 'GET', params }),
  post: <T>(path: string, body?: unknown, params?: Query) =>
    request<T>(path, { method: 'POST', body, params }),
  put: <T>(path: string, body?: unknown, params?: Query) =>
    request<T>(path, { method: 'PUT', body, params }),
  del: <T>(path: string, body?: unknown, params?: Query) =>
    request<T>(path, { method: 'DELETE', body, params }),
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return '未知错误'
}
