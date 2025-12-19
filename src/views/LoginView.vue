<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import logoUrl from '@/assets/logo.svg'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  username: '',
  password: '',
  name: '',
})

const redirectTo = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'))
const isRegister = computed(() => route.query.mode === 'register')

async function onLogin() {
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success('登录成功')
    router.replace(redirectTo.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  }
}

async function onRegister() {
  try {
    await auth.register(form.username.trim(), form.password, form.name.trim())
    ElMessage.success('注册并登录成功')
    router.replace(redirectTo.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '注册失败')
  }
}

function switchMode() {
  const q = { ...route.query }
  if (isRegister.value) {
    delete q.mode
  } else {
    q.mode = 'register'
  }
  router.replace({ path: '/login', query: q })
}
</script>

<template>
  <div class="wrap">
    <div class="card">
      <div class="brand">
        <img class="brand-logo" :src="logoUrl" alt="URM" />
        <div class="title">AIRVIEW轻量化需求管理平台</div>
      </div>
      <!-- <div class="subtitle">多用户版本（后端 + 数据库）</div> -->

      <el-form label-position="top" @submit.prevent>
        <el-form-item label="工号 / 账号">
          <el-input v-model="form.username" autocomplete="username" placeholder="例如：l00826434" />
        </el-form-item>
        <el-form-item v-if="isRegister" label="姓名">
          <el-input v-model="form.name" autocomplete="name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-button v-if="!isRegister" type="primary" style="width: 100%" @click="onLogin">登录</el-button>
        <el-button v-else type="primary" style="width: 100%" @click="onRegister">注册并登录</el-button>
      </el-form>

      <div class="hint text-muted">
        <el-link type="primary" :underline="false" @click="switchMode">
          {{ isRegister ? '返回登录' : '没有账号？去注册' }}
        </el-link>
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
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.brand-logo {
  width: 34px;
  height: 34px;
  display: block;
  flex: 0 0 auto;
}
.title {
  font-size: 20px;
  font-weight: 800;
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
