import { STORAGE_KEYS, readStore, uid, writeStore } from './storageService.js';
import { AUDIT_RESULTS, AUDIT_STATUS, nowIso } from '../js/format.js';
import { getItem, patchItem, updateLocation } from './inventoryService.js';

function read(key) {
  return readStore(key, []);
}

function write(key, list) {
  writeStore(key, list);
}

export function listAudits(propertyId) {
  const logs = read(STORAGE_KEYS.audits).slice().sort((a, b) => new Date(b.auditedAt) - new Date(a.auditedAt));
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId);
}

export function listLocationChanges(propertyId) {
  const logs = read(STORAGE_KEYS.locations).slice().sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId);
}

function statusFromResult(result) {
  if (result === AUDIT_RESULTS.MATCH) return AUDIT_STATUS.DONE;
  if (result === AUDIT_RESULTS.MISMATCH) return AUDIT_STATUS.MISMATCH;
  if (result === AUDIT_RESULTS.MISSING) return AUDIT_STATUS.MISSING;
  if (result === AUDIT_RESULTS.DAMAGED) return AUDIT_STATUS.DAMAGED;
  throw new Error('請選擇盤點結果');
}

export function addAudit({ propertyId, registeredLocation, actualLocation, result, auditor, auditedAt, note }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  if (!auditor?.trim()) throw new Error('請填寫盤點人');
  if (!actualLocation?.trim()) throw new Error('請填寫本次實際位置');
  if (!result) throw new Error('請選擇盤點結果');

  const auditedDate = new Date(auditedAt || Date.now());
  if (Number.isNaN(auditedDate.getTime())) throw new Error('盤點時間格式不正確');

  if (result === AUDIT_RESULTS.MATCH && actualLocation.trim() !== registeredLocation) {
    throw new Error('實際位置與系統登記位置不同，請改選「位置異常」');
  }

  const entry = {
    id: uid('audit'),
    propertyId,
    registeredLocation,
    actualLocation: actualLocation.trim(),
    result,
    auditor: auditor.trim(),
    auditedAt: auditedDate.toISOString(),
    note: (note || '').trim()
  };

  const list = read(STORAGE_KEYS.audits);
  list.push(entry);
  write(STORAGE_KEYS.audits, list);

  const updated = patchItem(propertyId, {
    lastAuditAt: entry.auditedAt,
    auditStatus: statusFromResult(result)
  });

  return {
    entry,
    item: updated,
    needsLocationConfirm: result === AUDIT_RESULTS.MISMATCH && actualLocation.trim() !== registeredLocation
  };
}

export function confirmLocationUpdate({ propertyId, fromLocation, toLocation, operator, reason }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  if (!toLocation?.trim()) throw new Error('請填寫新的存放位置');
  if (fromLocation === toLocation.trim()) throw new Error('新位置與目前位置相同');

  const entry = {
    id: uid('loc'),
    propertyId,
    fromLocation,
    toLocation: toLocation.trim(),
    operator: (operator || '管理者').trim(),
    reason: (reason || '盤點後確認更新位置').trim(),
    changedAt: nowIso()
  };
  const list = read(STORAGE_KEYS.locations);
  list.push(entry);
  write(STORAGE_KEYS.locations, list);
  const updated = updateLocation(propertyId, entry.toLocation);
  return { entry, item: updated };
}
