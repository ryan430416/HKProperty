import { STORAGE_KEYS, readStore, writeStore } from './storageService.js';
import { incrementUseCount } from './inventoryService.js';
import { isCurrentMonth } from '../js/format.js';

function all() {
  return readStore(STORAGE_KEYS.usage, []);
}

function save(list) {
  writeStore(STORAGE_KEYS.usage, list);
}

export function listUsage(propertyId) {
  const logs = all().slice().sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt));
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId);
}

export function addUsage({ propertyId, userName, department, usedAt, purpose, note, loanId = null, countUsage = true }) {
  if (!propertyId) throw new Error('缺少財產編號');
  if (!userName?.trim()) throw new Error('請填寫使用人');
  if (!department?.trim()) throw new Error('請填寫使用單位');
  if (!usedAt) throw new Error('請填寫使用日期與時間');
  if (!purpose?.trim()) throw new Error('請填寫使用用途');

  const usedDate = new Date(usedAt);
  if (Number.isNaN(usedDate.getTime())) throw new Error('使用時間格式不正確');

  const entry = {
    id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    propertyId,
    userName: userName.trim(),
    department: department.trim(),
    usedAt: usedDate.toISOString(),
    purpose: purpose.trim(),
    note: (note || '').trim(),
    loanId
  };

  const list = all();
  list.push(entry);
  save(list);
  const item = countUsage ? incrementUseCount(propertyId) : null;
  return { entry, item };
}

export function monthUsageCount() {
  return all().filter((log) => isCurrentMonth(log.usedAt)).length;
}
