import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getErrorMessage, request } from '../../../services/api'
import './index.scss'

type Detail={mountainId:number;mountainName:string;role:string;points:Array<{id:number;code:string;name?:string|null;type:string;status:string}>;applications:Array<{id:number;applicantName?:string;status:string;reason?:string;intent:string}>;hidden:Array<{id:number;text:string;status:string;reason?:string|null;nickname?:string|null;pointCode?:string}>;members:Array<{userId:number;role:string;nickname?:string|null}>;audit:Array<{id:number;action:string;reason?:string|null;actor?:string|null;createdAt:string}>}
export default function ManagedDetail(){const id=Number(Taro.getCurrentInstance().router?.params?.mountainId)||0;const [data,setData]=useState<Detail|null>(null);const [error,setError]=useState('')
 const load=async()=>{setError('');try{setData(await request<Detail>(`/api/me/managed-boards/${id}`,{retryNetwork:1}))}catch(e){setError(getErrorMessage(e))}}
 useEffect(()=>{void load()},[id])
 return <View className='page managed-detail'><Text className='eyebrow'>BOARD MANAGEMENT</Text><Text className='hero-title'>{data?.mountainName||'山头管理'}</Text>{error&&<View className='card'>{error}<Text onClick={load}>　重试</Text></View>}{!data&&!error&&<View className='card'>正在读取管理资料…</View>}{data&&<>
 <View className='card'><Text className='section-label'>成员与点位</Text>{data.members.map(member=><Text className='item-text' key={member.userId}>{member.nickname||'山友'} · {member.role==='owner'?'负责人':'维护成员'}</Text>)}{data.points.map(point=><Text className='item-text' key={point.id} onClick={()=>Taro.navigateTo({url:`/pages/point/index?code=${encodeURIComponent(point.code)}&source=manual`})}>{point.name||point.code} · {point.status}</Text>)}</View>
 <View className='card'><Text className='section-label'>申请提醒</Text>{data.applications.length?data.applications.map(app=><Text className='item-text' key={app.id}>{app.applicantName||'山友'} · {app.intent==='join'?'加入申请':'维护申请'} · {app.status}{app.reason?`\n${app.reason}`:''}</Text>):<Text className='item-text'>当前没有申请。</Text>}</View>
 <View className='card'><Text className='section-label'>待核验留言</Text>{data.hidden.length?data.hidden.map(comment=><View key={comment.id}><Text className='item-text'>{comment.nickname||'山友'} · {comment.status}{comment.pointCode?` · ${comment.pointCode}`:''}</Text><Text className='item-text'>{comment.text}</Text>{comment.reason&&<Text className='subtle item-text'>处理原因：{comment.reason}</Text>}</View>):<Text className='item-text'>当前没有待核验留言。</Text>}</View>
 <View className='card'><Text className='section-label'>维护记录</Text>{data.audit.length?data.audit.map(item=><Text className='item-text' key={item.id}>{item.action} · {item.actor||'维护成员'} · {item.reason||new Date(item.createdAt).toLocaleDateString()}</Text>):<Text className='item-text'>暂无记录。</Text>}</View>
 </>}</View>
}
