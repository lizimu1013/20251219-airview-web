import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/types/domain'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'requests', name: 'requests', component: () => import('@/views/RequestsListView.vue') },
        { path: 'requests/new', name: 'request-new', component: () => import('@/views/RequestFormView.vue') },
        { path: 'requests/:id', name: 'request-detail', component: () => import('@/views/RequestDetailView.vue') },
        { path: 'requests/:id/edit', name: 'request-edit', component: () => import('@/views/RequestFormView.vue') },
        {
          path: 'admin/users',
          name: 'admin-users',
          component: () => import('@/views/AdminUsersView.vue'),
          meta: { roles: ['admin'] satisfies Role[] },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) await auth.init()
  const isAuthed = auth.isAuthed
  if (to.path === '/login') return true
  if (!isAuthed) return { path: '/login', query: { redirect: to.fullPath } }
  const roles = (to.meta?.roles as Role[] | undefined) ?? undefined
  if (roles?.length) {
    const role = auth.user?.role
    if (!role || !roles.includes(role)) return { path: '/requests' }
  }
  return true
})

export default router
