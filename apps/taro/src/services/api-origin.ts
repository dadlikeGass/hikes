export const DEFAULT_API_ORIGIN='https://www.fotowa.fun/api'

export function resolveApiOrigin(value:string|undefined):string {
  return (value||'').trim().replace(/\/$/,'')
}

export function joinApiUrl(base:string,path:string):string {
  const origin=resolveApiOrigin(base)
  const route=path.startsWith('/')?path:`/${path}`
  if(/\/api$/i.test(origin)&&/^\/api(?:\/|$)/i.test(route))return `${origin}${route.slice(4)}`
  return `${origin}${route}`
}
