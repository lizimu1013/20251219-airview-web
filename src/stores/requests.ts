import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiRequest } from '@/api/http'
import type { Category, CommentItem, Priority, RequestItem, RequestStatus, AuditLogItem, AttachmentItem } from '@/types/domain'

export type RequestsQuery = Partial<{
  q: string
  status: RequestStatus
  priority: Priority
  category: Category
  domain: string
  contactPerson: string
  tag: string
  requesterId: string
  implementerId: string
  sortBy:
    | 'domain'
    | 'title'
    | 'requesterName'
    | 'implementerName'
    | 'createdAt'
    | 'lastActorName'
    | 'updatedAt'
    | 'status'
    | 'priority'
    | 'category'
    | 'tags'
  sortOrder: 'asc' | 'desc'
  page: number
  pageSize: number
}>

type RequestsListResponse = {
  list: RequestItem[]
  total: number
  page: number
  pageSize: number
}

type RequestDetailResponse = {
  request: RequestItem
  comments: CommentItem[]
  auditLogs: AuditLogItem[]
  attachments: AttachmentItem[]
}

export const useRequestsStore = defineStore('requests', () => {
  const list = ref<RequestItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(10)
  const loadingList = ref(false)

  const current = ref<RequestItem | null>(null)
  const comments = ref<CommentItem[]>([])
  const auditLogs = ref<AuditLogItem[]>([])
  const attachments = ref<AttachmentItem[]>([])
  const loadingDetail = ref(false)

  const summary = ref({
    total: 0,
    Submitted: 0,
    NeedInfo: 0,
    Accepted: 0,
    Suspended: 0,
    Rejected: 0,
    Closed: 0,
  })

  const byId = computed(() => {
    const map = new Map<string, RequestItem>()
    for (const r of list.value) map.set(r.id, r)
    if (current.value) map.set(current.value.id, current.value)
    return map
  })

  async function fetchList(query: RequestsQuery) {
    loadingList.value = true
    try {
      const search = new URLSearchParams()
      if (query.q) search.set('q', query.q)
      if (query.status) search.set('status', query.status)
      if (query.priority) search.set('priority', query.priority)
      if (query.category) search.set('category', query.category)
      if (query.domain) search.set('domain', query.domain)
      if (query.contactPerson) search.set('contactPerson', query.contactPerson)
      if (query.tag) search.set('tag', query.tag)
      if (query.requesterId) search.set('requesterId', query.requesterId)
      if (query.implementerId) search.set('implementerId', query.implementerId)
      if (query.sortBy) search.set('sortBy', query.sortBy)
      if (query.sortOrder) search.set('sortOrder', query.sortOrder)
      search.set('page', String(query.page ?? page.value))
      search.set('pageSize', String(query.pageSize ?? pageSize.value))

      const res = await apiRequest<RequestsListResponse>(`/api/requests?${search.toString()}`)
      list.value = res.list
      total.value = res.total
      page.value = res.page
      pageSize.value = res.pageSize
    } finally {
      loadingList.value = false
    }
  }

  async function fetchDetail(id: string) {
    loadingDetail.value = true
    try {
      const res = await apiRequest<RequestDetailResponse>(`/api/requests/${id}`)
      current.value = res.request
      comments.value = res.comments
      auditLogs.value = res.auditLogs
      attachments.value = res.attachments
    } finally {
      loadingDetail.value = false
    }
  }

  async function create(payload: {
    title: string
    description: string
    why: string
    acceptanceCriteria?: string
    category?: Category
    domain?: string
    contactPerson?: string
    deliveryMode?: string
    priority?: Priority
    tags?: string[]
    links?: string[]
    impactScope?: string
  }) {
    const res = await apiRequest<{ id: string }>('/api/requests', { method: 'POST', body: payload })
    return res.id
  }

  async function update(id: string, payload: Partial<RequestItem>) {
    await apiRequest<{ ok: true }>(`/api/requests/${id}`, { method: 'PATCH', body: payload })
  }

  async function addComment(requestId: string, content: string) {
    await apiRequest<{ ok: true }>(`/api/requests/${requestId}/comments`, { method: 'POST', body: { content } })
    await fetchDetail(requestId)
  }

  async function deleteComment(requestId: string, commentId: string) {
    await apiRequest<{ ok: true }>(`/api/requests/${requestId}/comments/${commentId}`, { method: 'DELETE' })
    await fetchDetail(requestId)
  }

  async function changeStatus(
    requestId: string,
    payload: { toStatus: RequestStatus; reason: string; suspendUntil?: string; suspendCondition?: string; implementerId?: string },
  ) {
    await apiRequest<{ ok: true }>(`/api/requests/${requestId}/status`, { method: 'POST', body: payload })
    await fetchDetail(requestId)
  }

  async function resubmit(requestId: string, note: string) {
    await apiRequest<{ ok: true }>(`/api/requests/${requestId}/resubmit`, { method: 'POST', body: { note } })
    await fetchDetail(requestId)
  }

  async function deleteRequest(requestId: string) {
    await apiRequest<{ ok: true }>(`/api/requests/${requestId}`, { method: 'DELETE' })
    if (current.value?.id === requestId) {
      current.value = null
      comments.value = []
      auditLogs.value = []
      attachments.value = []
    }
    if (list.value.length) {
      const next = list.value.filter((item) => item.id !== requestId)
      if (next.length !== list.value.length) {
        list.value = next
        total.value = Math.max(0, total.value - 1)
      }
    }
  }

  async function uploadAttachment(requestId: string, file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await apiRequest<AttachmentItem>(`/api/requests/${requestId}/attachments`, { method: 'POST', body: form })
    attachments.value = [res, ...attachments.value]
    return res
  }

  function setSummary(next: typeof summary.value) {
    summary.value = next
  }

  return {
    list,
    total,
    page,
    pageSize,
    loadingList,
    current,
    comments,
    auditLogs,
    attachments,
    loadingDetail,
    summary,
    byId,
    fetchList,
    fetchDetail,
    create,
    update,
    addComment,
    deleteComment,
    changeStatus,
    resubmit,
    deleteRequest,
    uploadAttachment,
    setSummary,
  }
})
