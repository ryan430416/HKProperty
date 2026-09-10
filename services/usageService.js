import { readJson, uid, writeJson } from './storage.js';
import { incrementUseCount } from './inventoryService.js';
import { isCurrentMonth } from '../js/format.js';

const KEY = 'usageLogs';

function all() {
  return readJson(KEY, []);
}

function save(list) {
  writeJson(KEY, list);
}

export function listUsage(propertyId) {
  const logs = all().slice().sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt));
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId);
}

export function addUsage({ propertyId, userName, department, usedAt, purpose, note }) {
  if (!propertyId) throw new Error('缺少財產編號');
  if (!userName?.trim()) throw new Error('請填寫使用人');
  if (!department?.trim()) throw new Error('請填寫使用單位');
  if (!usedAt) throw new Error('請填寫使用日期與時間');
  if (!purpose?.trim()) throw new Error('請填寫使用用途');

  const usedDate = new Date(usedAt);
  if (Number.isNaN(usedDate.getTime())) throw new Error('使用時間格式不正確');

  const entry = {
    id: uid('use'),
    propertyId,
    userName: userName.trim(),
    department: department.trim(),
    usedAt: usedDate.toISOString(),
    purpose: purpose.trim(),
    note: (note || '').trim()
  };

  const list = all();
  list.push(entry);
  save(list);
  const item = incrementUseCount(propertyId);
  return { entry, item };
}

export function monthUsageCount() {
  return all().filter((log) => isCurrentMonth(log.usedAt)).length;
}
