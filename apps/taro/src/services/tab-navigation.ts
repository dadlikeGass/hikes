type SwitchTab = (options:{url:string})=>unknown

export function openPlacesTab(switchTab:SwitchTab):unknown {
  return switchTab({url:'/pages/places/index'})
}
