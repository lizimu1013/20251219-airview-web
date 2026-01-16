<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  // Replace history so browser back doesn't land on this redirect route.
  window.location.replace('http://7.223.100.160:8080')
})
</script>

<template>
  <div />
</template>
