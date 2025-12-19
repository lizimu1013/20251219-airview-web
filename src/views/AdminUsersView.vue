<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiRequest } from '@/api/http'
import type { Role, User } from '@/types/domain'

type UserRow = Pick<User, 'id' | 'username' | 'name' | 'role' | 'createdAt'>

const loading = ref(false)
const users = ref<UserRow[]>([])

const createDialog = reactive({
  visible: false,
  username: '',
  name: '',
  role: 'requester' as Role,
  password: '',
})

const editDialog = reactive({
  visible: false,
  id: '',
  username: '',
  name: '',
  role: 'requester' as Role,
  password: '',
})

async function load() {
  loading.value = true
  try {
    const res = await apiRequest<{ users: UserRow[] }>('/api/users')
    users.value = res.users
  } finally {
    loading.value = false
  }
}

function openCreate() {
  createDialog.visible = true
  createDialog.username = ''
  createDialog.name = ''
  createDialog.role = 'requester'
  createDialog.password = ''
}

async function onCreate() {
  try {
    await apiRequest<{ user: UserRow }>('/api/users', {
      method: 'POST',
      body: {
        username: createDialog.username.trim(),
        name: createDialog.name.trim(),
        role: createDialog.role,
        password: createDialog.password,
      },
    })
    ElMessage.success('已创建用户')
    createDialog.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  }
}

function openEdit(row: UserRow) {
  editDialog.visible = true
  editDialog.id = row.id
  editDialog.username = row.username
  editDialog.name = row.name
  editDialog.role = row.role
  editDialog.password = ''
}

async function onSaveEdit() {
  try {
    await apiRequest<{ user: UserRow }>(`/api/users/${editDialog.id}`, {
      method: 'PATCH',
      body: {
        name: editDialog.name.trim(),
        role: editDialog.role,
        password: editDialog.password ? editDialog.password : undefined,
      },
    })
    ElMessage.success('已保存')
    editDialog.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

onMounted(() => {
  load().catch(() => ElMessage.error('加载失败'))
})
</script>

<template>
  <div class="app-page">
    <el-card>
      <template #header>
        <div class="app-card-header">
          <div>用户管理</div>
          <el-button type="primary" @click="openCreate">新建用户</el-button>
        </div>
      </template>

      <el-table :data="users" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="用户名" width="160">
          <template #default="{ row }">
            <span class="mono">{{ row.username }}</span>
          </template>
        </el-table-column>
        <el-table-column label="姓名" min-width="160" prop="name" />
        <el-table-column label="角色" width="120" prop="role" />
        <el-table-column label="创建时间" width="180" prop="createdAt" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createDialog.visible" title="新建用户" width="520px">
      <el-form label-position="top">
        <el-form-item label="用户名（用于登录）">
          <el-input v-model="createDialog.username" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="createDialog.name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createDialog.role" style="width: 100%">
            <el-option label="requester" value="requester" />
            <el-option label="reviewer" value="reviewer" />
            <el-option label="admin" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始密码（至少 6 位）">
          <el-input v-model="createDialog.password" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-space>
          <el-button @click="createDialog.visible = false">取消</el-button>
          <el-button type="primary" @click="onCreate">创建</el-button>
        </el-space>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialog.visible" :title="`编辑用户：${editDialog.username}`" width="520px">
      <el-form label-position="top">
        <el-form-item label="姓名">
          <el-input v-model="editDialog.name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editDialog.role" style="width: 100%">
            <el-option label="requester" value="requester" />
            <el-option label="reviewer" value="reviewer" />
            <el-option label="admin" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="重置密码（可选，至少 6 位）">
          <el-input v-model="editDialog.password" type="password" show-password placeholder="留空则不修改" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-space>
          <el-button @click="editDialog.visible = false">取消</el-button>
          <el-button type="primary" @click="onSaveEdit">保存</el-button>
        </el-space>
      </template>
    </el-dialog>
  </div>
</template>

