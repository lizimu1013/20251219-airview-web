<script setup lang="ts">
import { computed, onMounted, reactive, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useRequestsStore } from '@/stores/requests'
import { canEditRequest } from '@/utils/permissions'
import type { Category, Priority, RequestItem } from '@/types/domain'

const auth = useAuthStore()
const store = useRequestsStore()
const route = useRoute()
const router = useRouter()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const isEdit = computed(() => !!id.value)

const source = computed<RequestItem | null>(() => {
  if (!isEdit.value) return null
  if (!store.current) return null
  if (store.current.id !== id.value) return null
  return store.current
})

const form = reactive({
  title: '',
  description: '',
  why: '',
  acceptanceCriteria: '',
  category: '' as Category | '',
  priority: '' as Priority | '',
  tagsText: '',
  linksText: '',
  impactScope: '',
})

const formRef = ref()

const canEdit = computed(() => {
  const user = auth.user
  if (!user) return false
  if (!isEdit.value) return true
  if (!source.value) return false
  return canEditRequest(user, source.value)
})

watchEffect(() => {
  if (!source.value) return
  form.title = source.value.title
  form.description = source.value.description
  form.why = source.value.why
  form.acceptanceCriteria = source.value.acceptanceCriteria ?? ''
  form.category = (source.value.category ?? '') as Category | ''
  form.priority = (source.value.priority ?? '') as Priority | ''
  form.tagsText = (source.value.tags ?? []).join(', ')
  form.linksText = (source.value.links ?? []).join('\n')
  form.impactScope = source.value.impactScope ?? ''
})

const rules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  description: [{ required: true, message: '请输入需求描述', trigger: 'blur' }],
  why: [{ required: true, message: '请输入期望价值/收益（Why）', trigger: 'blur' }],
}

function parseTags(text: string) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function parseLinks(text: string) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
}

async function onSubmit() {
  const user = auth.user
  if (!user) return
  if (!canEdit.value) {
    ElMessage.error('无权限编辑该需求')
    return
  }

  await formRef.value?.validate?.()

  const payload = {
    title: form.title,
    description: form.description,
    why: form.why,
    acceptanceCriteria: form.acceptanceCriteria || undefined,
    category: (form.category || undefined) as Category | undefined,
    priority: (form.priority || undefined) as Priority | undefined,
    tags: parseTags(form.tagsText),
    links: parseLinks(form.linksText),
    impactScope: form.impactScope || undefined,
  }

  if (!isEdit.value) {
    try {
      const newId = await store.create(payload)
      ElMessage.success('已提交需求（待评审）')
      router.replace(`/requests/${newId}`)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '提交失败')
    }
    return
  }

  if (!source.value) return
  try {
    await store.update(source.value.id, payload)
    ElMessage.success('已保存')
    router.replace(`/requests/${source.value.id}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

function onCancel() {
  if (isEdit.value && id.value) router.push(`/requests/${id.value}`)
  else router.push('/requests')
}

onMounted(() => {
  if (!isEdit.value) return
  store.fetchDetail(id.value).catch(() => ElMessage.error('加载失败'))
})
</script>

<template>
  <div class="app-page">
    <el-card>
      <template #header>
        <div class="app-card-header">
          <div>{{ isEdit ? '编辑需求' : '新建需求' }}</div>
          <el-space>
            <el-button @click="onCancel">返回</el-button>
          </el-space>
        </div>
      </template>

      <el-alert v-if="isEdit && !canEdit" type="warning" show-icon title="当前状态或权限不允许编辑该需求" />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" :disabled="isEdit && !canEdit">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="120" show-word-limit />
        </el-form-item>

        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="分类">
              <el-select v-model="form.category" clearable placeholder="可选">
                <el-option label="功能" value="功能" />
                <el-option label="优化" value="优化" />
                <el-option label="缺陷" value="缺陷" />
                <el-option label="咨询" value="咨询" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="优先级">
              <el-select v-model="form.priority" clearable placeholder="可选">
                <el-option label="P0" value="P0" />
                <el-option label="P1" value="P1" />
                <el-option label="P2" value="P2" />
                <el-option label="P3" value="P3" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="标签（逗号分隔）">
              <el-input v-model="form.tagsText" placeholder="例如：MVP, 列表, 体验" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="需求描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="8" placeholder="建议描述现状/目标/交互/边界" />
        </el-form-item>

        <el-form-item label="期望价值/收益（Why）" prop="why">
          <el-input v-model="form.why" type="textarea" :rows="3" />
        </el-form-item>

        <el-form-item label="验收标准（可选）">
          <el-input v-model="form.acceptanceCriteria" type="textarea" :rows="4" />
        </el-form-item>

        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="相关链接（每行一个，可选）">
              <el-input v-model="form.linksText" type="textarea" :rows="4" placeholder="PRD/截图/工单/文档等" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="影响范围/受影响用户（可选）">
              <el-input v-model="form.impactScope" type="textarea" :rows="4" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item>
          <el-space>
            <el-button type="primary" @click="onSubmit">{{ isEdit ? '保存' : '提交需求' }}</el-button>
            <el-button @click="onCancel">取消</el-button>
          </el-space>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
