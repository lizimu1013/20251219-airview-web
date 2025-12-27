<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import RequestStatusTag from '@/components/RequestStatusTag.vue'
import { apiRequest } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useRequestsStore } from '@/stores/requests'
import { canEditRequest, canReview, canViewRequest, isReviewerLike } from '@/utils/permissions'
import { formatDate, formatDateTime } from '@/utils/time'
import { formatUserLabel } from '@/utils/userLabel'
import type { Priority, RequestStatus, User } from '@/types/domain'
import { getToken } from '@/utils/token'
import { ArrowLeft, Edit } from '@element-plus/icons-vue'

const auth = useAuthStore()
const store = useRequestsStore()
const route = useRoute()
const router = useRouter()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const me = computed(() => auth.user ?? null)

const req = computed(() => {
  if (!store.current) return null
  if (store.current.id !== id.value) return null
  return store.current
})

const canView = computed(() => (me.value && req.value ? canViewRequest(me.value, req.value) : false))
const canEdit = computed(() => (me.value && req.value ? canEditRequest(me.value, req.value) : false))
const reviewerLike = computed(() => (me.value ? isReviewerLike(me.value.role) : false))

const requesterName = computed(() =>
  formatUserLabel({ name: req.value?.requesterName, username: req.value?.requesterUsername }) || req.value?.requesterId || '-',
)
const reviewerName = computed(() =>
  formatUserLabel({ name: req.value?.reviewerName, username: req.value?.reviewerUsername }) || req.value?.reviewerId || '-',
)
const implementerName = computed(() =>
  formatUserLabel({ name: req.value?.implementerName, username: req.value?.implementerUsername }) || req.value?.implementerId || '-',
)

const comments = computed(() => store.comments)
const logs = computed(() => store.auditLogs)
const attachments = computed(() => store.attachments)

const commentText = ref('')
async function onAddComment() {
  if (!me.value || !req.value) return
  if (!commentText.value.trim()) return
  try {
    await store.addComment(req.value.id, commentText.value)
    commentText.value = ''
    ElMessage.success('已发表评论')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发表评论失败')
  }
}

