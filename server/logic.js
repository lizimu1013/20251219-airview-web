export function isReviewerLike(role) {
  return role === 'reviewer' || role === 'admin'
}

export function canViewRequest(user, req) {
  void user
  void req
  return true
}

export function canEditRequest(user, req) {
  if (isReviewerLike(user.role)) return true
  const editable = req.status === 'Submitted' || req.status === 'NeedInfo'
  return req.requesterId === user.id && editable
}

export function canReview(user) {
  return isReviewerLike(user.role)
}

export function isTransitionAllowed(from, to) {
  const allowed = {
    Submitted: ['NeedInfo', 'Accepted', 'Suspended', 'Rejected'],
    NeedInfo: ['Accepted', 'Suspended', 'Rejected'],
    Accepted: ['Closed'],
    Suspended: ['Accepted', 'Rejected'],
    Rejected: [],
    Closed: [],
  }
  return (allowed[from] || []).includes(to)
}
