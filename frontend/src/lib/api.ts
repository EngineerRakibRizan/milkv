import axios, { AxiosError, type AxiosRequestConfig } from 'axios'

const TOKEN_KEY = 'farmos.token'
const FARM_KEY = 'farmos.farm'

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) },
  set token(v: string | null) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY) },
  get farmId() { return localStorage.getItem(FARM_KEY) },
  set farmId(v: string | null) { v ? localStorage.setItem(FARM_KEY, v) : localStorage.removeItem(FARM_KEY) },
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { Accept: 'application/json' },
  timeout: 20_000,
})

http.interceptors.request.use((config) => {
  if (session.token) config.headers.Authorization = `Bearer ${session.token}`
  if (session.farmId) config.headers['X-Farm-Id'] = session.farmId
  const method = (config.method ?? 'get').toLowerCase()
  // Every write is idempotent: a retry or offline replay reuses the same key.
  if (method !== 'get' && !config.headers['Idempotency-Key']) {
    config.headers['Idempotency-Key'] = crypto.randomUUID()
  }
  return config
})

http.interceptors.response.use(undefined, (error: AxiosError) => {
  if (error.response?.status === 401 && session.token) {
    session.token = null
    window.dispatchEvent(new Event('farmos:logout'))
  }
  return Promise.reject(error)
})

export type ApiError = { message: string; errors: Record<string, string[]>; status: number; offline: boolean }

export function toApiError(e: unknown): ApiError {
  const err = e as AxiosError<{ message?: string; errors?: Record<string, string[]> }>
  if (!err.response) return { message: 'You are offline. Changes will sync automatically.', errors: {}, status: 0, offline: true }
  return {
    message: err.response.data?.message ?? 'Something went wrong',
    errors: err.response.data?.errors ?? {},
    status: err.response.status,
    offline: false,
  }
}

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await http.get<T>(url, { params })
  return data
}

export async function send<T>(method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await http.request<T>({ method, url, data: body, ...config })
  return data
}

export type Paginated<T> = { data: T[]; meta: { current_page: number; last_page: number; total: number; per_page: number } }
