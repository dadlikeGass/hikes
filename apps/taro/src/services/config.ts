// Rebuild after changing the production API origin; Taro embeds it at build time.
const configuredOrigin = process.env.TARO_APP_API_BASE_URL || 'https://www.fotowa.fun'
export const API_BASE_URL = configuredOrigin.trim().replace(/\/$/, '')
