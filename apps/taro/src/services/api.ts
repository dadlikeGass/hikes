import Taro from '@tarojs/taro'
import { API_BASE_URL } from './config'
import { joinApiUrl } from './api-origin'

type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; data?: Record<string, unknown>; retryNetwork?: number }
export class ApiError extends Error {
  statusCode: number
  code?: string
  constructor(message: string, statusCode: number, code?: string) { super(message); this.statusCode = statusCode; this.code = code }
}

export type AuthSession = { token: string; userId: number; mergedVisits: number; mergedDrafts: number }

const eventQueue: Array<{ name: string; props: Record<string, unknown> }> = []
let flushingEvents = false
function flushEvents(): void {
  if (flushingEvents || !eventQueue.length || !API_BASE_URL) return
  flushingEvents = true
  const batch = eventQueue.splice(0, 20)
  const token = Taro.getStorageSync('hikes.auth.token')
  const header: Record<string,string> = { 'Content-Type': 'application/json' }
  if (token) header.Authorization = `Bearer ${token}`
  Taro.request({ url: joinApiUrl(API_BASE_URL, '/api/events'), method: 'POST', data: batch, header, timeout: 5000 })
    .then(response => { if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('event upload failed'); flushingEvents = false; if (eventQueue.length) flushEvents() })
    .catch(() => { eventQueue.unshift(...batch); if (eventQueue.length > 40) eventQueue.length = 40; flushingEvents = false; setTimeout(flushEvents, 30000) })
}
export function trackEvent(name: string, props: Record<string, unknown> = {}): void {
  // Event names and a few non-identifying enums only; never pass codes, text, tokens or location.
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return
  const safe: Record<string, unknown> = {}
  if (props.source === 'scan' || props.source === 'manual') safe.source = props.source
  if (typeof props.first === 'boolean') safe.first = props.first
  if (props.board === 'peak' || props.board === 'segment') safe.board = props.board
  eventQueue.push({ name, props: safe })
  if (eventQueue.length > 40) eventQueue.splice(0, eventQueue.length - 40)
  flushEvents()
}

export function requestPrivacyAuthorization(): Promise<void> {
  return new Promise((resolve, reject) => Taro.requirePrivacyAuthorize({ success: () => resolve(), fail: error => reject(error) }))
}

export async function loginWithWechat(code: string): Promise<AuthSession> {
  await ensureGuestToken()
  const session = await request<AuthSession>('/api/auth/wechat', { method: 'POST', data: { code } })
  Taro.setStorageSync('hikes.auth.token', session.token)
  Taro.setStorageSync('hikes.auth.userId', session.userId)
  // The server merged this guest into the account in the same transaction.
  Taro.removeStorageSync('hikes.guest.token')
  return session
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) throw new ApiError('服务地址尚未配置，请联系维护人员。', 0, 'api_origin_missing')
  const token = Taro.getStorageSync('hikes.auth.token')
  const guest = Taro.getStorageSync('hikes.guest.token')
  const header: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) header.Authorization = `Bearer ${token}`
  if (guest) header['X-Guest-Token'] = guest
  const retries = options.retryNetwork || 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await Taro.request<T>({ url: joinApiUrl(API_BASE_URL, path), method: options.method || 'GET', data: options.data, header, timeout: 15000 })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const body = response.data as any
        const detail = body?.error || body?.detail?.error
        const error = new ApiError(detail?.message || `请求失败 (${response.statusCode})`, response.statusCode, detail?.code)
        if (error.statusCode === 401 && token) {
          Taro.removeStorageSync('hikes.auth.token')
          Taro.removeStorageSync('hikes.auth.userId')
        }
        if (attempt < retries && [502, 503, 504].includes(error.statusCode)) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
          continue
        }
        throw error
      }
      return response.data
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('网络连接失败，请检查网络后重试', 0)
      if (attempt < retries && apiError.statusCode === 0) {
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      throw apiError
    }
  }
}

export async function ensureGuestToken(): Promise<string> {
  let token = Taro.getStorageSync('hikes.guest.token') as string
  if (!token) {
    const bytes = new Uint8Array((await Taro.getRandomValues({ length: 24 })).randomValues)
    token = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
    Taro.setStorageSync('hikes.guest.token', token)
  }
  const result = await request<{ token: string }>('/api/guest', { method: 'POST', retryNetwork: 2 })
  Taro.setStorageSync('hikes.guest.token', result.token)
  return result.token
}

export async function requestWithGuest<T>(path: string, token: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) throw new ApiError('请先配置 TARO_APP_API_BASE_URL，再连接真实服务。', 0, 'api_origin_missing')
  const auth = Taro.getStorageSync('hikes.auth.token')
  const header: Record<string, string> = { 'Content-Type': 'application/json', 'X-Guest-Token': token }
  if (auth) header.Authorization = `Bearer ${auth}`
  try {
    const response = await Taro.request<T>({ url: joinApiUrl(API_BASE_URL, path), method: options.method || 'GET', data: options.data, header, timeout: 15000 })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const body = response.data as any
      throw new ApiError(body?.error?.message || `请求失败 (${response.statusCode})`, response.statusCode, body?.error?.code)
    }
    return response.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('网络连接失败，请检查网络后重试', 0)
  }
}

export function getErrorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请稍后重试' }
