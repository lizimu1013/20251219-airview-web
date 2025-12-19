<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  username: '',
  password: '',
})

const redirectTo = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : '/requests'))

async function onLogin() {
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success('登录成功')
    router.replace(redirectTo.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  }
}
</script>

<template>
  <div class="wrap">
    <div class="card">
      <div class="title">AIRVIEW用户需求管理平台</div>
      <!-- <div class="subtitle">多用户版本（后端 + 数据库）</div> -->

      <el-form label-position="top" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" autocomplete="username" placeholder="例如：admin" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-button type="primary" style="width: 100%" @click="onLogin">登录</el-button>
      </el-form>

      <div class="hint text-muted">
        <!-- 默认会自动种子一个管理员：<span class="mono">admin / admin123</span>（请上线前通过环境变量/用户管理修改） -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(800px 400px at 10% 10%, rgba(64, 158, 255, 0.25), transparent),
    radial-gradient(700px 500px at 90% 20%, rgba(103, 194, 58, 0.18), transparent),
    #f0f2f5;
}
.card {
  width: 420px;
  padding: 22px 22px 18px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
}
.title {
  font-size: 20px;
  font-weight: 800;
  margin-bottom: 2px;
}
.subtitle {
  font-size: 13px;
  color: #909399;
  margin-bottom: 14px;
}
.hint {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
}
</style>

