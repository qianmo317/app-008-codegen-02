<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  getTask,
  deleteExpense,
  createReimbursement,
  deleteReimbursement,
  updateDueDays,
} from '../db';
import {
  formatMoney,
  formatDateTime,
  expenseCategoryIcon,
  expenseCategoryLabel,
  elapsedDays,
  isOverdue,
} from '../utils';
import type { MoveTask, Expense } from '../types';

const route = useRoute();
const router = useRouter();
const taskId = route.params.id as string;

const task = ref<MoveTask | null>(null);
const tab = ref<'pending' | 'done' | 'batches'>('pending');
const selected = ref<Set<string>>(new Set());
const showConfirm = ref(false);
const note = ref('');
const submitting = ref(false);
const previewPhoto = ref<string | null>(null);
const dueDraft = ref<string>('');

const pending = computed<Expense[]>(() =>
  task.value ? task.value.expenses.filter((e) => !e.reimbursementId) : [],
);
const reimbursed = computed<Expense[]>(() =>
  task.value ? task.value.expenses.filter((e) => e.reimbursementId) : [],
);
const overdue = computed<Expense[]>(() =>
  pending.value.filter((e) => isOverdue(e.spentAt, task.value!.dueWithinDays)),
);

const totalAdvance = computed(() => sum(task.value?.expenses ?? []));
const totalReimbursed = computed(() => sum(reimbursed.value));
const totalOutstanding = computed(() => sum(pending.value));
const selectedAmount = computed(() =>
  sum(pending.value.filter((e) => selected.value.has(e.id))),
);
const selectedByPayer = computed(() => {
  const map = new Map<string, number>();
  for (const e of pending.value.filter((x) => selected.value.has(x.id))) {
    map.set(e.payer, round2((map.get(e.payer) ?? 0) + e.amount));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
});

const pendingSorted = computed(() => [...pending.value].sort((a, b) => b.spentAt - a.spentAt));
const reimbursedSorted = computed(() => [...reimbursed.value].sort((a, b) => b.spentAt - a.spentAt));
const batchesSorted = computed(() =>
  task.value ? [...task.value.reimbursements].sort((a, b) => b.createdAt - a.createdAt) : [],
);

function sum(list: Expense[]): number {
  return round2(list.reduce((s, e) => s + e.amount, 0));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toggleSelect(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function selectAll() {
  if (selected.value.size === pending.value.length) selected.value = new Set();
  else selected.value = new Set(pending.value.map((e) => e.id));
}
function selectOverdue() {
  selected.value = new Set(overdue.value.map((e) => e.id));
  tab.value = 'pending';
}

function expenseDays(e: Expense): number {
  return elapsedDays(e.spentAt);
}
function expenseOverdue(e: Expense): boolean {
  return isOverdue(e.spentAt, task.value!.dueWithinDays);
}

async function removeExpense(e: Expense) {
  if (e.reimbursementId) return;
  if (!confirm(`删除「${e.reason}」这笔垫付？删除后不可恢复`)) return;
  await deleteExpense(taskId, e.id);
  await reload();
}

async function saveDueDays() {
  const days = Number(dueDraft.value);
  if (!Number.isFinite(days) || days < 0) {
    alert('请输入不小于 0 的天数');
    dueDraft.value = String(task.value?.dueWithinDays ?? 5);
    return;
  }
  await updateDueDays(taskId, days);
  await reload();
}

function openConfirm() {
  if (selected.value.size === 0) return;
  note.value = '';
  showConfirm.value = true;
}

async function confirmReimburse() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await createReimbursement(taskId, [...selected.value], note.value);
    showConfirm.value = false;
    selected.value = new Set();
    await reload();
    tab.value = 'done';
  } catch (err) {
    alert((err as Error).message);
    await reload();
  } finally {
    submitting.value = false;
  }
}

async function removeBatch(batchId: string, total: number) {
  if (!confirm(`撤销这次报销（合计 ¥${formatMoney(total)}）？批次内的垫付会恢复为"待报销"`)) return;
  await deleteReimbursement(taskId, batchId);
  await reload();
}

function batchOf(batchId: string) {
  return task.value?.reimbursements.find((r) => r.id === batchId);
}
function batchExpenses(batchId: string) {
  return task.value?.expenses.filter((e) => e.reimbursementId === batchId) ?? [];
}

async function reload() {
  task.value = await getTask(taskId);
  if (task.value) dueDraft.value = String(task.value.dueWithinDays);
}

onMounted(reload);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}`" class="back">←</router-link>
      <h1>垫付与报销账</h1>
    </div>

    <div class="page" style="padding-bottom: 96px;">
      <!-- 总览 -->
      <div class="grid-3">
        <div class="card stat">
          <div class="stat-num">¥{{ formatMoney(totalAdvance) }}</div>
          <div class="stat-label">累计垫付</div>
        </div>
        <div class="card stat">
          <div class="stat-num" style="color:var(--success);">¥{{ formatMoney(totalReimbursed) }}</div>
          <div class="stat-label">已报销</div>
        </div>
        <div class="card stat">
          <div class="stat-num" style="color:var(--danger);">¥{{ formatMoney(totalOutstanding) }}</div>
          <div class="stat-label">待报销</div>
        </div>
      </div>

      <!-- 约定天数 -->
      <div class="card due-row">
        <div>
          <div style="font-weight:700;font-size:14px;">约定报销期限</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">垫付超过该天数未报，列入逾期清单</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <input v-model="dueDraft" type="number" min="0" step="1" class="input" style="width:72px;padding:8px 10px;text-align:center;" />
          <span style="font-size:13px;color:var(--text-secondary);">天</span>
          <button class="btn btn-secondary" style="padding:8px 12px;font-size:13px;" @click="saveDueDays">更新</button>
        </div>
      </div>

      <!-- 逾期清单 -->
      <div v-if="overdue.length > 0" class="card overdue-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="font-weight:800;color:var(--danger);">
            ⚠️ 逾期未报 {{ overdue.length }} 笔 · ¥{{ formatMoney(sum(overdue)) }}
          </div>
          <button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" @click="selectOverdue">全部勾选</button>
        </div>
        <div v-for="e in overdue" :key="e.id" class="overdue-line">
          <span>{{ e.payer }} · {{ expenseCategoryIcon(e.category) }}{{ expenseCategoryLabel(e.category) }} · {{ e.reason }}</span>
          <span style="white-space:nowrap;">¥{{ formatMoney(e.amount) }} · 已 {{ expenseDays(e) }} 天</span>
        </div>
      </div>

      <button class="btn btn-block" @click="router.push(`/task/${task.id}/expenses/new`)">＋ 记一笔垫付</button>
      <button class="btn btn-secondary btn-block" style="margin-top:8px;" @click="router.push(`/task/${task.id}/expenses/reconcile`)">
        🧾 按人对账（票据核对）
      </button>

      <!-- 页签 -->
      <div class="tabs no-print">
        <div class="tab" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">
          待报销 <b>{{ pending.length }}</b>
        </div>
        <div class="tab" :class="{ active: tab === 'done' }" @click="tab = 'done'">
          已报销 <b>{{ reimbursed.length }}</b>
        </div>
        <div class="tab" :class="{ active: tab === 'batches' }" @click="tab = 'batches'">
          报销记录 <b>{{ task.reimbursements.length }}</b>
        </div>
      </div>

      <!-- 待报销 -->
      <div v-if="tab === 'pending'">
        <div v-if="pending.length > 0" style="display:flex;justify-content:flex-end;margin:4px 0 8px;">
          <span class="link" @click="selectAll">{{ selected.size === pending.length ? '取消全选' : '全选' }}</span>
        </div>
        <div v-if="pendingSorted.length === 0" class="empty">没有待报销的垫付</div>
        <div
          v-for="e in pendingSorted"
          :key="e.id"
          class="card expense-card"
          :class="{ checked: selected.has(e.id), overdue: expenseOverdue(e) }"
          role="checkbox"
          :aria-checked="selected.has(e.id)"
          tabindex="0"
          @click="toggleSelect(e.id)"
          @keydown.enter.prevent="toggleSelect(e.id)"
          @keydown.space.prevent="toggleSelect(e.id)"
        >
          <input
            type="checkbox"
            class="expense-check"
            :checked="selected.has(e.id)"
            tabindex="-1"
            @click.stop
            @change="toggleSelect(e.id)"
          />
          <div class="expense-main">
            <div class="expense-top">
              <span class="expense-payer">{{ e.payer }}</span>
              <span class="expense-amount">¥{{ formatMoney(e.amount) }}</span>
            </div>
            <div class="expense-sub">
              {{ expenseCategoryIcon(e.category) }} {{ expenseCategoryLabel(e.category) }} · {{ e.reason }}
            </div>
            <div class="expense-bottom">
              <span>{{ formatDateTime(e.spentAt) }}</span>
              <span v-if="expenseOverdue(e)" class="badge-danger">逾期 {{ expenseDays(e) }} 天</span>
              <span v-else-if="expenseDays(e) > 0" class="badge-muted">第 {{ expenseDays(e) }} 天</span>
              <span v-if="e.photo" class="link" @click.stop.prevent="previewPhoto = e.photo ?? null">📷 凭证</span>
              <span class="link" @click.stop.prevent="router.push(`/task/${task.id}/expenses/${e.id}/edit`)">编辑</span>
              <span class="link danger" @click.stop.prevent="removeExpense(e)">删除</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 已报销 -->
      <div v-if="tab === 'done'">
        <div v-if="reimbursedSorted.length === 0" class="empty">还没有报销记录</div>
        <div v-for="e in reimbursedSorted" :key="e.id" class="card expense-card locked">
          <span class="lock">✓</span>
          <div class="expense-main">
            <div class="expense-top">
              <span class="expense-payer">{{ e.payer }}</span>
              <span class="expense-amount">¥{{ formatMoney(e.amount) }}</span>
            </div>
            <div class="expense-sub">
              {{ expenseCategoryIcon(e.category) }} {{ expenseCategoryLabel(e.category) }} · {{ e.reason }}
            </div>
            <div class="expense-bottom">
              <span>{{ formatDateTime(e.spentAt) }}</span>
              <span v-if="e.photo" class="link" @click="previewPhoto = e.photo ?? null">📷 凭证</span>
              <span v-if="e.reimbursementId && batchOf(e.reimbursementId)" class="badge-ok">
                已于 {{ formatDateTime(batchOf(e.reimbursementId)!.createdAt).split(' ')[0] }} 报销
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 报销批次 -->
      <div v-if="tab === 'batches'">
        <div v-if="batchesSorted.length === 0" class="empty">还没有报销记录</div>
        <details v-for="r in batchesSorted" :key="r.id" class="card batch-card">
          <summary>
            <div>
              <div style="font-weight:700;">{{ formatDateTime(r.createdAt) }} 报销</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                {{ r.expenseIds.length }} 笔 ·
                <span v-for="(amt, p) in r.byPayer" :key="p"> {{ p }} ¥{{ formatMoney(amt) }}；</span>
              </div>
              <div v-if="r.note" style="font-size:12px;color:var(--text-secondary);margin-top:2px;">备注：{{ r.note }}</div>
            </div>
            <div class="batch-total">¥{{ formatMoney(r.total) }}</div>
          </summary>
          <div v-for="e in batchExpenses(r.id)" :key="e.id" class="batch-line">
            <span>{{ e.payer }} · {{ e.reason }}</span>
            <span>¥{{ formatMoney(e.amount) }}</span>
          </div>
          <button class="btn btn-danger" style="margin-top:10px;padding:8px 14px;font-size:13px;" @click="removeBatch(r.id, r.total)">
            撤销这次报销
          </button>
        </details>
      </div>
    </div>

    <!-- 底部合并报销条 -->
    <div v-if="tab === 'pending' && selected.size > 0" class="action-bar no-print">
      <div>
        已选 <b>{{ selected.size }}</b> 笔 · <b>¥{{ formatMoney(selectedAmount) }}</b>
      </div>
      <button class="btn btn-success" @click="openConfirm">合并报销</button>
    </div>

    <!-- 报销确认弹层 -->
    <div v-if="showConfirm" class="sheet-mask" @click.self="showConfirm = false">
      <div class="sheet">
        <div class="sheet-title">确认合并报销 {{ selected.size }} 笔</div>
        <div class="sheet-total">¥{{ formatMoney(selectedAmount) }}</div>
        <div class="sheet-subtitle">各垫付人应得</div>
        <div v-for="[p, amt] in selectedByPayer" :key="p" class="payer-row">
          <span>{{ p }}</span>
          <span>¥{{ formatMoney(amt) }}</span>
        </div>
        <label class="label" style="margin-top:12px;">备注（可选，如：微信转账结清）</label>
        <textarea v-model="note" class="textarea" rows="2"></textarea>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn btn-secondary" style="flex:1;" @click="showConfirm = false">再想想</button>
          <button class="btn btn-success" style="flex:2;" :disabled="submitting" @click="confirmReimburse">确认已给钱</button>
        </div>
      </div>
    </div>

    <!-- 凭证大图 -->
    <div v-if="previewPhoto" class="sheet-mask" @click="previewPhoto = null">
      <img :src="previewPhoto" class="photo-preview" />
    </div>
  </div>
</template>

<style scoped>
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.stat { text-align: center; padding: 12px 8px; margin-bottom: 12px; }
.stat-num { font-size: 16px; font-weight: 800; word-break: break-all; }
.stat-label { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

.due-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

.overdue-card { border-color: var(--danger); background: rgba(239, 68, 68, 0.08); }
.overdue-line {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; margin-top: 8px; color: var(--text);
}

.tabs { display: flex; gap: 6px; margin: 16px 0 10px; }
.tab {
  flex: 1; text-align: center; padding: 10px 4px;
  border-radius: 10px; font-size: 13px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text-secondary); cursor: pointer;
}
.tab.active { background: var(--primary); color: #fff; border-color: var(--primary-dark); font-weight: 700; }
.tab b { margin-left: 2px; }

.expense-card {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px; margin-bottom: 10px; cursor: pointer;
}
.expense-card.checked { border-color: var(--success); background: rgba(34, 197, 94, 0.08); }
.expense-card.overdue { border-left: 4px solid var(--danger); }
.expense-card.locked { cursor: default; opacity: 0.92; }
.expense-check { width: 20px; height: 20px; margin-top: 4px; accent-color: var(--success); }
.lock {
  width: 22px; height: 22px; margin-top: 2px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--success); color: #fff; font-size: 13px;
}
.expense-main { flex: 1; min-width: 0; }
.expense-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.expense-payer { font-weight: 700; }
.expense-amount { font-weight: 800; }
.expense-sub {
  font-size: 13px; color: var(--text-secondary);
  margin-top: 3px; overflow-wrap: anywhere;
}
.expense-bottom {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  font-size: 12px; color: var(--text-secondary); margin-top: 8px;
}
.badge-danger {
  padding: 2px 8px; border-radius: 999px;
  background: var(--danger); color: #fff; font-size: 11px;
}
.badge-muted {
  padding: 2px 8px; border-radius: 999px;
  background: var(--border); color: var(--text-secondary); font-size: 11px;
}
.badge-ok {
  padding: 2px 8px; border-radius: 999px;
  background: rgba(34, 197, 94, 0.15); color: var(--success); font-size: 11px;
}
.link { color: var(--primary-dark); cursor: pointer; }
.link.danger { color: var(--danger); }

.batch-card summary {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  cursor: pointer; list-style: none;
}
.batch-card summary::-webkit-details-marker { display: none; }
.batch-total { font-weight: 800; font-size: 18px; white-space: nowrap; }
.batch-line {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; color: var(--text-secondary);
  padding: 6px 0; border-top: 1px dashed var(--border); margin-top: 8px;
}

.action-bar {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 640px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; background: var(--bg);
  border-top: 1px solid var(--border);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
  z-index: 20;
}
.action-bar button { padding: 12px 22px; }

.sheet-mask {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: flex-end; justify-content: center;
}
.sheet {
  width: 100%; max-width: 640px;
  background: var(--bg); border-radius: 16px 16px 0 0;
  padding: 20px 16px 28px;
  max-height: 85vh; overflow-y: auto;
}
.sheet-title { font-weight: 800; font-size: 16px; }
.sheet-total { font-size: 30px; font-weight: 800; color: var(--success); margin: 8px 0 4px; }
.sheet-subtitle {
  font-size: 13px; color: var(--text-secondary);
  margin: 12px 0 4px; border-top: 1px solid var(--border); padding-top: 12px;
}
.payer-row {
  display: flex; justify-content: space-between;
  padding: 8px 2px; font-size: 15px;
}
.photo-preview {
  max-width: 96vw; max-height: 90vh; margin: auto;
  border-radius: 12px; object-fit: contain;
}
</style>
