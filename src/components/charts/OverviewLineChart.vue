<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import type { EChartsOption } from 'echarts'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

type LineSeries = {
  name: string
  data: number[]
  color?: string
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: LineSeries[]
    height?: number | string
  }>(),
  { height: 320 },
)

const rootEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const heightStyle = computed(() => (typeof props.height === 'number' ? `${props.height}px` : props.height))

function withAlpha(color: string, alpha: number) {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  if (hex.length !== 6) return color
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return color
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildOption(): EChartsOption {
  const fallbackColors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399']

  const series = props.series.map((s, idx) => {
    const color = s.color ?? fallbackColors[idx % fallbackColors.length]
    return {
      name: s.name,
      type: 'line' as const,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: withAlpha(color, 0.2) },
          { offset: 1, color: withAlpha(color, 0.02) },
        ]),
      },
      data: s.data,
    }
  })

  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
    legend: { show: props.series.length > 1, top: 0 },
    grid: { left: 12, right: 18, top: props.series.length > 1 ? 26 : 14, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#E4E7ED' } },
      axisLabel: { color: '#606266' },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#606266' },
      splitLine: { lineStyle: { color: '#EBEEF5' } },
    },
    series,
  }
}

function render() {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

onMounted(() => {
  if (!rootEl.value) return
  chart = echarts.init(rootEl.value)
  render()
})

useResizeObserver(rootEl, () => chart?.resize())

watch(
  () => [props.labels, props.series],
  () => render(),
  { deep: true },
)

onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="rootEl" class="chart" :style="{ height: heightStyle }" />
</template>

<style scoped>
.chart {
  width: 100%;
}
</style>
