import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getErrorMessage, request } from '../../services/api'
import { managedBoardCounts } from '../../services/managed-boards'
import { openPlacesTab } from '../../services/tab-navigation'
import './index.scss'

type Board={mountainId:number;mountainName:string;region?:string|null;role:string;pendingComments:number;pendingApplications:number;joinApplications:number;unread:number}
export default function ManagedPage(){
 const [boards,setBoards]=useState<Board[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('')
 const load=async()=>{setLoading(true);setError('');try{setBoards(await request<Board[]>('/api/me/managed-boards',{retryNetwork:1}))}catch(e){setError(getErrorMessage(e))}finally{setLoading(false)}}
 useEffect(()=>{if(!Taro.getStorageSync('hikes.auth.token')){setLoading(false);return}void load()},[])
 return <View className='page managed-page'><Text className='eyebrow'>MOUNTAIN KEEPING</Text><Text className='hero-title'>我的维护工作</Text>
 {!Taro.getStorageSync('hikes.auth.token')&&<View className='card'><Text className='subtle'>登录后查看你获批管理的山头与待办。</Text><View className='primary action' onClick={()=>Taro.switchTab({url:'/pages/me/index'})}>前往登录</View></View>}
 {loading&&<View className='card'>正在读取维护工作…</View>}{error&&<View className='card managed-error'>{error}<Text onClick={load}>　重试</Text></View>}
 {!loading&&!error&&Taro.getStorageSync('hikes.auth.token')&&!boards.length&&<View className='card'><Text className='section-label'>还没有获批管理的山头</Text><Text className='subtle'>提交的维护申请通过后，会显示在这里。</Text><View className='secondary action' onClick={()=>openPlacesTab(options=>Taro.switchTab(options))}>浏览山头</View></View>}
 {boards.map(board=><View className='card managed-board' key={board.mountainId} onClick={()=>Taro.navigateTo({url:`/pages/managed/detail/index?mountainId=${board.mountainId}`})}><Text className='section-label'>{board.mountainName}</Text><Text className='subtle'>{board.region||'山头留言板'} · {board.role==='owner'?'负责人':'维护成员'}</Text><View className='managed-counts'>{managedBoardCounts(board).map(count=><Text key={count.label}>{count.label} {count.value}</Text>)}</View><Text className='subtle'>查看管理详情 ›</Text></View>)}
 <View className='secondary action' onClick={load}>刷新</View></View>
}
