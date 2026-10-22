export type PointBrief = { id:number; code:string; name:string|null; type:'peak'|'junction'|'trailhead'; route_name:string|null; altitude:number|null; visit_count:number }

export function pointBriefSubtitle(point:PointBrief):string {
  const altitude=point.altitude==null?'海拔待补充':`海拔 ${point.altitude} m`
  return point.route_name?`${altitude} · ${point.route_name}`:altitude
}

export function pointBriefHeat(point:PointBrief):string {
  return `到访 ${point.visit_count} 次`
}
