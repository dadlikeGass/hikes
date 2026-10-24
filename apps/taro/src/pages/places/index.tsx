import { useEffect, useState } from 'react'
import { View, Text, Image, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getErrorMessage, request } from '../../services/api'
import { pointBriefHeat, pointBriefSubtitle, type PointBrief } from '../../services/point-brief'
import catalog from '../../data/catalog.json'
import TabHeader from '../../components/TabHeader'
import guide from '../../assets/places-guide.png'
import landscape from '../../assets/home-landscape.jpg'
import './index.scss'

type Summit = { id?: string; pointId?: number; code?: string; name?: string; city?: string; altitude?: number; routeName?: string; routeSlug?: string; visits30?: number; origin?: string; heatTier?: string | null; annualVisits?: string | null }
type Ranked = { mountainId?: number; name: string; visits?: number }
const localPeaks: Summit[] = catalog.peaks.map((peak, index) => ({id:`local-${index}`,name:peak.name,city:peak.region,altitude:peak.elevation,origin:'catalog',heatTier:peak.heatTier}))

export default function Places() {
  const [segment,setSegment]=useState<'peak'|'junction'>('peak')
  const [summits,setSummits]=useState<Summit[]>(localPeaks)
  const [junctions,setJunctions]=useState<PointBrief[]>([])
  const [ranking,setRanking]=useState<Ranked[]>([])
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(1)
  const [offline,setOffline]=useState(true)
  const [loading,setLoading]=useState(true)
  const [rankError,setRankError]=useState('')
  const [rankLoading,setRankLoading]=useState(true)
  const [junctionError,setJunctionError]=useState('')
  const load=async()=>{
    setLoading(true)
    setRankLoading(true);setRankError('')
    await Promise.allSettled([
      request<Summit[]>('/api/summits?limit=300').then(items=>{
        if(!items.some(item=>item.name))throw new Error('暂无山头数据')
        setSummits(items);setOffline(false)
      }).catch(()=>{setSummits(localPeaks);setOffline(true)}).finally(()=>setLoading(false)),
      request<{items:Ranked[]}>('/api/boards/mountains?window=week&metric=visits&limit=6')
        .then(data=>setRanking(data.items||[])).catch(e=>setRankError(getErrorMessage(e))).finally(()=>setRankLoading(false))
    ])
    setLoading(false)
  }
  useDidShow(()=>{void load()})
  useEffect(()=>{if(segment!=='junction')return;let active=true;setJunctionError('');
    request<PointBrief[]>('/api/points?limit=2000').then(items=>{if(active)setJunctions(items.filter(item=>item.type==='junction'))})
      .catch(e=>{if(active)setJunctionError(getErrorMessage(e))});return()=>{active=false}
  },[segment])
  const rows=segment==='peak'?summits.filter(item=>`${item.name||''} ${item.city||''} ${item.routeName||''}`.includes(query.trim())):junctions.filter(item=>`${item.name||''} ${item.route_name||''}`.includes(query.trim()))
  return <View className='places-page'><View className='places-body'>
    <View className='places-banner'><Image className='places-banner-landscape' src={landscape} mode='aspectFill'/><TabHeader/><Image className='places-banner-guide' src={guide} mode='aspectFit'/><View className='places-banner-copy'><Text className='places-banner-title'>占山为王</Text><Text>做一个游戏人间的山大王～</Text><Text>为你热爱的山峰做一个更大的留言板</Text></View></View>
    <View className='places-tabs'><View className={segment==='peak'?'on':''} onClick={()=>{setSegment('peak');setPage(1)}}>山头</View><View className={segment==='junction'?'on':''} onClick={()=>{setSegment('junction');setPage(1)}}>岔路</View></View>
    <Input className='places-search' value={query} placeholder={segment==='peak'?'搜索山头名称或所属线路':'搜索岔路名称'} onInput={e=>{setQuery(e.detail.value);setPage(1)}}/>
    {loading&&<View className='catalog-note'>正在更新山头资料…</View>}{!loading&&offline&&<View className='catalog-note' onClick={()=>void load()}>实时山头资料暂不可用，展示 {catalog.peaks.length} 座本地山峰资料。点击重试；打卡与留言以服务端记录为准。</View>}{segment==='junction'&&junctionError&&<View className='catalog-note'>{junctionError}，请切换页签重试。</View>}
    {segment==='peak'&&<><View className='places-head'><Text>登顶榜</Text><Text className='subtle'>本周 · 人次</Text></View>{ranking.length?ranking.map((item,index)=><View className='places-rank' key={`${item.name}-${index}`}><Text className='places-rank-no'>{index+1}</Text><Text>{item.name}</Text><Text className='subtle'>{item.visits||0} 次</Text></View>):<View className='places-empty'><Text className='subtle'>{rankLoading?'正在读取登顶榜…':rankError?`登顶榜加载失败：${rankError}`:'本周还没有登顶记录。'}</Text></View>}</>}
    <View className='places-head'><Text>{segment==='peak'?(offline?'山头 · 本地资料':'山头 · 按搜索热度'):'岔路'}</Text><Text className='subtle'>{rows.length} 个结果</Text></View>
    {rows.slice((page-1)*6,page*6).map((item,index)=><View className='places-card' key={item.id||item.code||index} onClick={()=>{
      if(item.code)Taro.navigateTo({url:`/${segment==='junction'?'pages/junction/index':'pages/point/index'}?code=${encodeURIComponent(item.code)}&source=manual`})
      else if(item.origin!=='catalog'&&item.pointId)Taro.navigateTo({url:`/pages/point/index?code=${encodeURIComponent(String(item.pointId))}&source=manual`})
      else Taro.navigateTo({url:`/pages/mountain/index?name=${encodeURIComponent(item.name||'山头资料')}&local=1`})
    }}><View className='places-card-top'><View className='places-card-art'><Text>▲</Text></View><View className='places-card-info'><View className='places-card-title'><Text className='places-card-name'>{item.name||'名称待定'}</Text>{item.heatTier&&<Text className='places-heat-tier'>{item.heatTier}</Text>}</View><Text className='subtle'>{'route_name' in item?pointBriefSubtitle(item):`${item.altitude!=null?`海拔 ${item.altitude} m`:'海拔待补充'}${item.city?` · ${item.city}`:''}`}</Text><Text className='places-card-heat'>{'route_name' in item?pointBriefHeat(item):item.origin==='catalog'?'本地山峰资料':item.annualVisits||`本周到访 ${item.visits30??0}`}</Text></View><Text className='places-card-action'>{item.code?'我到过':'›'}</Text></View><View className='places-card-foot'>{'route_name' in item&&item.route_name?`所属线路：${item.route_name}`:'routeName' in item&&item.routeName?`所属线路：${item.routeName}`:'进入点位查看资料与留言。'}</View></View>)}
    {rows.length>6&&<View className='list-pagination'><Text onClick={()=>setPage(Math.max(1,page-1))}>上一页</Text><Text>{page} / {Math.ceil(rows.length/6)}</Text><Text onClick={()=>setPage(Math.min(Math.ceil(rows.length/6),page+1))}>下一页</Text></View>}
    {!loading&&!rows.length&&<View className='places-empty'><Text className='subtle'>{segment==='junction'&&offline?'连接服务后可查看岔路点位。':'没有匹配的山头。'}</Text></View>}
  </View></View>
}
