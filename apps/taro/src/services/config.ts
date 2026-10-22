// Set TARO_APP_API_BASE_URL at build time; never silently target an unverified production host.
import { DEFAULT_API_ORIGIN, resolveApiOrigin } from './api-origin'
export const API_BASE_URL = resolveApiOrigin(process.env.TARO_APP_API_BASE_URL || DEFAULT_API_ORIGIN)
