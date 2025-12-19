<script setup lang="ts">
import { computed } from 'vue'
import type { RequestStatus } from '@/types/domain'

const props = defineProps<{ status: RequestStatus }>()

const tagType = computed(() => {
  switch (props.status) {
    case 'Submitted':
      return 'warning'
    case 'NeedInfo':
      return 'info'
    case 'Accepted':
      return 'success'
    case 'Suspended':
      return 'warning'
    case 'Rejected':
      return 'danger'
    case 'Closed':
      return ''
  }
})

const label = computed(() => {
  switch (props.status) {
    case 'Submitted':
      return '待评审'
    case 'NeedInfo':
      return '待补充'
    case 'Accepted':
      return '已接纳'
    case 'Suspended':
      return '已挂起'
    case 'Rejected':
      return '已拒绝'
    case 'Closed':
      return '已关闭'
  }
})
</script>

<template>
  <el-tag :type="tagType" effect="plain">{{ label }}</el-tag>
</template>

