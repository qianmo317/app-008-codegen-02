import type { MoveTask, Box, Expense, Reimbursement } from './types';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
      }
    };
  });
}

/** 兼容旧版本任务：补齐垫付账本相关字段 */
function normalize(task: MoveTask): MoveTask {
  return {
    ...task,
    boxes: task.boxes ?? [],
    expenses: task.expenses ?? [],
    reimbursements: task.reimbursements ?? [],
    dueWithinDays: task.dueWithinDays ?? 5,
  };
}

export async function getAllTasks(): Promise<MoveTask[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as MoveTask[]).map(normalize));
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? normalize(req.result as MoveTask) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTask(task: MoveTask): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.put(task);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTask(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function addBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes.push(box);
  await saveTask(task);
}

export async function updateBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const idx = task.boxes.findIndex((b) => b.id === box.id);
  if (idx === -1) throw new Error('Box not found');
  task.boxes[idx] = box;
  await saveTask(task);
}

export async function deleteBox(taskId: string, boxId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes = task.boxes.filter((b) => b.id !== boxId);
  await saveTask(task);
}

// ---------- 垫付与报销 ----------

export async function addExpense(taskId: string, expense: Expense): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.expenses.push(expense);
  await saveTask(task);
}

export async function updateExpense(taskId: string, expense: Expense): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const idx = task.expenses.findIndex((e) => e.id === expense.id);
  if (idx === -1) throw new Error('Expense not found');
  if (task.expenses[idx].reimbursementId) throw new Error('已报销的垫付不能修改');
  task.expenses[idx] = expense;
  await saveTask(task);
}

export async function deleteExpense(taskId: string, expenseId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const target = task.expenses.find((e) => e.id === expenseId);
  if (target?.reimbursementId) throw new Error('已报销的垫付不能删除，如需更正请撤销对应报销批次');
  task.expenses = task.expenses.filter((e) => e.id !== expenseId);
  await saveTask(task);
}

/**
 * 把勾选的若干笔垫付合成一次报销。
 * 已报销的笔会被拒绝，杜绝重复报销。
 */
export async function createReimbursement(
  taskId: string,
  expenseIds: string[],
  note?: string,
): Promise<Reimbursement> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (expenseIds.length === 0) throw new Error('请至少勾选一笔垫付');
  const selected = expenseIds.map((id) => {
    const e = task.expenses.find((x) => x.id === id);
    if (!e) throw new Error('垫付记录不存在');
    if (e.reimbursementId) throw new Error(`「${e.reason}」已报销，不能重复报销`);
    return e;
  });
  const byPayer: Record<string, number> = {};
  for (const e of selected) {
    byPayer[e.payer] = round2((byPayer[e.payer] ?? 0) + e.amount);
  }
  const batch: Reimbursement = {
    id: 'rb_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    expenseIds: selected.map((e) => e.id),
    total: round2(selected.reduce((sum, e) => sum + e.amount, 0)),
    byPayer,
    note: note?.trim() || undefined,
    createdAt: Date.now(),
  };
  for (const e of selected) {
    const idx = task.expenses.findIndex((x) => x.id === e.id);
    task.expenses[idx] = { ...task.expenses[idx], reimbursementId: batch.id };
  }
  task.reimbursements.push(batch);
  await saveTask(task);
  return batch;
}

/** 撤销报销批次：批次内垫付恢复为未报销，保证账实可重新对齐 */
export async function deleteReimbursement(taskId: string, batchId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (!task.reimbursements.some((r) => r.id === batchId)) throw new Error('报销批次不存在');
  task.reimbursements = task.reimbursements.filter((r) => r.id !== batchId);
  task.expenses = task.expenses.map((e) =>
    e.reimbursementId === batchId ? { ...e, reimbursementId: undefined } : e,
  );
  await saveTask(task);
}

export async function updateDueDays(taskId: string, days: number): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.dueWithinDays = days;
  await saveTask(task);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
