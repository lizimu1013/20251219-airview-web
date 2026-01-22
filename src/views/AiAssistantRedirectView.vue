<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  // Replace history so browser back doesn't land on this redirect route.
  window.location.replace('https://ai.airview.rnd.huawei.com')
})
</script>

<template>
  <div />
</template>
