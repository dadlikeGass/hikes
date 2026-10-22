// The verified production API is the default; TARO_APP_API_BASE_URL can override it.
const configuredOrigin = process.env.TARO_APP_API_BASE_URL || 'https://www.dcyy.world'
export const API_BASE_URL = configuredOrigin.trim().replace(/\/$/, '')
