<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, addExpense, updateExpense } from '../db';
import {
  uid,
  compressImage,
  toLocalInput,
  fromLocalInput,
  expenseCategoryOptions,
} from '../utils';
import type { MoveTask, ExpenseCategory } from '../types';

const route = useRoute();
const router = useRouter();
const taskId = route.params.id as string;
const expenseId = computed(() => (route.params.expenseId as string | undefined) ?? null);

const task = ref<MoveTask | null>(null);
const payer = ref('');
const amount = ref('');
const category = ref<ExpenseCategory>('parking');
const reason = ref('');
const spentAt = ref(toLocalInput(Date.now()));
const photoData = ref('');
const saving = ref(false);

const isEdit = computed(() => !!expenseId.value);
const previousPayers = computed(() => {
  if (!task.value) return [];
  return [...new Set(task.value.expenses.map((e) => e.payer))];
});

async function load() {
  task.value = await getTask(taskId);
  if (!task.value) {
    alert('任务不存在');
    router.replace('/');
    return;
  }
  if (expenseId.value) {
    const e = task.value.expenses.find((x) => x.id === expenseId.value);
    if (!e) {
      alert('垫付记录不存在');
      router.replace(`/task/${taskId}/expenses`);
      return;
    }
    if (e.reimbursementId) {
      alert('这笔已经报销，不能修改');
      router.replace(`/task/${taskId}/expenses`);
      return;
    }
    payer.value = e.payer;
    amount.value = String(e.amount);
    category.value = e.category;
    reason.value = e.reason;
    spentAt.value = toLocalInput(e.spentAt);
    photoData.value = e.photo ?? '';
  }
}

async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  photoData.value = await compressImage(file);
}

async function submit() {
  if (!task.value) return;
  const value = Number(amount.value);
  if (!payer.value.trim()) {
    alert('请填写垫钱的人');
    return;
  }
  if (!Number.isFinite(value) || value <= 0) {
    alert('请填写正确的金额');
    return;
  }
  if (!reason.value.trim()) {
    alert('请填写事由（如：地库停车 3 小时）');
    return;
  }
  const ts = fromLocalInput(spentAt.value);
  if (!Number.isFinite(ts)) {
    alert('请选择垫付时间');
    return;
  }
  saving.value = true;
  const now = Date.now();
  const data = {
    payer: payer.value.trim(),
    amount: Math.round(value * 100) / 100,
    category: category.value,
    reason: reason.value.trim(),
    spentAt: ts,
    photo: photoData.value || undefined,
  };
  if (isEdit.value) {
    const original = task.value.expenses.find((x) => x.id === expenseId.value)!;
    await updateExpense(taskId, { ...original, ...data });
  } else {
    await addExpense(taskId, {
      id: uid(),
      ...data,
      createdAt: now,
    });
  }
  router.replace(`/task/${taskId}/expenses`);
}

onMounted(load);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}/expenses`" class="back">←</router-link>
      <h1>{{ isEdit ? '编辑垫付' : '记一笔垫付' }}</h1>
    </div>
    <div class="page">
      <div class="card">
        <label class="label">垫钱的人</label>
        <input v-model="payer" class="input" list="payer-list" placeholder="姓名" />
        <datalist id="payer-list">
          <option v-for="p in previousPayers" :key="p" :value="p"></option>
        </datalist>
      </div>
      <div class="card">
        <label class="label">金额（元）</label>
        <input v-model="amount" type="number" inputmode="decimal" min="0.01" step="0.01" class="input" placeholder="0.00" />
      </div>
      <div class="card">
        <label class="label">费用类型</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
          <span
            v-for="c in expenseCategoryOptions"
            :key="c.value"
            class="tag"
            :class="{ active: category === c.value }"
            @click="category = c.value"
          >{{ c.icon }} {{ c.label }}</span>
        </div>
      </div>
      <div class="card">
        <label class="label">事由</label>
        <textarea v-model="reason" class="textarea" rows="2" placeholder="例如：小区地库停车费 / 5 楼无电梯搬运加钱"></textarea>
      </div>
      <div class="card">
        <label class="label">垫付时间</label>
        <input v-model="spentAt" type="datetime-local" class="input" />
      </div>
      <div class="card">
        <label class="label">凭证照片（票据/付款截图，可选）</label>
        <input type="file" accept="image/*" capture="environment" class="input" style="padding:8px;" @change="onPhoto" />
        <img v-if="photoData" :src="photoData" style="width:100%;margin-top:10px;border-radius:10px;" />
      </div>
      <button class="btn btn-block" :disabled="saving" @click="submit">{{ isEdit ? '保存修改' : '保存这笔垫付' }}</button>
    </div>
  </div>
</template>
