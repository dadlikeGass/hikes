import { useEffect, useState } from 'react'
import { View, Text, Textarea, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getErrorMessage, request } from '../../services/api'
import { buildMountainApplication } from '../../services/mountain-application'
import catalog from '../../data/catalog.json'
import './index.scss'

type Mountain={id:number;name:string;region?:string|null;pointCount:number;altitude?:number|null}
type PointBrief={id:number;code:string;name?:string|null;type:string}
type PointDetail={code:string;mountainId?:number|null;altitude?:number|null;maintainerName?:string|null;recentContribution?:string|null}
export default function MountainPage(){
 const q=Taro.getCurrentInstance().router?.params||{};const requestedName=q.name||'山头资料';const requestedId=Number(q.mountainId)||0;const localPeak=catalog.peaks.find(peak=>peak.name===requestedName);const [data,setData]=useState<Mountain|null>(null);const [boardCode,setBoardCode]=useState('');const [boardPoint,setBoardPoint]=useState<PointDetail|null>(null);const [loading,setLoading]=useState(true)
 const [showApplication,setShowApplication]=useState(false);const [reason,setReason]=useState('');const [expectations,setExpectations]=useState('');const [locationText,setLocationText]=useState('');const [visits,setVisits]=useState('4');const [applying,setApplying]=useState(false);const [applicationStatus,setApplicationStatus]=useState('')
 Taro.useShareAppMessage(()=>({title:`山头分享 · ${data?.name||requestedName}`,path:`/pages/mountain/index?${data?.id?`mountainId=${data.id}&`:''}name=${encodeURIComponent(data?.name||requestedName)}`}))
 useEffect(()=>{let active=true;setLoading(true);(async()=>{try{let match:Mountain|null=null;try{const result=await request<{items:Array<{mountainId:number;name:string;region?:string|null;altitude?:number|null;pointId?:number|null}>;nextCursor:number|null}>(`/api/mountains/search?q=${encodeURIComponent(requestedName)}&limit=50`);const found=result.items.find(m=>requestedId&&m.mountainId===requestedId)||result.items.find(m=>m.name===requestedName);if(found)match={id:found.mountainId,name:found.name,region:found.region,altitude:found.altitude,pointCount:0}}catch{}if(!match){const mountains=await request<Mountain[]>(`/api/mountains?keyword=${encodeURIComponent(requestedName)}&limit=1000`);match=mountains.find(m=>requestedId&&m.id===requestedId)||mountains.find(m=>m.name===requestedName)||null}if(!active)return;setData(match);if(!match)return;const points=await request<PointBrief[]>('/api/points?limit=1000');const candidates=points.filter(p=>p.type==='peak'&&p.name===match!.name);for(const candidate of candidates.slice(0,30)){try{const detail=await request<PointDetail>(`/api/points/${encodeURIComponent(candidate.code)}`);if(detail.mountainId===match!.id){if(active){setBoardCode(candidate.code);setBoardPoint(detail)}break}}catch{}}
 }catch(e){if(active&&!localPeak)Taro.showToast({title:getErrorMessage(e),icon:'none'})}finally{if(active)setLoading(false)}})();return()=>{active=false}},[requestedId,requestedName])
 const own=q.maintainer==='self';const maintained=!!(boardPoint?.maintainerName||q.maintainer==='other');const status=own?'本人维护':maintained?'已有山友维护':'尚无人维护'
 const apply=async()=>{
  if(applying)return
  if(!Taro.getStorageSync('hikes.auth.token')){Taro.showToast({title:'请先登录再申请',icon:'none'});Taro.switchTab({url:'/pages/me/index'});return}
  if(reason.trim().length<20||expectations.trim().length<20){Taro.showToast({title:'申请原因和维护计划各需至少 20 字',icon:'none'});return}
  if(!data&&!localPeak){Taro.showToast({title:'暂时无法关联这座山的服务端资料',icon:'none'});return}
  if(!data&&!locationText.trim()){Taro.showToast({title:'请补充山头的准确位置',icon:'none'});return}
  const visitsPerMonth=Number(visits)
  if(!Number.isInteger(visitsPerMonth)||visitsPerMonth<1||visitsPerMonth>30){Taro.showToast({title:'每月维护次数须为 1–30',icon:'none'});return}
  const confirm=await Taro.showModal({title:'确认提交维护申请？',content:'平台会审核你填写的原因与计划；提交后不会立即获得维护权限。',confirmText:'提交申请'})
  if(!confirm.confirm)return
  setApplying(true)
  try{await request('/api/king-applications',{method:'POST',data:buildMountainApplication({mountain:data,localPeak:localPeak||null,locationText,reason,expectations,visitsPerMonth})});setApplicationStatus('申请已提交，请在“我的”页面查看申请进度。');setShowApplication(false)}catch(e){Taro.showToast({title:getErrorMessage(e),icon:'none'})}finally{setApplying(false)}
 }
 return <View className='page mountain-page'><Text className='eyebrow'>MOUNTAIN COMMUNITY</Text><Text className='hero-title'>{data?.name||requestedName}</Text><View className='mountain-hero'><Text className='mountain-glyph'>山</Text><Text className='mountain-status'>{loading?'正在读取山头资料…':status}</Text><Text className='subtle'>{data?.region||'每一座山，都值得被熟悉的人照看。'}{data?`　·　${data.pointCount} 个关联点位`:''}</Text></View>
 {localPeak&&!data&&<View className='card'><Text className='section-label'>山头资料</Text><Text className='subtle'>{localPeak.region} · 海拔 {localPeak.elevation} m</Text><Text className='subtle'>{localPeak.intro}</Text><Text className='subtle'>该资料尚未关联服务端山头，仍可提交新山头维护申请。</Text></View>}
 {boardPoint&&<View className='card'><Text className='section-label'>{boardPoint.maintainerName?`${boardPoint.maintainerName} 正在照看这座山`:'山峰留言板'}</Text>{boardPoint.recentContribution&&<Text className='subtle'>{boardPoint.recentContribution}</Text>}<View className='primary action' onClick={()=>Taro.navigateTo({url:`/pages/point/index?code=${encodeURIComponent(boardCode)}&source=manual`})}>打开山顶留言板</View></View>}
 {!loading&&!data&&!localPeak&&<View className='card'><Text className='subtle'>暂时没有匹配到这座山的资料，仍可通过路线和点位继续浏览。</Text></View>}
 <Text className='section-title'>一起维护一座山</Text><Text className='subtle'>维护人帮助补充地点资料、留意留言与路况，让后来的人更安心地认识这座山。维护不是所有权，也不妨碍其他山友贡献。</Text>
 <View className='card responsibility'><Text className='section-label'>维护人会做什么</Text><View className='task-row'><Text className='task-icon'>01</Text><Text>核对山名、海拔和入口信息</Text></View><View className='task-row'><Text className='task-icon'>02</Text><Text>回应山顶留言，补充近期路况</Text></View><View className='task-row'><Text className='task-icon'>03</Text><Text>处理山友协作与资料纠错</Text></View><View className='divider'/><Text className='subtle'>每块留言板设一个广告位作为维护福利；需经平台审核，不承诺收益。</Text></View>
 {own?<View className='card'><Text className='section-label'>你的维护工作</Text><Text className='subtle'>在“我的”页面查看留言待办与申请提醒。</Text><View className='primary action' onClick={()=>Taro.navigateTo({url:'/pages/managed/index'})}>打开维护工作台</View></View>:maintained?<View className='card'><Text className='section-label'>{boardPoint?.maintainerName||'已有山友'} 正在维护</Text><Text className='subtle'>这座山已有人照看，也欢迎你提交资料、路况和留言，一起帮忙。</Text></View>:<View className='card'><Text className='section-label'>愿意常来看看这座山吗？</Text><Text className='subtle'>申请后平台会核对维护职责与地点信息，再确认授权。</Text>{applicationStatus?<Text className='subtle note'>{applicationStatus}</Text>:<><View className='primary action' onClick={()=>setShowApplication(!showApplication)}>{showApplication?'收起申请表':'申请维护这座山'}</View>{showApplication&&<View className='mountain-application'>{!data&&<><Text>准确位置（必填）</Text><Input value={locationText} placeholder='例如：某市某区某山主峰，东经…北纬…' onInput={e=>setLocationText(e.detail.value)}/></>}<Text>申请原因（至少 20 字）</Text><Textarea maxlength={1000} value={reason} placeholder='说明你与这座山的关系及实地经验' onInput={e=>setReason(e.detail.value)}/><Text>维护计划（至少 20 字）</Text><Textarea maxlength={2000} value={expectations} placeholder='说明你会如何核对资料、回应山友' onInput={e=>setExpectations(e.detail.value)}/><Text>预计每月维护次数</Text><Input type='number' value={visits} onInput={e=>setVisits(e.detail.value)}/><View className='primary action' onClick={()=>void apply()}>{applying?'正在提交…':'确认提交申请'}</View></View>}</>}</View>}
 </View>
}
