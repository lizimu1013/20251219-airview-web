<script setup lang="ts">
import { onMounted } from 'vue'

import { getToken } from '@/utils/token'

const FALLBACK_URL = import.meta.env.VITE_OPEN_WEBUI_URL || 'http://7.223.100.160:8080'

onMounted(async () => {
  const token = getToken()
  if (!token) {
    window.location.replace('/login')
    return
  }

  try {
    const res = await fetch('/api/openwebui/redirect', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`open-webui redirect failed: ${res.status}`)
    const data = await res.json()
    if (data?.url) {
      window.location.replace(data.url)
      return
    }
  } catch (error) {
    console.error(error)
  }

  // Replace history so browser back doesn't land on this redirect route.
  window.location.replace(FALLBACK_URL)
})
</script>

<template>
  <div />
</template>
