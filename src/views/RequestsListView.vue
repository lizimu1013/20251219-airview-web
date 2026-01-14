<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useRequestsStore } from '@/stores/requests'
import RequestStatusTag from '@/components/RequestStatusTag.vue'
import { apiRequest } from '@/api/http'
import { canReview, isReviewerLike } from '@/utils/permissions'
import { formatDateTime } from '@/utils/time'
import { formatUserLabel } from '@/utils/userLabel'
import type { Category, Priority, RequestStatus, User } from '@/types/domain'

const auth = useAuthStore()
const store = useRequestsStore()
const router = useRouter()
const route = useRoute()

const me = computed(() => auth.user)
const reviewerLike = computed(() => (me.value ? isReviewerLike(me.value.role) : false))

const filters = reactive<{
  q: string
  status: RequestStatus | ''
  priority: Priority | ''
  category: Category | ''
  tag: string
  requesterId: string
}>({
  q: '',
  status: '',
  priority: '',
  category: '',
  tag: '',
  requesterId: '',
})

const statusValues: RequestStatus[] = ['Submitted', 'NeedInfo', 'Accepted', 'Suspended', 'Rejected', 'Closed']
let suppressFilterWatch = false

function normalizeStatus(value: unknown): RequestStatus | '' {
  if (typeof value !== 'string') return ''
  return statusValues.includes(value as RequestStatus) ? (value as RequestStatus) : ''
}

function applyRouteFilters() {
  suppressFilterWatch = true
  filters.status = normalizeStatus(route.query.status)
  suppressFilterWatch = false
}

const requesterOptions = ref<{ label: string; value: string }[]>([])
const implementerOptions = ref<{ label: string; value: string }[]>([])
const sortState = reactive<{
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
}>({
  sortBy: 'createdAt',
  sortOrder: 'desc',
})

function onSortChange(args: { prop: string; order: 'ascending' | 'descending' | null }) {
  const allowedSortBy = [
    'domain',
    'title',
    'requesterName',
    'implementerName',
    'createdAt',
    'lastActorName',
    'updatedAt',
    'status',
    'priority',
    'category',
    'tags',
  ]
  const sortBy = allowedSortBy.includes(args.prop) ? (args.prop as (typeof allowedSortBy)[number]) : 'createdAt'
  const sortOrder = args.order === 'ascending' ? 'asc' : args.order === 'descending' ? 'desc' : 'desc'
  sortState.sortBy = sortBy
  sortState.sortOrder = sortOrder
  fetchListAt(1, pageSize.value).catch(() => undefined)
}

async function loadRequesterOptions() {
  if (!reviewerLike.value) {
    requesterOptions.value = []
    implementerOptions.value = []
    return
  }
  const res = await apiRequest<{ users: Pick<User, 'id' | 'name' | 'username' | 'role'>[] }>('/api/users/options')
  const options = res.users.map((u) => ({ label: formatUserLabel(u), value: u.id }))
  requesterOptions.value = options
  implementerOptions.value = res.users
    .filter((u) => u.username !== 'admin')
    .map((u) => ({ label: formatUserLabel(u), value: u.id }))
}

const { list, total, page, pageSize, loadingList } = storeToRefs(store)
const loading = computed(() => loadingList.value)

async function fetchList() {
  await store.fetchList({
    q: filters.q || undefined,
    status: (filters.status || undefined) as RequestStatus | undefined,
    priority: (filters.priority || undefined) as Priority | undefined,
    category: (filters.category || undefined) as Category | undefined,
    tag: filters.tag || undefined,
    requesterId: reviewerLike.value ? filters.requesterId || undefined : undefined,
    sortBy: sortState.sortBy,
    sortOrder: sortState.sortOrder,
    page: page.value,
    pageSize: pageSize.value,
  })
}

async function fetchListAt(p: number, ps: number) {
  await store.fetchList({
    q: filters.q || undefined,
    status: (filters.status || undefined) as RequestStatus | undefined,
    priority: (filters.priority || undefined) as Priority | undefined,
    category: (filters.category || undefined) as Category | undefined,
    tag: filters.tag || undefined,
    requesterId: reviewerLike.value ? filters.requesterId || undefined : undefined,
    sortBy: sortState.sortBy,
    sortOrder: sortState.sortOrder,
    page: p,
    pageSize: ps,
  })
}

async function fetchListFirstPage() {
  await store.fetchList({
    q: filters.q || undefined,
    status: (filters.status || undefined) as RequestStatus | undefined,
    priority: (filters.priority || undefined) as Priority | undefined,
    category: (filters.category || undefined) as Category | undefined,
    tag: filters.tag || undefined,
    requesterId: reviewerLike.value ? filters.requesterId || undefined : undefined,
    sortBy: sortState.sortBy,
    sortOrder: sortState.sortOrder,
    page: 1,
    pageSize: pageSize.value,
  })
}

