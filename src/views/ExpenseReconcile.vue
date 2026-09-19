<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { getTask, saveTask } from '../db';
import {
  formatMoney,
  formatDateTime,
  expenseCategoryIcon,
  isOverdue,
} from '../utils';
import type { MoveTask } from '../types';

const route = useRoute();
const taskId = route.params.id as string;

const task = ref<MoveTask | null>(null);
// 每个垫付人"手上票据张数"的现场点数字，默认等于账本笔数
const ticketCounts = ref<Record<string, string>>({});

type Row = {
  payer: string;
  count: number;
  amount: number;
  paidAmount: number;
  outstandingAmount: number;
  overdueCount: number;
  photoCount: number;
  verifiedAt?: number;
  match: boolean;
};

const rows = computed<Row[]>(() => {
  if (!task.value) return [];
  const map = new Map<string, Row>();
  for (const e of task.value.expenses) {
    let row = map.get(e.payer);
    if (!row) {
      row = {
        payer: e.payer,
        count: 0,
        amount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        overdueCount: 0,
        photoCount: 0,
        verifiedAt: undefined,
        match: true,
      };
      map.set(e.payer, row);
    }
    row.count += 1;
    row.amount = round2(row.amount + e.amount);
    if (e.reimbursementId) row.paidAmount = round2(row.paidAmount + e.amount);
    else {
      row.outstandingAmount = round2(row.outstandingAmount + e.amount);
      if (isOverdue(e.spentAt, task.value.dueWithinDays)) row.overdueCount += 1;
    }
    if (e.photo) row.photoCount += 1;
  }
  const verified = task.value.reconciledPayerAt ?? {};
  return [...map.values()]
    .map((r) => {
      const typed = Number(ticketCounts.value[r.payer] ?? r.count);
      const physical = Number.isFinite(typed) ? typed : r.count;
      return { ...r, verifiedAt: verified[r.payer], match: physical === r.count };
    })
    .sort((a, b) => b.amount - a.amount);
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function physicalCount(row: Row): number {
  const v = Number(ticketCounts.value[row.payer] ?? row.count);
  return Number.isFinite(v) ? v : row.count;
}

async function reload() {
  task.value = await getTask(taskId);
  if (task.value && !task.value.reconciledPayerAt) {
    task.value.reconciledPayerAt = {};
    await saveTask(task.value);
  }
}

async function verify(row: Row) {
  if (!task.value) return;
  if (physicalCount(row) !== row.count) {
    alert('票据张数和账本对不上，请先找本人核对，确认后再勾');
    return;
  }
  task.value.reconciledPayerAt = {
    ...(task.value.reconciledPayerAt ?? {}),
    [row.payer]: Date.now(),
  };
  await saveTask(task.value);
}

async function clearVerify(row: Row) {
  if (!task.value) return;
  const next = { ...(task.value.reconciledPayerAt ?? {}) };
  delete next[row.payer];
  task.value.reconciledPayerAt = next;
  await saveTask(task.value);
}

function expensesOf(payer: string) {
  return task.value
    ? [...task.value.expenses]
        .filter((e) => e.payer === payer)
        .sort((a, b) => b.spentAt - a.spentAt)
    : [];
}

onMounted(reload);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}/expenses`" class="back">←</router-link>
      <h1>按人对账</h1>
    </div>

    <div class="page">
      <div class="card hint">
        当面点清每个人手上留的票据张数，和账本里的笔数对齐；金额对得上、张数对得上，再勾"已核对"。
        已拍照凭证 {{ rows.reduce((s, r) => s + r.photoCount, 0) }} 张可辅助抽查。
      </div>

      <div v-if="rows.length === 0" class="empty">还没有垫付记录</div>

      <details v-for="row in rows" :key="row.payer" class="card person-card" :open="row.overdueCount > 0">
        <summary>
          <div class="person-head">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="person-name">{{ row.payer }}</span>
              <span v-if="row.verifiedAt" class="badge-ok">✓ {{ formatDateTime(row.verifiedAt).split(' ')[0] }} 已核对</span>
              <span v-if="!row.match" class="badge-danger">张数不符</span>
            </div>
            <div class="person-total">¥{{ formatMoney(row.amount) }}</div>
          </div>
          <div class="person-meta">
            <span>账本 {{ row.count }} 笔</span>
            <span v-if="row.photoCount > 0">📷 {{ row.photoCount }}</span>
            <span style="color:var(--success);">已报 ¥{{ formatMoney(row.paidAmount) }}</span>
            <span style="color:var(--danger);">未报 ¥{{ formatMoney(row.outstandingAmount) }}</span>
            <span v-if="row.overdueCount > 0" style="color:var(--danger);">逾期 {{ row.overdueCount }} 笔</span>
          </div>
        </summary>

        <div class="count-row">
          <label class="label" style="margin:0;">本人手上票据实际张数</label>
          <input v-model="ticketCounts[row.payer]" type="number" min="0" step="1" class="input" :placeholder="String(row.count)" style="width:90px;" />
          <span class="match-ok" v-if="row.match">✓ 张数一致</span>
          <span class="match-bad" v-else>差 {{ physicalCount(row) - row.count }} 张，先找票据</span>
        </div>

        <div v-for="e in expensesOf(row.payer)" :key="e.id" class="ticket-line" :class="{ paid: e.reimbursementId }">
          <span>
            {{ expenseCategoryIcon(e.category) }} {{ e.reason }}
            <em>{{ formatDateTime(e.spentAt) }}</em>
          </span>
          <span style="display:flex;align-items:center;gap:8px;">
            <b>¥{{ formatMoney(e.amount) }}</b>
            <span v-if="e.photo">📷</span>
            <span v-if="e.reimbursementId" class="badge-ok">已报</span>
          </span>
        </div>

        <div style="display:flex;gap:10px;margin-top:10px;">
          <button v-if="!row.verifiedAt" class="btn btn-success" style="flex:1;padding:10px;font-size:14px;" @click="verify(row)">
            账实相符，确认核对
          </button>
          <button v-else class="btn btn-secondary" style="flex:1;padding:10px;font-size:14px;" @click="clearVerify(row)">
            取消核对标记
          </button>
          <router-link :to="`/task/${task.id}/expenses`" class="btn btn-secondary back-link">
            回账本
          </router-link>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.hint { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

.person-card summary { cursor: pointer; list-style: none; }
.person-card summary::-webkit-details-marker { display: none; }
.person-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.person-name { font-weight: 800; font-size: 16px; }
.person-total { font-weight: 800; font-size: 18px; }
.person-meta {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-size: 12px; color: var(--text-secondary); margin-top: 6px;
}
.badge-ok {
  padding: 2px 8px; border-radius: 999px;
  background: rgba(34, 197, 94, 0.15); color: var(--success); font-size: 11px;
}
.badge-danger {
  padding: 2px 8px; border-radius: 999px;
  background: var(--danger); color: #fff; font-size: 11px;
}

.count-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border);
}
.match-ok { font-size: 13px; color: var(--success); font-weight: 700; }
.match-bad { font-size: 13px; color: var(--danger); font-weight: 700; }

.ticket-line {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 13px; padding: 8px 0; border-bottom: 1px dashed var(--border);
}
.ticket-line em { font-style: normal; color: var(--text-secondary); font-size: 11px; margin-left: 6px; }
.ticket-line.paid { opacity: 0.6; }
.back-link {
  padding: 10px 14px;
  font-size: 14px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
