<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, deleteAdvance, createReimbursement, setAdvanceDueDays } from '../db';
import {
  formatMoney,
  formatDateTime,
  isAdvanceOverdue,
  overdueDays,
  advanceSummary,
  reconcileByPayer,
  round2,
} from '../utils';
import type { MoveTask, Advance, Reimbursement } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);
const selected = ref<string[]>([]);
const note = ref('');
const preview = ref('');

const advances = computed(() => task.value?.advances ?? []);
const dueDays = computed(() => task.value?.advanceDueDays ?? 7);
const pending = computed(() =>
  advances.value.filter((a) => !a.reimbursementId).slice().sort((a, b) => b.paidAt - a.paidAt),
);
const overdueList = computed(() => pending.value.filter((a) => isAdvanceOverdue(a, dueDays.value)));
const summary = computed(() => advanceSummary(advances.value, dueDays.value));
const recon = computed(() => reconcileByPayer(advances.value));
const batches = computed(() => (task.value?.reimbursements ?? []).slice().reverse());
const selectedTotal = computed(() =>
  round2(pending.value.filter((a) => selected.value.includes(a.id)).reduce((s, a) => s + a.amount, 0)),
);

function advancesOf(batch: Reimbursement): Advance[] {
  return batch.advanceIds
    .map((id) => advances.value.find((a) => a.id === id))
    .filter((a): a is Advance => !!a);
}

function toggle(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter((x) => x !== id);
  else selected.value.push(id);
}

async function load() {
  task.value = await getTask(route.params.id as string);
  selected.value = [];
}

async function saveDueDays(e: Event) {
  if (!task.value) return;
  const days = Math.round(Number((e.target as HTMLInputElement).value));
  if (!Number.isFinite(days) || days < 1) {
    alert('请填写不小于 1 的整数天数');
    await load();
    return;
  }
  await setAdvanceDueDays(task.value.id, days);
  await load();
}

async function remove(a: Advance) {
  if (!task.value) return;
  if (!confirm(`删除「${a.payer} · ${a.reason} · ${formatMoney(a.amount)}」这笔垫付？`)) return;
  try {
    await deleteAdvance(task.value.id, a.id);
    await load();
  } catch (err) {
    alert((err as Error).message);
  }
}

