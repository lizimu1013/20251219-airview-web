<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '@/api/http'
import { formatUserLabel } from '@/utils/userLabel'
import OverviewLineChart from '@/components/charts/OverviewLineChart.vue'
import { RefreshRight } from '@element-plus/icons-vue'

type VisitPageRow = { path: string; total: number }
type VisitRoleRow = { role: string; total: number }
type VisitUserRow = { userId: string; name?: string; username?: string; role: string; total: number }
type VisitResponse = {
  range: { start: string; end: string; days: number }
  dates: string[]
  counts: number[]
  pages: VisitPageRow[]
  roles: VisitRoleRow[]
  users: VisitUserRow[]
}

const days = ref(14)
const loading = ref(false)
const trendKey = ref(0)
const dates = ref<string[]>([])
const counts = ref<number[]>([])
const pages = ref<VisitPageRow[]>([])
const roles = ref<VisitRoleRow[]>([])
const users = ref<VisitUserRow[]>([])

const totalCount = computed(() => counts.value.reduce((sum, c) => sum + c, 0))
const todayCount = computed(() => (counts.value.length ? counts.value[counts.value.length - 1] : 0))
const rangeText = computed(() => {
  if (days.value === 1) return '当日'
  if (days.value === 7) return '一周'
  if (days.value === 14) return '14 天'
  if (days.value === 30) return '30 天'
  return `近 ${days.value} 天`
})
const rangeLabel = computed(() => {
  if (!dates.value.length) return ''
  return `${dates.value[0]} ~ ${dates.value[dates.value.length - 1]}`
})
const trendLabels = computed(() => dates.value.map((d) => d.slice(5)))
const trendSeries = computed(() => [{ name: '访问量', data: counts.value, color: '#409EFF' }])

const pathLabels: Record<string, string> = {
  '/dashboard': '概览',
  '/requests': '需求列表',
  '/requests/new': '新建需求',
  '/requests/:id': '需求详情',
  '/requests/:id/edit': '编辑需求',
  '/admin/users': '用户管理',
  '/admin/visits': '访问量统计',
}

function formatPathLabel(path: string) {
  return pathLabels[path] ? `${pathLabels[path]} (${path})` : path
}

async function load() {
  loading.value = true
  try {
    const res = await apiRequest<VisitResponse>(`/api/admin/visits?days=${days.value}`)
    dates.value = res.dates ?? []
    counts.value = res.counts ?? []
    pages.value = res.pages ?? []
    roles.value = res.roles ?? []
    users.value = res.users ?? []
    trendKey.value += 1
  } finally {
    loading.value = false
  }
}

const roleLabels: Record<string, string> = {
  admin: '管理员',
  reviewer: '评审',
  requester: '提交者',
}

function formatRole(role: string) {
  return roleLabels[role] || role
}

function formatUser(row: VisitUserRow) {
  return formatUserLabel({ name: row.name, username: row.username }) || row.userId
}

onMounted(() => {
  load().catch(() => undefined)
})
</script>

<template>
  <div class="app-page">
    <el-card>
      <template #header>
        <div class="app-card-header">
          <div>访问量统计</div>
          <el-space>
            <el-select v-model="days" size="small" style="width: 120px" @change="load">
              <el-option label="当日" :value="1" />
              <el-option label="一周" :value="7" />
              <el-option label="近 14 天" :value="14" />
              <el-option label="近 30 天" :value="30" />
            </el-select>
            <el-button text size="small" @click="load">
              <el-icon><RefreshRight /></el-icon>
              刷新
            </el-button>
          </el-space>
        </div>
      </template>

      <el-row :gutter="12">
        <el-col :xs="24" :md="8">
          <el-card shadow="never" class="stat-card">
            <div class="stat-title">总访问量</div>
            <div class="stat-value">{{ totalCount }}</div>
            <div class="text-muted">{{ rangeLabel || rangeText }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :md="8">
          <el-card shadow="never" class="stat-card">
            <div class="stat-title">今日访问量</div>
            <div class="stat-value">{{ todayCount }}</div>
            <div class="text-muted">按当天累计</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :md="8">
          <el-card shadow="never" class="stat-card">
            <div class="stat-title">记录页面数</div>
            <div class="stat-value">{{ pages.length }}</div>
            <div class="text-muted">去重后的页面路径</div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :xs="24" :md="14">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>趋势</div>
              <div class="text-muted">{{ rangeLabel || rangeText }}</div>
            </div>
          </template>
          <el-skeleton v-if="loading" animated :rows="5" />
          <OverviewLineChart v-else :key="trendKey" :labels="trendLabels" :series="trendSeries" :height="280" />
        </el-card>
      </el-col>
      <el-col :xs="24" :md="10">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>页面排行</div>
              <div class="text-muted">{{ rangeText }}</div>
            </div>
          </template>
          <el-table :data="pages" size="small" stripe style="width: 100%" height="320">
            <el-table-column label="页面" min-width="220">
              <template #default="{ row }">
                <span class="mono">{{ formatPathLabel(row.path) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="访问量" width="90">
              <template #default="{ row }">{{ row.total }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :xs="24" :md="10">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>角色统计</div>
              <div class="text-muted">{{ rangeText }}</div>
            </div>
          </template>
          <el-table :data="roles" size="small" stripe style="width: 100%" height="260">
            <el-table-column label="角色" min-width="120">
              <template #default="{ row }">{{ formatRole(row.role) }}</template>
            </el-table-column>
            <el-table-column label="访问量" width="90">
              <template #default="{ row }">{{ row.total }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="14">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>用户访问排行</div>
              <div class="text-muted">{{ rangeText }}</div>
            </div>
          </template>
          <el-table :data="users" size="small" stripe style="width: 100%" height="260">
            <el-table-column label="用户" min-width="200">
              <template #default="{ row }">{{ formatUser(row) }}</template>
            </el-table-column>
            <el-table-column label="角色" width="90">
              <template #default="{ row }">{{ formatRole(row.role) }}</template>
            </el-table-column>
            <el-table-column label="访问量" width="90">
              <template #default="{ row }">{{ row.total }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.stat-card {
  border: 1px solid #ebeef5;
}
.stat-title {
  color: #606266;
  font-size: 12px;
  font-weight: 600;
}
.stat-value {
  font-size: 26px;
  font-weight: 800;
  margin: 6px 0;
}
</style>
