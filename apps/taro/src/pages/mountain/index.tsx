import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getErrorMessage, request } from '../../services/api'
import catalog from '../../data/catalog.json'
import './index.scss'

type Mountain={id:number;name:string;region?:string|null;pointCount:number}
type PointBrief={id:number;code:string;name?:string|null;type:string}
type PointDetail={code:string;mountainId?:number|null;altitude?:number|null;maintainerName?:string|null;recentContribution?:string|null}
export default function MountainPage(){
 const q=Taro.getCurrentInstance().router?.params||{};const requestedName=q.name||'山头资料';const requestedId=Number(q.mountainId)||0;const localPeak=catalog.peaks.find(peak=>peak.name===requestedName);const [data,setData]=useState<Mountain|null>(null);const [boardCode,setBoardCode]=useState('');const [boardPoint,setBoardPoint]=useState<PointDetail|null>(null);const [loading,setLoading]=useState(true)
 Taro.useShareAppMessage(()=>({title:`山头分享 · ${data?.name||requestedName}`,path:`/pages/mountain/index?${data?.id?`mountainId=${data.id}&`:''}name=${encodeURIComponent(data?.name||requestedName)}`}))
 useEffect(()=>{let active=true;setLoading(true);if(q.local==='1'&&localPeak){setLoading(false);return()=>{active=false}}(async()=>{try{const mountains=await request<Mountain[]>('/api/mountains?limit=1000');const match=mountains.find(m=>requestedId&&m.id===requestedId)||mountains.find(m=>m.name===requestedName)||null;if(!active)return;setData(match);if(!match)return;const points=await request<PointBrief[]>('/api/points?limit=1000');const candidates=points.filter(p=>p.type==='peak'&&p.name===match.name);for(const candidate of candidates.slice(0,30)){try{const detail=await request<PointDetail>(`/api/points/${encodeURIComponent(candidate.code)}`);if(detail.mountainId===match.id){if(active){setBoardCode(candidate.code);setBoardPoint(detail)}break}}catch{}}
 }catch(e){if(active&&!localPeak)Taro.showToast({title:getErrorMessage(e),icon:'none'})}finally{if(active)setLoading(false)}})();return()=>{active=false}},[requestedId,requestedName])
 const own=q.maintainer==='self';const maintained=!!(boardPoint?.maintainerName||q.maintainer==='other');const status=own?'本人维护':maintained?'已有山友维护':'尚无人维护'
 return <View className='page mountain-page'><Text className='eyebrow'>MOUNTAIN COMMUNITY</Text><Text className='hero-title'>{data?.name||requestedName}</Text><View className='mountain-hero'><Text className='mountain-glyph'>山</Text><Text className='mountain-status'>{loading?'正在读取山头资料…':status}</Text><Text className='subtle'>{data?.region||'每一座山，都值得被熟悉的人照看。'}{data?`　·　${data.pointCount} 个关联点位`:''}</Text></View>
 {localPeak&&!data&&<View className='card'><Text className='section-label'>山头资料</Text><Text className='subtle'>{localPeak.region} · 海拔 {localPeak.elevation} m</Text><Text className='subtle'>{localPeak.intro}</Text><Text className='subtle'>实时留言和打卡需连接服务。</Text></View>}
 {boardPoint&&<View className='card'><Text className='section-label'>{boardPoint.maintainerName?`${boardPoint.maintainerName} 正在照看这座山`:'山峰留言板'}</Text>{boardPoint.recentContribution&&<Text className='subtle'>{boardPoint.recentContribution}</Text>}<View className='primary action' onClick={()=>Taro.navigateTo({url:`/pages/point/index?code=${encodeURIComponent(boardCode)}&source=manual`})}>打开山顶留言板</View></View>}
 {!loading&&!data&&!localPeak&&<View className='card'><Text className='subtle'>暂时没有匹配到这座山的资料，仍可通过路线和点位继续浏览。</Text></View>}
 <Text className='section-title'>一起维护一座山</Text><Text className='subtle'>维护人帮助补充地点资料、留意留言与路况，让后来的人更安心地认识这座山。维护不是所有权，也不妨碍其他山友贡献。</Text>
 <View className='card responsibility'><Text className='section-label'>维护人会做什么</Text><View className='task-row'><Text className='task-icon'>01</Text><Text>核对山名、海拔和入口信息</Text></View><View className='task-row'><Text className='task-icon'>02</Text><Text>回应山顶留言，补充近期路况</Text></View><View className='task-row'><Text className='task-icon'>03</Text><Text>处理山友协作与资料纠错</Text></View><View className='divider'/><Text className='subtle'>每块留言板设一个广告位作为维护福利；需经平台审核，不承诺收益。</Text></View>
 {own?<View className='card'><Text className='section-label'>你的维护工作</Text><Text className='subtle'>维护待办接口暂未纳入本周范围。</Text></View>:maintained?<View className='card'><Text className='section-label'>{boardPoint?.maintainerName||'已有山友'} 正在维护</Text><Text className='subtle'>这座山已有人照看，也欢迎你提交资料、路况和留言，一起帮忙。</Text></View>:<View className='card'><Text className='section-label'>愿意常来看看这座山吗？</Text><Text className='subtle'>申请后平台会核对维护职责与地点信息，再确认授权。</Text><Text className='subtle note'>申请需要登录；现在可以先继续浏览或留下游客到访记录。</Text></View>}
 </View>
}