async function reimburse() {
  if (!task.value) return;
  if (selected.value.length === 0) {
    alert('请先勾选要报销的垫付记录');
    return;
  }
  if (!confirm(`将勾选的 ${selected.value.length} 笔（合计 ${formatMoney(selectedTotal.value)}）合成一次报销？`)) return;
  try {
    await createReimbursement(task.value.id, selected.value, note.value.trim() || undefined);
    note.value = '';
    await load();
  } catch (err) {
    alert((err as Error).message);
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="`/task/${task.id}`" class="back">←</router-link>
      <h1>垫付与报销</h1>
    </div>
    <div class="page">
      <div class="grid-2">
        <div class="card" style="text-align:center;">
          <div style="font-size:24px;font-weight:800;">{{ formatMoney(summary.total) }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">垫付总额</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--info);">{{ formatMoney(summary.pendingAmount) }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">待报销（{{ summary.pendingCount }} 笔）</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--success);">{{ formatMoney(summary.reimbursedAmount) }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">已报销</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--danger);">{{ summary.overdueCount }} 笔</div>
          <div style="font-size:12px;color:var(--text-secondary);">逾期未报</div>
        </div>
      </div>

      <div class="card" style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div style="font-weight:700;">约定报销期限</div>
          <div style="font-size:12px;color:var(--text-secondary);">超过 {{ dueDays }} 天未报销会单独列出</div>
        </div>
        <input type="number" min="1" step="1" :value="dueDays" @change="saveDueDays" class="input" style="width:80px;padding:8px 10px;" />
        <span style="font-size:14px;color:var(--text-secondary);">天</span>
      </div>

      <button class="btn btn-block no-print" @click="router.push(`/task/${task.id}/advances/new`)">+ 记一笔垫付</button>

      <div v-if="overdueList.length" class="card" style="border-color:var(--danger);margin-top:12px;">
        <div style="font-weight:700;color:var(--danger);margin-bottom:4px;">
          逾期未报（{{ overdueList.length }} 笔 · {{ formatMoney(summary.overdueAmount) }}）
        </div>
        <div v-for="a in overdueList" :key="a.id" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border);">
          <div style="flex:1;">
            <div style="font-weight:700;">{{ a.payer }} · {{ formatMoney(a.amount) }}</div>
            <div style="font-size:12px;color:var(--text-secondary);">{{ a.reason }} · {{ formatDateTime(a.paidAt) }}</div>
          </div>
          <span style="font-size:12px;color:var(--danger);white-space:nowrap;">已超期 {{ overdueDays(a, dueDays) }} 天</span>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <div style="font-weight:700;margin-bottom:4px;">待报销（{{ pending.length }} 笔）</div>
        <div v-if="pending.length === 0" class="empty" style="padding:12px 0;">没有待报销的垫付</div>
        <label v-for="a in pending" :key="a.id" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" :checked="selected.includes(a.id)" @change="toggle(a.id)" style="width:20px;height:20px;flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;">{{ a.payer }} · {{ formatMoney(a.amount) }}</div>
            <div style="font-size:12px;color:var(--text-secondary);">{{ a.reason }} · {{ formatDateTime(a.paidAt) }}</div>
          </div>
          <img v-if="a.photo" :src="a.photo" @click.stop.prevent="preview = a.photo" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex-shrink:0;" />
          <span v-else style="font-size:12px;color:var(--danger);flex-shrink:0;">无票据</span>
          <button class="btn btn-secondary no-print" style="padding:6px 10px;font-size:12px;flex-shrink:0;" @click.stop.prevent="remove(a)">删</button>
        </label>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:4px;">按人对账</div>
        <div v-if="recon.length === 0" class="empty" style="padding:12px 0;">暂无垫付记录</div>
        <div v-for="r in recon" :key="r.payer" style="padding:10px 0;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;">{{ r.payer }}</span>
            <span style="font-weight:700;">{{ formatMoney(r.total) }}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
            {{ r.count }} 笔 · 票据 {{ r.receiptCount }} 张<template v-if="r.missingReceiptCount > 0"><span style="color:var(--danger);">（缺 {{ r.missingReceiptCount }} 张）</span></template>
            · 待报 {{ formatMoney(r.pendingAmount) }} · 已报 {{ formatMoney(r.reimbursedAmount) }}
          </div>
        </div>
      </div>

      <div v-if="batches.length" class="card">
        <div style="font-weight:700;margin-bottom:4px;">报销记录（{{ batches.length }} 次）</div>
        <div v-for="b in batches" :key="b.id" style="padding:10px 0;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;">{{ formatMoney(b.total) }} · {{ b.advanceIds.length }} 笔</span>
            <span style="font-size:12px;color:var(--text-secondary);">{{ formatDateTime(b.createdAt) }}</span>
          </div>
          <div v-if="b.note" style="font-size:12px;color:var(--text-secondary);margin-top:2px;">备注：{{ b.note }}</div>
          <div v-for="a in advancesOf(b)" :key="a.id" style="font-size:13px;color:var(--text-secondary);margin-top:2px;">
            · {{ a.payer }} {{ a.reason }} {{ formatMoney(a.amount) }}
          </div>
        </div>
      </div>

      <div v-if="selected.length > 0" style="height:110px;"></div>
    </div>

    <div v-if="selected.length > 0" class="no-print" style="position:fixed;bottom:0;left:0;right:0;max-width:640px;margin:0 auto;background:var(--surface);border-top:1px solid var(--border);padding:10px 16px;display:flex;flex-direction:column;gap:8px;z-index:20;">
      <input v-model="note" class="input" placeholder="报销备注（可选）" style="padding:8px 12px;font-size:14px;" />
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;font-size:14px;">已选 {{ selected.length }} 笔 · 合计 <b>{{ formatMoney(selectedTotal) }}</b></div>
        <button class="btn" style="padding:10px 16px;" @click="reimburse">合成一次报销</button>
      </div>
    </div>

    <div v-if="preview" @click="preview = ''" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:100;">
      <img :src="preview" style="max-width:100%;max-height:100%;" />
    </div>
  </div>
</template>