function onReset() {
  filters.q = ''
  filters.status = ''
  filters.priority = ''
  filters.category = ''
  filters.tag = ''
  filters.requesterId = ''
  sortState.sortBy = 'createdAt'
  sortState.sortOrder = 'desc'
  fetchListAt(1, pageSize.value).catch(() => undefined)
}

function view(id: string) {
  router.push(`/requests/${id}`)
}

function onCreate() {
  router.push('/requests/new')
}

function onRowDblClick(row: { id: string }) {
  view(row.id)
}

function onPageChange(p: number) {
  fetchListAt(p, pageSize.value).catch(() => undefined)
}

function onSizeChange(s: number) {
  fetchListAt(1, s).catch(() => undefined)
}

function copyId(id: string) {
  navigator.clipboard
    .writeText(id)
    .then(() => ElMessage.success('已复制 ID'))
    .catch(() => ElMessage.error('复制失败'))
}

const statusDialog = reactive<{
  visible: boolean
  requestId: string
  toStatus: RequestStatus | ''
  reason: string
  suspendUntil: string
  suspendCondition: string
  implementerId: string
}>({
  visible: false,
  requestId: '',
  toStatus: '',
  reason: '',
  suspendUntil: '',
  suspendCondition: '',
  implementerId: '',
})

function openStatusDialog(requestId: string, toStatus: RequestStatus, implementerId?: string) {
  statusDialog.visible = true
  statusDialog.requestId = requestId
  statusDialog.toStatus = toStatus
  statusDialog.reason = ''
  statusDialog.suspendUntil = ''
  statusDialog.suspendCondition = ''
  statusDialog.implementerId = toStatus === 'Accepted' ? implementerId ?? '' : ''
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

function reviewActionsFor(row: { status: RequestStatus }) {
  const s = row.status
  return {
    accept: s === 'Submitted' || s === 'NeedInfo' || s === 'Suspended',
    suspend: s === 'Submitted' || s === 'NeedInfo',
    reject: s === 'Submitted' || s === 'NeedInfo' || s === 'Suspended',
    needInfo: s === 'Submitted',
    close: s === 'Accepted',
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

async function onConfirmStatus() {
  if (!statusDialog.requestId || !statusDialog.toStatus) return
  const toStatus = statusDialog.toStatus

  if (!statusDialog.reason.trim()) {
    ElMessage.error('原因/处理意见不能为空')
    return
  }
  if (toStatus === 'Accepted' && !statusDialog.implementerId) {
    ElMessage.error('请选择实施人')
    return
  }
  if (toStatus === 'Suspended') {
    const hasUntil = !!statusDialog.suspendUntil.trim()
    const hasCond = !!statusDialog.suspendCondition.trim()
    if (!hasUntil && !hasCond) {
      ElMessage.error('挂起需提供复审时间或复审条件（至少一个）')
      return
    }
  }

  if (toStatus === 'Rejected' || toStatus === 'Suspended') {
    await ElMessageBox.confirm('该操作将产生审计记录且不可直接撤销，是否继续？', statusTitle(toStatus), {
      type: 'warning',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
    })
  }

  try {
    await store.changeStatus(statusDialog.requestId, {
      toStatus,
      reason: statusDialog.reason,
      suspendUntil: statusDialog.suspendUntil || undefined,
      suspendCondition: statusDialog.suspendCondition || undefined,
      implementerId: statusDialog.implementerId || undefined,
    })
    ElMessage.success('已更新状态')
    statusDialog.visible = false
    await fetchList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

let searchTimer: number | undefined
watch(
  () => ({ ...filters }),
  () => {
    if (suppressFilterWatch) return
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      fetchListFirstPage().catch(() => undefined)
    }, 250)
  },
  { deep: true },
)

watch(
  () => route.query.status,
  () => {
    applyRouteFilters()
    fetchListFirstPage().catch(() => undefined)
  },
)

watch(reviewerLike, () => {
  loadRequesterOptions().catch(() => undefined)
})

onMounted(() => {
  applyRouteFilters()
  loadRequesterOptions().catch(() => undefined)
  fetchList().catch(() => undefined)
})
</script>

<template>
  <div class="app-page">
    <el-card>
      <template #header>
        <div class="app-card-header">
          <div>需求列表</div>
          <el-button type="primary" @click="onCreate">新建需求</el-button>
        </div>
      </template>

      <el-form :inline="true" label-width="84px" class="filters">
        <el-form-item label="关键字">
          <el-input v-model="filters.q" placeholder="标题/描述" clearable style="width: 240px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable style="width: 160px">
            <el-option label="待评审" value="Submitted" />
            <el-option label="待补充" value="NeedInfo" />
            <el-option label="已接纳" value="Accepted" />
            <el-option label="已挂起" value="Suspended" />
            <el-option label="已拒绝" value="Rejected" />
            <el-option label="已关闭" value="Closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="filters.priority" clearable style="width: 120px">
            <el-option label="P0" value="P0" />
            <el-option label="P1" value="P1" />
            <el-option label="P2" value="P2" />
            <el-option label="P3" value="P3" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="filters.category" clearable style="width: 120px">
            <el-option label="功能" value="功能" />
            <el-option label="优化" value="优化" />
            <el-option label="缺陷" value="缺陷" />
            <el-option label="咨询" value="咨询" />
            <el-option label="性能" value="性能" />
            <el-option label="AI" value="AI" />
            <el-option label="精度" value="精度" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="filters.tag" placeholder="精确匹配" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item v-if="reviewerLike" label="提交者">
          <el-select v-model="filters.requesterId" clearable style="width: 180px">
            <el-option v-for="o in requesterOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table
        :data="list"
        v-loading="loading"
        stripe
        style="width: 100%"
        :default-sort="{ prop: 'createdAt', order: 'descending' }"
        @row-dblclick="onRowDblClick"
        @sort-change="onSortChange"
      >
        <el-table-column label="领域" prop="domain" sortable="custom" width="120">
          <template #default="{ row }">{{ row.domain ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="标题" prop="title" sortable="custom" min-width="280">
          <template #default="{ row }">
            <div class="title-cell">
              <a class="title-link" @click.prevent="view(row.id)">{{ row.title }}</a>
              <div class="meta text-muted">
                <span class="mono" @click="copyId(row.id)" style="cursor: pointer">#{{ row.id }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="接口人" prop="contactPerson" sortable="custom" width="140">
          <template #default="{ row }">{{ row.contactPerson ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="实施人" prop="implementerName" sortable="custom" width="220">
          <template #default="{ row }">
            {{ formatUserLabel({ name: row.implementerName, username: row.implementerUsername }) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="创建时间" prop="createdAt" sortable="custom" width="150">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="最后修改人" prop="lastActorName" sortable="custom" width="220">
          <template #default="{ row }">
            {{ formatUserLabel({ name: row.lastActorName, username: row.lastActorUsername }) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="最后修改时间" prop="updatedAt" sortable="custom" width="150">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" prop="status" sortable="custom" width="110">
          <template #default="{ row }"><RequestStatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="优先级" prop="priority" sortable="custom" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.priority" effect="plain" size="small" :style="priorityStyle(row.priority)">
              {{ row.priority }}
            </el-tag>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="分类" prop="category" sortable="custom" width="90">
          <template #default="{ row }">{{ row.category ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="标签" prop="tags" sortable="custom" min-width="180">
          <template #default="{ row }">
            <el-space wrap>
              <el-tag v-for="t in row.tags" :key="t" type="info" effect="plain">{{ t }}</el-tag>
              <span v-if="!row.tags?.length" class="text-muted">-</span>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-space :size="8" wrap>
              <el-button size="small" @click="view(row.id)">详情</el-button>
              <template v-if="me && canReview(me)">
                <el-button
                  v-if="reviewActionsFor(row).accept"
                  size="small"
                  type="success"
                  plain
                  @click="openStatusDialog(row.id, 'Accepted', row.implementerId)"
                >
                  接纳
                </el-button>
                <el-button
                  v-if="reviewActionsFor(row).suspend"
                  size="small"
                  type="warning"
                  plain
                  @click="openStatusDialog(row.id, 'Suspended')"
                >
                  挂起
                </el-button>
                <el-button
                  v-if="reviewActionsFor(row).reject"
                  size="small"
                  type="danger"
                  plain
                  @click="openStatusDialog(row.id, 'Rejected')"
                >
                  拒绝
                </el-button>
                <el-button v-if="reviewActionsFor(row).needInfo" size="small" plain @click="openStatusDialog(row.id, 'NeedInfo')">
                  待补充
                </el-button>
                <el-button v-if="reviewActionsFor(row).close" size="small" plain @click="openStatusDialog(row.id, 'Closed')">
                  关闭
                </el-button>
              </template>
            </el-space>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          :page-sizes="[10, 20, 50]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </el-card>

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
  </div>
</template>

<style scoped>
.filters {
  margin-bottom: 10px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
.title-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.title-link {
  color: #303133;
  text-decoration: none;
  font-weight: 600;
}
.title-link:hover {
  color: #409eff;
}
.meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
}
</style>
