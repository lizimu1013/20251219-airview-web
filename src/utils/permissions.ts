import type { RequestItem, Role, User } from '@/types/domain'

export function isReviewerLike(role: Role) {
  return role === 'reviewer' || role === 'admin'
}

export function canViewRequest(user: User, req: RequestItem) {
  void user
  void req
  return true
}

export function canCreateRequest(user: User) {
  return user.role === 'requester' || isReviewerLike(user.role)
}

export function canEditRequest(user: User, req: RequestItem) {
  if (isReviewerLike(user.role)) return true
  const editableStatuses: RequestItem['status'][] = ['Submitted', 'NeedInfo']
  return req.requesterId === user.id && editableStatuses.includes(req.status)
}

export function canReview(user: User) {
  return isReviewerLike(user.role)
}

export function canDeleteRequest(user: User) {
  return user.role === 'admin'
}
