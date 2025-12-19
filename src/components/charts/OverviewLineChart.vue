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
let rafId = 0
let enterRaf = 0
let hasSetInitial = false
const ENTER_DURATION = 400

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
  const showSymbols = props.labels.length <= 31

  const series = props.series.map((s, idx) => {
    const color = s.color ?? fallbackColors[idx % fallbackColors.length]
    return {
      name: s.name,
      type: 'line' as const,
      smooth: true,
      showSymbol: showSymbols,
      symbol: 'circle',
      symbolSize: 6,
      animationDuration: 1400,
      animationEasing: 'cubicOut' as const,
      animationDelay: (dataIndex: number) => dataIndex * 35 + idx * 120,
      animationDurationUpdate: 700,
      animationEasingUpdate: 'cubicOut' as const,
      animationDelayUpdate: (dataIndex: number) => dataIndex * 12 + idx * 60,
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
    animation: true,
    animationDuration: 1400,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 700,
    animationEasingUpdate: 'cubicOut' as const,
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

function playEnterAnimation(option: EChartsOption) {
  if (!chart) return
  if (enterRaf) {
    cancelAnimationFrame(enterRaf)
    enterRaf = 0
  }
  const seriesData = Array.isArray(option.series)
    ? option.series.map((s) => (Array.isArray(s.data) ? [...s.data] : []))
    : []
  const maxLen = Math.max(0, ...seriesData.map((a) => a.length))
  if (!maxLen) {
    chart.clear()
    chart.setOption(option, { notMerge: true, lazyUpdate: false })
    hasSetInitial = true
    return
  }

  const buildPartialSeries = (visibleFloat: number) =>
    Array.isArray(option.series)
      ? option.series.map((s, idx) => {
          const data = seriesData[idx]
          const lastFull = Math.floor(visibleFloat)
          const frac = visibleFloat - lastFull
          const partial = data.map((v, i) => {
            if (i < lastFull) return v
            if (i === lastFull) return v
            if (i === lastFull + 1 && frac > 0) {
              const prev = data[lastFull]
              const next = data[lastFull + 1] ?? prev
              return prev + (next - prev) * frac
            }
            return null
          })
          return { ...s, animation: false, data: partial }
        })
      : []

  chart.clear()
  chart.setOption({ ...option, animation: false, series: buildPartialSeries(0) }, { notMerge: true, lazyUpdate: false })

  const start = performance.now()
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / ENTER_DURATION)
    const eased = 1 - Math.pow(1 - progress, 2)
    const visible = eased * (maxLen - 1)
    chart?.setOption({ series: buildPartialSeries(visible) }, { notMerge: false, lazyUpdate: false })
    if (progress < 1) {
      enterRaf = requestAnimationFrame(tick)
    } else {
      chart?.setOption(option, { notMerge: true, lazyUpdate: false })
      hasSetInitial = true
      enterRaf = 0
    }
  }
  enterRaf = requestAnimationFrame(tick)
}

function render() {
  if (!chart) return
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = 0
    if (!chart) return
    chart.resize()
    const option = buildOption()
    if (!hasSetInitial) {
      playEnterAnimation(option)
      return
    }
    chart.setOption(option, { notMerge: false, lazyUpdate: false })
  })
}

onMounted(() => {
  if (!rootEl.value) return
  chart = echarts.init(rootEl.value)
  hasSetInitial = false
  render()
})

useResizeObserver(rootEl, () => chart?.resize())

watch(
  () => [props.labels, props.series],
  () => render(),
  { deep: true },
)

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (enterRaf) cancelAnimationFrame(enterRaf)
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
