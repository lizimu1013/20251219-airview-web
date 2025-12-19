export type Role = 'requester' | 'reviewer' | 'admin'

export type RequestStatus =
  | 'Submitted'
  | 'NeedInfo'
  | 'Accepted'
  | 'Suspended'
  | 'Rejected'
  | 'Closed'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export type Category = '功能' | '优化' | '缺陷' | '咨询'

export interface User {
  id: string
  username: string
  name: string
  role: Role
  email?: string
  createdAt: string
}

export interface RequestItem {
  id: string
  title: string
  description: string
  why: string
  acceptanceCriteria?: string
  status: RequestStatus
  category?: Category
  priority?: Priority
  tags: string[]
  links: string[]
  impactScope?: string
  requesterId: string
  requesterName?: string
  reviewerId?: string
  reviewerName?: string
  decisionReason?: string
  suspendUntil?: string
  suspendCondition?: string
  createdAt: string
  updatedAt: string
}

export interface CommentItem {
  id: string
  requestId: string
  authorId: string
  authorName?: string
  content: string
  createdAt: string
}

export type AuditActionType = 'status_change' | 'edit' | 'comment' | 'create'

export interface AuditLogItem {
  id: string
  requestId: string
  actorId: string
  actorName?: string
  actionType: AuditActionType
  fromValue?: unknown
  toValue?: unknown
  note?: string
  createdAt: string
}
