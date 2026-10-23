type Mountain = { id:number }
type LocalPeak = { name:string; region?:string; elevation?:number; intro?:string }
type Input = { mountain:Mountain|null; localPeak:LocalPeak|null; locationText:string; reason:string; expectations:string; visitsPerMonth:number }

export function buildMountainApplication(input:Input):Record<string,unknown> {
  const common={reason:input.reason.trim(),expectations:input.expectations.trim(),visitsPerMonth:input.visitsPerMonth}
  if(input.mountain)return {targetKind:'existing',mountainId:input.mountain.id,...common}
  if(!input.localPeak)throw new Error('找不到可申请的山头资料')
  return {targetKind:'new',newPointType:'peak',newName:input.localPeak.name,
    newRegion:input.localPeak.region||undefined,newLocationText:input.locationText.trim(),
    newAltitude:input.localPeak.elevation||undefined,newIntro:input.localPeak.intro||undefined,...common}
}
