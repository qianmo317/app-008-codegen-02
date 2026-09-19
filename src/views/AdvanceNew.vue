<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, addAdvance } from '../db';
import { uid, compressImage, toDateTimeLocalValue, round2 } from '../utils';
import type { MoveTask, Advance } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);
const payer = ref('');
const amount = ref<number | null>(null);
const reason = ref('');
const paidAt = ref(toDateTimeLocalValue(Date.now()));
const photoData = ref('');

const reasonOptions = ['停车费', '楼层搬运费', '打包耗材', '过路费', '餐费', '其他'];

// 已有垫付人，方便快速选择
const knownPayers = computed(() => {
  if (!task.value) return [];
  return [...new Set((task.value.advances ?? []).map((a) => a.payer))];
});

async function load() {
  task.value = await getTask(route.params.id as string);
}

async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  photoData.value = await compressImage(file);
}

async function submit() {
  if (!task.value) return;
  if (!payer.value.trim()) {
    alert('请填写垫钱的人');
    return;
  }
  if (!amount.value || amount.value <= 0) {
    alert('请填写正确的金额');
    return;
  }
  if (!reason.value.trim()) {
    alert('请填写事由');
    return;
  }
  const paidAtTs = new Date(paidAt.value).getTime();
  if (Number.isNaN(paidAtTs)) {
    alert('请选择垫付时间');
    return;
  }
  const advance: Advance = {
    id: uid(),
    payer: payer.value.trim(),
    amount: round2(amount.value),
    reason: reason.value.trim(),
    photo: photoData.value || undefined,
    paidAt: paidAtTs,
    createdAt: Date.now(),
  };
  await addAdvance(task.value.id, advance);
  if (confirm('已保存，继续记一笔？')) {
    amount.value = null;
    reason.value = '';
    photoData.value = '';
    paidAt.value = toDateTimeLocalValue(Date.now());
  } else {
    router.push(`/task/${task.value.id}/advances`);
  }
}

onMounted(load);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}/advances`" class="back">←</router-link>
      <h1>记一笔垫付</h1>
    </div>
    <div class="page">
      <div class="card">
        <label class="label">垫钱的人</label>
        <input v-model="payer" class="input" list="payer-list" placeholder="谁垫的钱" />
        <datalist id="payer-list">
          <option v-for="p in knownPayers" :key="p" :value="p" />
        </datalist>
      </div>
      <div class="card">
        <label class="label">金额（元）</label>
        <input v-model.number="amount" type="number" min="0" step="0.01" class="input" placeholder="例如：35.5" />
      </div>
      <div class="card">
        <label class="label">事由</label>
        <input v-model="reason" class="input" placeholder="垫钱买了什么 / 付了什么费" />
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
          <span v-for="r in reasonOptions" :key="r" class="tag" :class="{active: reason === r}" @click="reason = r">{{ r }}</span>
        </div>
      </div>
      <div class="card">
        <label class="label">垫付时间</label>
        <input v-model="paidAt" type="datetime-local" class="input" />
      </div>
      <div class="card">
        <label class="label">凭证照片</label>
        <input type="file" accept="image/*" capture="environment" @change="onPhoto" class="input" style="padding:8px;" />
        <img v-if="photoData" :src="photoData" style="width:100%;margin-top:10px;border-radius:10px;" />
      </div>
      <button class="btn btn-block" @click="submit">保存</button>
    </div>
  </div>
</template>
