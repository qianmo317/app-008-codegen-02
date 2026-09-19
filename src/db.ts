import type { MoveTask, Box, Advance, Reimbursement } from './types';
import { uid, round2, DEFAULT_ADVANCE_DUE_DAYS } from './utils';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

// 兼容旧数据：补齐垫付账相关字段
function normalizeTask(t: MoveTask): MoveTask {
  if (!Array.isArray(t.advances)) t.advances = [];
  if (!Array.isArray(t.reimbursements)) t.reimbursements = [];
  if (typeof t.advanceDueDays !== 'number' || !(t.advanceDueDays > 0)) t.advanceDueDays = DEFAULT_ADVANCE_DUE_DAYS;
  return t;
}

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

export async function getAllTasks(): Promise<MoveTask[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as MoveTask[]).map(normalizeTask));
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => {
      const t = req.result as MoveTask | undefined;
      resolve(t ? normalizeTask(t) : null);
    };
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

export async function addAdvance(taskId: string, advance: Advance): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.advances!.push(advance);
  await saveTask(task);
}

export async function deleteAdvance(taskId: string, advanceId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const target = task.advances!.find((a) => a.id === advanceId);
  if (target?.reimbursementId) throw new Error('该笔垫付已报销，不能删除');
  task.advances = task.advances!.filter((a) => a.id !== advanceId);
  await saveTask(task);
}

// 勾选若干笔垫付合成一次报销；已报过的会被拒绝，防止重复报销
export async function createReimbursement(taskId: string, advanceIds: string[], note?: string): Promise<Reimbursement> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (advanceIds.length === 0) throw new Error('请先勾选要报销的垫付记录');
  const selected = task.advances!.filter((a) => advanceIds.includes(a.id));
  if (selected.length !== advanceIds.length) throw new Error('存在无效的垫付记录');
  if (selected.some((a) => a.reimbursementId)) throw new Error('包含已报销的记录，不能重复报销');
  const reimbursement: Reimbursement = {
    id: uid(),
    advanceIds: [...advanceIds],
    total: round2(selected.reduce((s, a) => s + a.amount, 0)),
    note: note || undefined,
    createdAt: Date.now(),
  };
  task.reimbursements!.push(reimbursement);
  for (const a of selected) a.reimbursementId = reimbursement.id;
  await saveTask(task);
  return reimbursement;
}

export async function setAdvanceDueDays(taskId: string, days: number): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.advanceDueDays = days;
  await saveTask(task);
}
