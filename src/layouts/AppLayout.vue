<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import logoUrl from '@/assets/Snipaste_2025-12-22_21-40-14.png'
import { ChatDotRound, DataAnalysis, House, List, Plus, Setting, SwitchButton, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { formatUserLabel } from '@/utils/userLabel'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const collapsed = ref(false)
const activeMenu = computed(() => {
  if (route.path.startsWith('/requests')) return '/requests'
  if (route.path.startsWith('/ai-assistant')) return '/ai-assistant'
  if (route.path.startsWith('/admin/visits')) return '/admin/visits'
  if (route.path.startsWith('/admin/request-options')) return '/admin/request-options'
  if (route.path.startsWith('/admin')) return '/admin/users'
  return route.path
})
const userLabel = computed(() => formatUserLabel(auth.user))

function go(path: string) {
  router.push(path)
}

function onLogout() {
  auth.logout()
  ElMessage.success('已退出')
  window.location.replace('/api/sso/logout?redirect=/login?manual=1')
}
</script>

<template>
  <el-container style="height: 100%">
    <el-aside :width="collapsed ? '64px' : '210px'" class="aside">
      <div class="logo" :data-collapsed="collapsed" @click="go('/requests')">
        <img class="logo-img" :src="logoUrl" alt="URM" />
        <span class="logo-text" v-if="!collapsed">AIRVIEW</span>
      </div>
      <el-menu :default-active="activeMenu" class="menu" :collapse="collapsed" router>
        <el-menu-item index="/dashboard">
          <el-icon><House /></el-icon>
          <span>概览</span>
        </el-menu-item>
        <el-menu-item index="/requests">
          <el-icon><List /></el-icon>
          <span>需求列表</span>
        </el-menu-item>
        <el-menu-item index="/requests/new">
          <el-icon><Plus /></el-icon>
          <span>新建需求</span>
        </el-menu-item>
        <el-menu-item index="/ai-assistant">
          <el-icon><ChatDotRound /></el-icon>
          <span>AI助手</span>
        </el-menu-item>
        <el-menu-item v-if="auth.user?.role === 'admin'" index="/admin/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item v-if="auth.user?.role === 'admin'" index="/admin/visits">
          <el-icon><DataAnalysis /></el-icon>
          <span>访问量统计</span>
        </el-menu-item>
        <el-menu-item v-if="auth.user?.role === 'admin'" index="/admin/request-options">
          <el-icon><Setting /></el-icon>
          <span>标签/领域</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button text @click="collapsed = !collapsed">
            <el-icon><List /></el-icon>
          </el-button>
          <div class="breadcrumb">
            <el-breadcrumb separator="/">
              <el-breadcrumb-item>AIRVIEW需求管理平台</el-breadcrumb-item>
              <el-breadcrumb-item v-if="route.name === 'dashboard'">概览</el-breadcrumb-item>
              <el-breadcrumb-item v-else-if="route.path.startsWith('/requests')">需求</el-breadcrumb-item>
              <el-breadcrumb-item v-else-if="route.name === 'admin-users'">用户管理</el-breadcrumb-item>
              <el-breadcrumb-item v-else-if="route.name === 'admin-visits'">访问量统计</el-breadcrumb-item>
              <el-breadcrumb-item v-else-if="route.name === 'admin-request-options'">标签/领域</el-breadcrumb-item>
            </el-breadcrumb>
          </div>
        </div>

        <div class="header-right">
          <el-tag v-if="auth.user" type="info" effect="plain">
            {{ userLabel }}
          </el-tag>
          <el-button text @click="onLogout">
            <el-icon><SwitchButton /></el-icon>
            退出
          </el-button>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.aside {
  background: #001529;
  color: #fff;
  transition: width 0.2s ease;
}
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.logo[data-collapsed='true'] {
  justify-content: center;
  padding: 0;
}
.logo-img {
  width: 28px;
  height: 28px;
  display: block;
  flex: 0 0 auto;
}
.logo-text {
  letter-spacing: 0.5px;
}
.menu {
  border-right: none;
  background: transparent;
}
.menu :deep(.el-menu-item) {
  color: rgba(255, 255, 255, 0.85);
}
.menu :deep(.el-menu-item .el-icon) {
  color: inherit;
}
.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}
.menu :deep(.el-menu-item.is-active) {
  color: #fff;
  background: rgba(64, 158, 255, 0.18);
}
.menu :deep(.el-menu-item.is-active:hover) {
  background: rgba(64, 158, 255, 0.22);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.breadcrumb {
  padding-left: 4px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.main {
  padding: 0;
}
</style>