async function onDeleteComment(commentId: string) {
  if (!req.value) return
  try {
    await ElMessageBox.confirm('确认删除该评论？', '删除评论', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await store.deleteComment(req.value.id, commentId)
    ElMessage.success('已删除评论')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

function canDeleteComment(authorId?: string) {
  if (!me.value || !authorId) return false
  return me.value.id === authorId || me.value.role === 'admin'
}

function onEdit() {
  if (!req.value) return
  router.push(`/requests/${req.value.id}/edit`)
}

const statusDialog = reactive<{
  visible: boolean
  toStatus: RequestStatus | ''
  reason: string
  suspendUntil: string
  suspendCondition: string
  implementerId: string
}>({
  visible: false,
  toStatus: '',
  reason: '',
  suspendUntil: '',
  suspendCondition: '',
  implementerId: '',
})

function openStatusDialog(toStatus: RequestStatus) {
  statusDialog.visible = true
  statusDialog.toStatus = toStatus
  statusDialog.reason = ''
  statusDialog.suspendUntil = ''
  statusDialog.suspendCondition = ''
  statusDialog.implementerId = toStatus === 'Accepted' ? req.value?.implementerId ?? '' : ''
}

function statusTitle(status: RequestStatus) {
  switch (status) {
    case 'Accepted':
      return '接纳需求'
    case 'Suspended':
      return '挂起需求'
    case 'Rejected':
      return '拒绝需求'
    case 'NeedInfo':
      return '要求补充信息'
    case 'Closed':
      return '关闭需求'
    case 'Submitted':
      return '重新进入评审'
  }
}

async function onConfirmStatus() {
  if (!me.value || !req.value) return
  const toStatus = statusDialog.toStatus
  if (!toStatus) return

  if (toStatus === 'Accepted' && !statusDialog.implementerId) {
    ElMessage.error('请选择实施人')
    return
  }

  if (toStatus === 'Rejected' || toStatus === 'Suspended') {
    await ElMessageBox.confirm('该操作将产生审计记录且不可直接撤销，是否继续？', statusTitle(toStatus), {
      type: 'warning',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
    })
  }

  try {
    if (toStatus === 'Submitted') {
      await store.resubmit(req.value.id, statusDialog.reason || '重新进入评审')
    } else {
      await store.changeStatus(req.value.id, {
        toStatus,
        reason: statusDialog.reason,
        suspendUntil: statusDialog.suspendUntil || undefined,
        suspendCondition: statusDialog.suspendCondition || undefined,
        implementerId: statusDialog.implementerId || undefined,
      })
    }
    ElMessage.success('已更新状态')
    statusDialog.visible = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

async function load() {
  if (!id.value) return
  try {
    await store.fetchDetail(id.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  }
}

watch(id, () => {
  load().catch(() => undefined)
})

watch(reviewerLike, () => {
  loadImplementerOptions().catch(() => undefined)
})

onMounted(() => {
  load().catch(() => undefined)
  loadImplementerOptions().catch(() => undefined)
})

function canResubmitToReview() {
  if (!me.value || !req.value) return false
  if (!req.value) return false
  if (req.value.status === 'NeedInfo') return req.value.requesterId === me.value.id
  if (req.value.status === 'Suspended') return reviewerLike.value
  if (req.value.status === 'Rejected') return reviewerLike.value
  return false
}

const resubmitLabel = computed(() => {
  if (!req.value) return '重新提交'
  if (req.value.status === 'NeedInfo') return '补充后重新提交'
  return '重新进入评审'
})

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let idx = 0
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx += 1
  }
  return `${v.toFixed(v >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

async function onSelectFile(ev: Event) {
  if (!req.value) return
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 200 * 1024 * 1024) {
    ElMessage.error('文件不能超过 200MB')
    input.value = ''
    return
  }
  uploading.value = true
  try {
    await store.uploadAttachment(req.value.id, file)
    ElMessage.success('上传成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function downloadAttachment(att: { id: string; filename: string }) {
  const token = getToken()
  try {
    const res = await fetch(`/api/attachments/${att.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      ElMessage.error('下载失败')
      return
    }
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = att.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  } catch {
    ElMessage.error('下载失败')
  }
}

function priorityStyle(p?: Priority | null) {
  switch (p) {
    case 'P0':
      return { color: '#b71c1c', backgroundColor: '#fdecea', borderColor: '#f5c6c4' }
    case 'P1':
      return { color: '#c05621', backgroundColor: '#fff4e5', borderColor: '#fbd38d' }
    case 'P2':
      return { color: '#2b6cb0', backgroundColor: '#ebf4ff', borderColor: '#c3dafe' }
    case 'P3':
      return { color: '#4a5568', backgroundColor: '#edf2f7', borderColor: '#e2e8f0' }
    default:
      return { color: '#909399', backgroundColor: '#f4f4f5', borderColor: '#e4e7ed' }
  }
}

const reviewActions = computed(() => {
  if (!req.value) return { accept: false, suspend: false, reject: false, needInfo: false, close: false }
  const s = req.value.status
  return {
    accept: s === 'Submitted' || s === 'NeedInfo' || s === 'Suspended',
    suspend: s === 'Submitted' || s === 'NeedInfo',
    reject: s === 'Submitted' || s === 'NeedInfo' || s === 'Suspended',
    needInfo: s === 'Submitted',
    close: s === 'Accepted',
  }
})

const implementerOptions = ref<{ label: string; value: string }[]>([])

async function loadImplementerOptions() {
  if (!reviewerLike.value) {
    implementerOptions.value = []
    return
  }
  const res = await apiRequest<{ users: Pick<User, 'id' | 'name' | 'username' | 'role'>[] }>('/api/users/options')
  implementerOptions.value = res.users
    .filter((u) => u.username !== 'admin')
    .map((u) => ({ label: formatUserLabel(u), value: u.id }))
}
</script>

<template>
  <div class="app-page" v-if="req">
    <el-alert v-if="!canView" type="error" show-icon title="无权限查看该需求" />

    <template v-else>
      <el-card>
        <template #header>
            <div class="app-card-header">
              <div class="header-title">
                <div class="title-line">
                  <div class="title">{{ req.title }}</div>
                  <RequestStatusTag :status="req.status" />
                </div>
                <div class="sub text-muted">
                  <span class="mono">#{{ req.id }}</span>
                  <span>创建：{{ formatDateTime(req.createdAt) }}</span>
                  <span>更新：{{ formatDateTime(req.updatedAt) }}</span>
                </div>
              </div>
            <el-space>
              <el-button plain @click="router.push('/requests')">
                <el-icon><ArrowLeft /></el-icon>
                返回列表
              </el-button>
              <el-button v-if="canEdit" plain type="primary" @click="onEdit">
                <el-icon><Edit /></el-icon>
                编辑
              </el-button>
              <el-divider v-if="me && canReview(me)" direction="vertical" />
              <el-space v-if="me && canReview(me)" :size="8" wrap>
                <el-button
                  v-if="reviewActions.accept"
                  size="small"
                  type="success"
                  plain
                  @click="openStatusDialog('Accepted')"
                >
                  接纳
                </el-button>
                <el-button
                  v-if="reviewActions.suspend"
                  size="small"
                  type="warning"
                  plain
                  @click="openStatusDialog('Suspended')"
                >
                  挂起
                </el-button>
                <el-button
                  v-if="reviewActions.reject"
                  size="small"
                  type="danger"
                  plain
                  @click="openStatusDialog('Rejected')"
                >
                  拒绝
                </el-button>
                <el-button v-if="reviewActions.needInfo" size="small" plain @click="openStatusDialog('NeedInfo')">待补充</el-button>
                <el-button v-if="reviewActions.close" size="small" plain @click="openStatusDialog('Closed')">关闭</el-button>
              </el-space>
              <el-button
                v-if="canResubmitToReview()"
                size="small"
                type="primary"
                plain
                @click="openStatusDialog('Submitted')"
              >
                {{ resubmitLabel }}
              </el-button>
            </el-space>
          </div>
        </template>

        <el-descriptions :column="3" border>
          <el-descriptions-item label="提交者">{{ requesterName }}</el-descriptions-item>
          <el-descriptions-item label="评审者">{{ reviewerName }}</el-descriptions-item>
          <el-descriptions-item label="实施人">{{ implementerName }}</el-descriptions-item>
          <el-descriptions-item label="优先级">
            <el-tag v-if="req.priority" effect="plain" size="small" :style="priorityStyle(req.priority)">
              {{ req.priority }}
            </el-tag>
            <span v-else class="text-muted">-</span>
          </el-descriptions-item>
          <el-descriptions-item label="分类">{{ req.category ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="标签">
            <el-space wrap>
              <el-tag v-for="t in req.tags" :key="t" type="info" effect="plain">{{ t }}</el-tag>
              <span v-if="!req.tags?.length" class="text-muted">-</span>
            </el-space>
          </el-descriptions-item>
          <el-descriptions-item label="挂起复审时间">
            {{ req.suspendUntil ? formatDate(req.suspendUntil) : '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-card shadow="never" class="review-bar">
          <template #header>
            <div class="app-card-header">
              <div>处理意见</div>
              <div v-if="reviewerName !== '-'" class="text-muted">评审：{{ reviewerName }}</div>
            </div>
          </template>
          <div class="review-note">
            <div class="text-muted">最新处理意见/原因：</div>
            <div style="white-space: pre-wrap; margin-top: 6px">{{ req.decisionReason ?? '-' }}</div>
            <div v-if="req.status === 'Suspended' && req.suspendCondition" style="margin-top: 8px">
              <div class="text-muted">复审条件：</div>
              <div style="white-space: pre-wrap; margin-top: 6px">{{ req.suspendCondition }}</div>
            </div>
          </div>
        </el-card>

        <el-divider />

        <el-row :gutter="12">
          <el-col :span="16">
            <el-card shadow="never">
              <template #header>
                <div class="section-title">需求描述</div>
              </template>
              <div style="white-space: pre-wrap">{{ req.description }}</div>
            </el-card>

            <el-card shadow="never" style="margin-top: 12px">
              <template #header>
                <div class="section-title">Why（价值/收益）</div>
              </template>
              <div style="white-space: pre-wrap">{{ req.why }}</div>
            </el-card>

            <el-card v-if="req.acceptanceCriteria" shadow="never" style="margin-top: 12px">
              <template #header>
                <div class="section-title">验收标准</div>
              </template>
              <div style="white-space: pre-wrap">{{ req.acceptanceCriteria }}</div>
            </el-card>
          </el-col>

          <el-col :span="8">
            <el-card shadow="never">
              <template #header>
                <div class="section-title">相关链接</div>
              </template>
              <el-space direction="vertical" alignment="start" style="width: 100%">
                <a v-for="l in req.links" :key="l" :href="l" target="_blank" rel="noreferrer">{{ l }}</a>
                <div v-if="!req.links?.length" class="text-muted">-</div>
              </el-space>
            </el-card>

            <el-card shadow="never" style="margin-top: 12px">
              <template #header>
                <div class="section-title">影响范围</div>
              </template>
              <div style="white-space: pre-wrap">{{ req.impactScope ?? '-' }}</div>
            </el-card>

            <el-card shadow="never" style="margin-top: 12px">
              <template #header>
                <div class="app-card-header">
                  <div class="section-title">附件（≤200MB）</div>
                  <el-button size="small" type="primary" plain :loading="uploading" @click="fileInput?.click()">
                    上传
                  </el-button>
                </div>
              </template>
              <input ref="fileInput" type="file" class="hidden-file" @change="onSelectFile" />
              <div v-if="!attachments.length" class="text-muted">暂无附件</div>
              <el-timeline v-else style="margin-top: 8px">
                <el-timeline-item v-for="a in attachments" :key="a.id" :timestamp="formatDateTime(a.createdAt)">
                  <div class="attach-line">
                    <el-link type="primary" :underline="false" @click="downloadAttachment(a)">{{ a.filename }}</el-link>
                    <span class="text-muted">· {{ formatSize(a.sizeBytes) }}</span>
                  </div>
                  <div class="text-muted" style="margin-top: 2px">
                    上传者：{{ formatUserLabel({ name: a.uploaderName, username: a.uploaderUsername }) || a.uploaderId }}
                  </div>
                </el-timeline-item>
              </el-timeline>
            </el-card>
          </el-col>
        </el-row>
      </el-card>

      <el-row :gutter="12" style="margin-top: 12px">
        <el-col :span="12">
          <el-card>
            <template #header>
              <div class="app-card-header">
                <div>评论</div>
              </div>
            </template>
            <div v-if="!comments.length" class="text-muted">暂无评论</div>
            <el-timeline v-else>
              <el-timeline-item v-for="c in comments" :key="c.id" :timestamp="formatDateTime(c.createdAt)">
                <div class="comment-header">
                  <div class="comment-author">
                    {{ formatUserLabel({ name: c.authorName, username: c.authorUsername }) || c.authorId }}
                  </div>
                  <el-button
                    v-if="canDeleteComment(c.authorId)"
                    text
                    size="small"
                    type="danger"
                    @click="onDeleteComment(c.id)"
                  >
                    删除
                  </el-button>
                </div>
                <div style="white-space: pre-wrap">{{ c.content }}</div>
              </el-timeline-item>
            </el-timeline>

            <el-divider />
            <el-input v-model="commentText" type="textarea" :rows="3" placeholder="补充信息/讨论…" />
            <div style="display: flex; justify-content: flex-end; margin-top: 8px">
              <el-button type="primary" @click="onAddComment">发表评论</el-button>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card>
            <template #header>
              <div class="app-card-header">
                <div>审计日志</div>
              </div>
            </template>
            <div v-if="!logs.length" class="text-muted">暂无日志</div>
            <el-timeline v-else>
              <el-timeline-item v-for="l in logs" :key="l.id" :timestamp="formatDateTime(l.createdAt)">
                <div class="log-line">
                  <span class="log-actor">{{ formatUserLabel({ name: l.actorName, username: l.actorUsername }) || l.actorId }}</span>
                  <span class="text-muted">·</span>
                  <span class="mono">{{ l.actionType }}</span>
                </div>
                <div v-if="l.note" style="white-space: pre-wrap">{{ l.note }}</div>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </el-col>
      </el-row>

      <el-dialog v-model="statusDialog.visible" :title="statusDialog.toStatus ? statusTitle(statusDialog.toStatus) : '变更状态'">
        <el-form label-position="top">
          <el-form-item :label="statusDialog.toStatus === 'NeedInfo' ? '需要补充的点（必填）' : '原因/处理意见（必填）'">
            <el-input v-model="statusDialog.reason" type="textarea" :rows="4" />
          </el-form-item>

          <el-form-item v-if="statusDialog.toStatus === 'Accepted'" label="实施人（可选）">
            <el-select v-model="statusDialog.implementerId" placeholder="请选择实施人" clearable filterable>
              <el-option v-for="o in implementerOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>

          <template v-if="statusDialog.toStatus === 'Suspended'">
            <el-form-item label="复审时间（可选，建议）">
              <el-date-picker v-model="statusDialog.suspendUntil" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="复审条件（可选）">
              <el-input v-model="statusDialog.suspendCondition" type="textarea" :rows="3" />
            </el-form-item>
            <el-alert type="info" show-icon title="挂起需提供复审时间或复审条件（至少一个）" />
          </template>
        </el-form>

        <template #footer>
          <el-space>
            <el-button @click="statusDialog.visible = false">取消</el-button>
            <el-button type="primary" @click="onConfirmStatus">确认</el-button>
          </el-space>
        </template>
      </el-dialog>
    </template>
  </div>

  <div class="app-page" v-else>
    <el-empty description="需求不存在" />
    <div style="display: flex; justify-content: center; margin-top: 10px">
      <el-button @click="router.push('/requests')">返回列表</el-button>
    </div>
  </div>
</template>

<style scoped>
.header-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 800;
}
.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
}
.section-title {
  font-weight: 700;
}
.comment-author {
  font-weight: 700;
}
.comment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.log-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.log-actor {
  font-weight: 700;
}
.review-bar {
  margin-top: 12px;
}
.review-note {
  padding-top: 4px;
}
.hidden-file {
  display: none;
}
.attach-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
