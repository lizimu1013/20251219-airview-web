<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import RequestStatusTag from '@/components/RequestStatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { useRequestsStore } from '@/stores/requests'
import { canEditRequest, canReview, canViewRequest, isReviewerLike } from '@/utils/permissions'
import { formatDate, formatDateTime } from '@/utils/time'
import type { RequestStatus } from '@/types/domain'
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

const requesterName = computed(() => req.value?.requesterName ?? req.value?.requesterId ?? '-')
const reviewerName = computed(() => req.value?.reviewerName ?? req.value?.reviewerId ?? '-')

const comments = computed(() => store.comments)
const logs = computed(() => store.auditLogs)

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
}>({
  visible: false,
  toStatus: '',
  reason: '',
  suspendUntil: '',
  suspendCondition: '',
})

function openStatusDialog(toStatus: RequestStatus) {
  statusDialog.visible = true
  statusDialog.toStatus = toStatus
  statusDialog.reason = ''
  statusDialog.suspendUntil = ''
  statusDialog.suspendCondition = ''
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

onMounted(() => {
  load().catch(() => undefined)
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
          <el-descriptions-item label="优先级">{{ req.priority ?? '-' }}</el-descriptions-item>
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
                <div class="comment-author">
                  {{ c.authorName ?? c.authorId }}
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
                  <span class="log-actor">{{ l.actorName ?? l.actorId }}</span>
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
</style>
