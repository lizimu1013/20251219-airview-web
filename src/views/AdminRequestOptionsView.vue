<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiRequest } from '@/api/http'
import { formatDateTime } from '@/utils/time'

type OptionType = 'domain' | 'tag' | 'contact'
type OptionRow = { id: string; type: OptionType; value: string; createdAt: string }

const activeTab = ref<OptionType>('domain')
const loading = ref(false)
const options = ref<OptionRow[]>([])
const newValue = ref('')
const editingId = ref('')
const editingValue = ref('')

const tabLabel = computed(() => {
  if (activeTab.value === 'domain') return '领域'
  if (activeTab.value === 'contact') return '接口人'
  return '标签'
})

async function load() {
  loading.value = true
  try {
    const res = await apiRequest<{ options: OptionRow[] }>(`/api/admin/request-options?type=${activeTab.value}`)
    options.value = res.options ?? []
  } finally {
    loading.value = false
  }
}

function resetEditing() {
  editingId.value = ''
  editingValue.value = ''
}

async function onAdd() {
  const value = newValue.value.trim()
  if (!value) {
    ElMessage.warning(`请输入${tabLabel.value}`)
    return
  }
  try {
    await apiRequest('/api/admin/request-options', { method: 'POST', body: { type: activeTab.value, value } })
    newValue.value = ''
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '新增失败')
  }
}

function onEdit(row: OptionRow) {
  editingId.value = row.id
  editingValue.value = row.value
}

async function onSaveEdit(row: OptionRow) {
  const value = editingValue.value.trim()
  if (!value) {
    ElMessage.warning(`请输入${tabLabel.value}`)
    return
  }
  try {
    await apiRequest(`/api/admin/request-options/${row.id}`, { method: 'PATCH', body: { value } })
    resetEditing()
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

async function onDelete(row: OptionRow) {
  try {
    await ElMessageBox.confirm(`确认删除${tabLabel.value}“${row.value}”吗？`, '删除确认', { type: 'warning' })
    await apiRequest(`/api/admin/request-options/${row.id}`, { method: 'DELETE' })
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

onMounted(() => {
  load().catch(() => undefined)
})

watch(activeTab, () => {
  newValue.value = ''
  resetEditing()
  load().catch(() => undefined)
})
</script>

<template>
  <div class="app-page">
    <el-card>
      <template #header>
        <div class="app-card-header">
          <div>标签/领域/接口人管理</div>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="领域" name="domain" />
        <el-tab-pane label="接口人" name="contact" />
        <el-tab-pane label="标签" name="tag" />
      </el-tabs>

      <div class="actions">
        <el-input v-model="newValue" :placeholder="`新增${tabLabel}...`" clearable style="width: 260px" />
        <el-button type="primary" @click="onAdd">新增</el-button>
      </div>

      <el-table :data="options" v-loading="loading" stripe style="width: 100%">
        <el-table-column :label="tabLabel" min-width="200">
          <template #default="{ row }">
            <el-input v-if="editingId === row.id" v-model="editingValue" size="small" />
            <span v-else>{{ row.value }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-space>
              <el-button v-if="editingId !== row.id" size="small" @click="onEdit(row)">编辑</el-button>
              <el-button v-if="editingId === row.id" size="small" type="primary" @click="onSaveEdit(row)">保存</el-button>
              <el-button v-if="editingId === row.id" size="small" @click="resetEditing">取消</el-button>
              <el-button size="small" type="danger" plain @click="onDelete(row)">删除</el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 12px;
}
</style>
