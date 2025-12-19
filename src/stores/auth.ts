import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiRequest, ApiError } from '@/api/http'
import type { Role, User } from '@/types/domain'
import { clearToken, getToken, setToken } from '@/utils/token'

type LoginResponse = { token: string; user: User }

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(getToken())
  const user = ref<User | null>(null)
  const ready = ref(false)

  const role = computed<Role | null>(() => user.value?.role ?? null)
  const isAuthed = computed(() => !!token.value && !!user.value)

  async function init() {
    if (ready.value) return
    ready.value = true
    if (!token.value) return
    try {
      const res = await apiRequest<{ user: User }>('/api/me')
      user.value = res.user
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        token.value = ''
        user.value = null
        clearToken()
      }
    }
  }

  async function login(username: string, password: string) {
    const res = await apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    })
    token.value = res.token
    user.value = res.user
    setToken(res.token)
  }

  function logout() {
    token.value = ''
    user.value = null
    clearToken()
  }

  return { token, user, role, ready, isAuthed, init, login, logout }
})

