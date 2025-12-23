<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRequestsStore } from '@/stores/requests'
import { apiRequest } from '@/api/http'
import OverviewLineChart from '@/components/charts/OverviewLineChart.vue'
import { RefreshRight } from '@element-plus/icons-vue'
import {
  Box,
  CircleCheckFilled,
  CircleCloseFilled,
  Clock,
  EditPen,
  Finished,
  QuestionFilled,
} from '@element-plus/icons-vue'

const reqsStore = useRequestsStore()

const counts = computed(() => reqsStore.summary)

const total = computed(() => counts.value.total || 0)
const cards = computed(() => [
  { key: 'total', label: '总需求', value: counts.value.total, icon: Box, tone: 'total' as const },
  { key: 'Submitted', label: '待评审', value: counts.value.Submitted, icon: EditPen, tone: 'warning' as const },
  { key: 'NeedInfo', label: '待补充', value: counts.value.NeedInfo, icon: QuestionFilled, tone: 'info' as const },
  { key: 'Accepted', label: '已接纳', value: counts.value.Accepted, icon: CircleCheckFilled, tone: 'success' as const },
  { key: 'Suspended', label: '已挂起', value: counts.value.Suspended, icon: Clock, tone: 'warning2' as const },
  { key: 'Rejected', label: '已拒绝', value: counts.value.Rejected, icon: CircleCloseFilled, tone: 'danger' as const },
  { key: 'Closed', label: '已关闭', value: counts.value.Closed, icon: Finished, tone: 'muted' as const },
])

const distribution = computed(() => {
  const t = total.value
  const rows = [
    { key: 'Submitted', label: '待评审', value: counts.value.Submitted, color: '#E6A23C' },
    { key: 'NeedInfo', label: '待补充', value: counts.value.NeedInfo, color: '#909399' },
    { key: 'Accepted', label: '已接纳', value: counts.value.Accepted, color: '#67C23A' },
    { key: 'Suspended', label: '已挂起', value: counts.value.Suspended, color: '#F59E0B' },
    { key: 'Rejected', label: '已拒绝', value: counts.value.Rejected, color: '#F56C6C' },
    { key: 'Closed', label: '已关闭', value: counts.value.Closed, color: '#409EFF' },
  ]
  return rows.map((r) => ({ ...r, percent: t ? Math.round((r.value / t) * 100) : 0 }))
})

const trend = ref<{ dates: string[]; counts: number[] }>({ dates: [], counts: [] })
const loadingTrend = ref(false)
const trendChartKey = ref(0)

const trendRange = computed(() => {
  if (!trend.value.dates.length) return ''
  return `${trend.value.dates[0]} ~ ${trend.value.dates[trend.value.dates.length - 1]}`
})
const trendLabels = computed(() => trend.value.dates.map((d) => d.slice(5)))
const trendSeries = computed(() => [{ name: '新增需求', data: trend.value.counts, color: '#409EFF' }])
const hasTrend = computed(() => trend.value.dates.length > 0)

async function loadSummary() {
  const res = await apiRequest<{ counts: typeof reqsStore.summary }>('/api/dashboard/summary')
  reqsStore.setSummary(res.counts)
}

async function loadTrend() {
  loadingTrend.value = true
  try {
    const res = await apiRequest<{ dates: string[]; counts: number[] }>('/api/dashboard/trend?days=14')
    trend.value = res
    trendChartKey.value += 1
  } finally {
    loadingTrend.value = false
  }
}

onMounted(() => {
  loadSummary().catch(() => undefined)
  loadTrend().catch(() => undefined)
})
</script>

<template>
  <div class="app-page">
    <div class="kpi-grid">
      <el-card v-for="c in cards" :key="c.key" class="kpi-card" shadow="hover">
        <div class="kpi-card-inner" :data-tone="c.tone">
          <div class="kpi-icon">
            <el-icon :size="18"><component :is="c.icon" /></el-icon>
          </div>
          <div class="kpi-main">
            <div class="kpi-title">{{ c.label }}</div>
            <div class="kpi-value">{{ c.value }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :xs="24">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>需求趋势</div>
              <div class="trend-right">
                <div class="text-muted">{{ trendRange || '近 14 天' }}</div>
                <el-button text size="small" @click="trendChartKey += 1">
                  <el-icon><RefreshRight /></el-icon>
                  重播
                </el-button>
              </div>
            </div>
          </template>
          <el-skeleton v-if="loadingTrend" animated :rows="5" />
          <OverviewLineChart v-else-if="hasTrend" :key="trendChartKey" :labels="trendLabels" :series="trendSeries" :height="320" />
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :xs="24" :md="12">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>状态分布</div>
              <div class="text-muted">占比（%）</div>
            </div>
          </template>
          <div class="dist">
            <div v-for="r in distribution" :key="r.key" class="dist-row">
              <div class="dist-left">
                <div class="dist-label">{{ r.label }}</div>
                <div class="dist-meta text-muted">{{ r.value }} / {{ total }}</div>
              </div>
              <div class="dist-right">
                <el-progress :percentage="r.percent" :color="r.color" :stroke-width="10" :show-text="false" />
              </div>
              <div class="dist-percent mono">{{ r.percent }}%</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card>
          <template #header>
            <div class="app-card-header">
              <div>说明</div>
            </div>
          </template>
          <div class="text-muted">
            欢迎大家使用
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.kpi-card :deep(.el-card__body) {
  padding: 14px 14px;
}
.kpi-card-inner {
  display: flex;
  align-items: center;
  gap: 12px;
}
.kpi-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(64, 158, 255, 0.12);
  color: #409eff;
  flex: 0 0 auto;
}
.kpi-card-inner[data-tone='success'] .kpi-icon {
  background: rgba(103, 194, 58, 0.14);
  color: #67c23a;
}
.kpi-card-inner[data-tone='warning'] .kpi-icon {
  background: rgba(230, 162, 60, 0.16);
  color: #e6a23c;
}
.kpi-card-inner[data-tone='warning2'] .kpi-icon {
  background: rgba(245, 158, 11, 0.16);
  color: #f59e0b;
}
.kpi-card-inner[data-tone='danger'] .kpi-icon {
  background: rgba(245, 108, 108, 0.14);
  color: #f56c6c;
}
.kpi-card-inner[data-tone='muted'] .kpi-icon {
  background: rgba(144, 147, 153, 0.14);
  color: #909399;
}
.kpi-card-inner[data-tone='total'] .kpi-icon {
  background: rgba(64, 158, 255, 0.16);
  color: #409eff;
}
.kpi-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kpi-title {
  color: #606266;
  font-weight: 600;
  font-size: 13px;
}
.kpi-value {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.2px;
}
.dist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dist-row {
  display: grid;
  grid-template-columns: 140px 1fr 48px;
  align-items: center;
  gap: 10px;
}
.dist-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dist-label {
  font-weight: 700;
}
.dist-meta {
  font-size: 12px;
}
.dist-percent {
  text-align: right;
  color: #606266;
  font-size: 12px;
}
.trend-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
