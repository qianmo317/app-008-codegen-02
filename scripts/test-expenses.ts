import {
  getAllTasks,
  saveTask,
  getTask,
  addExpense,
  updateExpense,
  deleteExpense,
  createReimbursement,
  deleteReimbursement,
  updateDueDays,
} from '../src/db';
import { uid, isOverdue, elapsedDays } from '../src/utils';
import type { MoveTask } from '../src/types';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log('  ✓', msg);
  } else {
    fail++;
    console.error('  ✗ FAIL:', msg);
  }
}
async function expectThrow(fn: () => Promise<unknown>, msg: string) {
  try {
    await fn();
    fail++;
    console.error('  ✗ FAIL (未抛错):', msg);
  } catch {
    pass++;
    console.log('  ✓', msg);
  }
}

const DAY = 86400000;
const now = new Date('2026-09-19T18:00:00').getTime();

async function setup(): Promise<string> {
  const task: MoveTask = {
    id: uid(),
    title: '测试搬家',
    from: 'A',
    to: 'B',
    date: '2026-09-19',
    rooms: ['客厅'],
    boxes: [],
    expenses: [],
    reimbursements: [],
    dueWithinDays: 5,
    createdAt: now,
  };
  await saveTask(task);
  return task.id;
}

function expense(over: Partial<{ payer: string; amount: number; reason: string; spentAt: number }> = {}) {
  return {
    id: uid(),
    payer: over.payer ?? '张三',
    amount: over.amount ?? 10,
    category: 'parking' as const,
    reason: over.reason ?? '停车费',
    spentAt: over.spentAt ?? now - DAY,
    createdAt: now,
  };
}

console.log('1. 旧任务字段兼容');
{
  // @ts-expect-error 模拟旧版本没有账本字段的数据
  await saveTask({ id: 'old1', title: '旧', from: '', to: '', date: '', rooms: [], boxes: [], createdAt: now });
  const t = await getTask('old1');
  assert(Array.isArray(t!.expenses) && t!.expenses.length === 0, 'expenses 补默认空数组');
  assert(Array.isArray(t!.reimbursements) && t!.reimbursements.length === 0, 'reimbursements 补默认空数组');
  assert(t!.dueWithinDays === 5, 'dueWithinDays 默认 5 天');
  const all = await getAllTasks();
  assert(all.every((x) => Array.isArray(x.expenses)), 'getAllTasks 同样归一化');
}

console.log('2. 记账与汇总');
let id = await setup();
{
  await addExpense(id, expense({ payer: '张三', amount: 20, spentAt: now - DAY }));
  await addExpense(id, expense({ payer: '张三', amount: 30.5, reason: '搬运', spentAt: now - 2 * DAY }));
  await addExpense(id, expense({ payer: '李四', amount: 49.5, reason: '耗材', spentAt: now - 3 * DAY }));
  const t = await getTask(id);
  assert(t!.expenses.length === 3, '三笔都存入');
  const total = t!.expenses.reduce((s, e) => s + e.amount, 0);
  assert(Math.abs(total - 100) < 1e-9, '金额合计 100.00');
}

console.log('3. 勾选合并报销 + 防重复报销');
{
  const t0 = await getTask(id);
  const [a, b, c] = t0!.expenses;
  const batch = await createReimbursement(id, [a.id, c.id]);
  assert(batch.expenseIds.length === 2, '批次含 2 笔');
  assert(Math.abs(batch.total - 69.5) < 1e-9, '批次合计 69.50');
  assert(Math.abs(batch.byPayer['张三'] - 20) < 1e-9, '张三应得 20');
  assert(Math.abs(batch.byPayer['李四'] - 49.5) < 1e-9, '李四应得 49.5');
  const t1 = await getTask(id);
  assert(t1!.expenses.find((e) => e.id === a.id)!.reimbursementId === batch.id, '笔 a 标记已报销');
  assert(t1!.reimbursements.length === 1, '报销批次落库');
  // 再报一次同一笔必须拒绝
  await expectThrow(() => createReimbursement(id, [a.id]), '已报销的笔不能再次报销');
  await expectThrow(() => createReimbursement(id, []), '空选择不允许报销');
  await expectThrow(() => updateExpense(id, { ...a, amount: 999 }), '已报销的笔不能编辑');
  await expectThrow(() => deleteExpense(id, a.id), '已报销的笔不能删除');
}

console.log('4. 撤销报销后可重新报');
{
  const t0 = await getTask(id);
  const [a, , c] = t0!.expenses;
  const batchId = a.reimbursementId!;
  await deleteReimbursement(id, batchId);
  const t1 = await getTask(id);
  assert(t1!.reimbursements.length === 0, '批次删除');
  assert(t1!.expenses.find((e) => e.id === a.id)!.reimbursementId === undefined, '笔 a 恢复未报销');
  assert(t1!.expenses.find((e) => e.id === c.id)!.reimbursementId === undefined, '笔 c 恢复未报销');
  const batch2 = await createReimbursement(id, [a.id]);
  assert(batch2.expenseIds.length === 1, '恢复后可重新报销');
}

console.log('5. 逾期判定');
{
  assert(isOverdue(now - 6 * DAY, 5) === true, '6 天前的垫付逾期（期限 5 天）');
  assert(isOverdue(now - 5 * DAY, 5) === false, '刚好 5 天不算逾期');
  assert(isOverdue(now - 1 * DAY, 5) === false, '1 天前不逾期');
  assert(elapsedDays(now - 100 * DAY) === 100, '经过天数计算');
  await updateDueDays(id, 2);
  const t = await getTask(id);
  assert(t!.dueWithinDays === 2, '期限可更新为 2 天');
  // 张三未报的 b（2 天前）：刚好 2 天不算逾期；收紧到 1 天后逾期
  const pendingB = t!.expenses.find((e) => e.reason === '搬运')!;
  assert(isOverdue(pendingB.spentAt, 2) === false, '刚好 2 天不逾期');
  assert(isOverdue(pendingB.spentAt, 1) === true, '期限收紧到 1 天后该笔变逾期');
}

console.log('6. 未报销笔的编辑/删除正常');
{
  const t0 = await getTask(id);
  const b = t0!.expenses.find((e) => e.reason === '搬运')!;
  await updateExpense(id, { ...b, amount: 35 });
  const t1 = await getTask(id);
  assert(t1!.expenses.find((e) => e.id === b.id)!.amount === 35, '未报销笔可改金额');
  await deleteExpense(id, b.id);
  const t2 = await getTask(id);
  assert(t2!.expenses.find((e) => e.id === b.id) === undefined, '未报销笔可删除');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
