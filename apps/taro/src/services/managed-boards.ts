export type ManagedBoardCountsInput={pendingComments:number;pendingApplications:number;unread:number}
export type ManagedBoardCount={label:string;value:number}

export function managedBoardCounts(board:ManagedBoardCountsInput):ManagedBoardCount[] {
  return [
    {label:'待核验留言',value:board.pendingComments},
    {label:'待办申请',value:board.pendingApplications},
    {label:'新留言',value:board.unread}
  ]
}
