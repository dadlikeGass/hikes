type CommentRequestOptions = {method:'POST';data:{text:string}}
type Sender = (path:string,options:CommentRequestOptions)=>Promise<unknown>

export async function createSegmentComment<T>(segmentId:number,text:string,send:Sender):Promise<T> {
  return await send(`/api/segments/${segmentId}/comments`,{method:'POST',data:{text:text.trim()}}) as T
}
