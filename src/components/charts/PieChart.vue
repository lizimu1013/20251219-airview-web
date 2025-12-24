<template>
  <div :class="className" :style="{ height, width }" />
</template>

<script lang="ts">
import * as echarts from 'echarts'
import 'echarts/theme/macarons'
import { defineComponent } from 'vue'

type PieDatum = {
  value: number
  name: string
  itemStyle?: { color?: string }
}

export default defineComponent({
  name: 'PieChart',
  props: {
    className: { type: String, default: 'chart' },
    width: { type: String, default: '100%' },
    height: { type: String, default: '300px' },
    data: { type: Array as () => PieDatum[], default: () => [] },
    title: { type: String, default: '状态分布' },
  },
  data() {
    return {
      chart: null as echarts.ECharts | null,
    }
  },
  mounted() {
    this.$nextTick(() => {
      this.initChart()
    })
  },
  beforeUnmount() {
    if (this.chart) {
      this.chart.dispose()
      this.chart = null
    }
  },
  watch: {
    data: {
      deep: true,
      handler() {
        this.setOptions()
      },
    },
  },
  methods: {
    initChart() {
      this.chart = echarts.init(this.$el as HTMLDivElement, 'macarons')
      this.setOptions()
    },
    setOptions() {
      if (!this.chart) return
      this.chart.setOption({
        tooltip: {
          trigger: 'item',
          formatter: '{b} : {c} ({d}%)',
        },
        legend: {
          left: 'center',
          bottom: '10',
          data: this.data.map((item) => item.name),
        },
        series: [
          {
            name: this.title,
            type: 'pie',
            roseType: 'radius',
            radius: [15, 95],
            center: ['50%', '38%'],
            data: this.data,
            animationEasing: 'cubicInOut',
            animationDuration: 2600,
          },
        ],
      })
    },
  },
})
</script>
