import { PB } from '../pocketbase/schema.mjs';
import { isDemoMode } from './authService.js';
import { demoAddUsage, demoUsage } from './demoStore.js';
import { isCurrentMonth } from '../js/format.js';
import { getItem, loadCatalog } from './inventoryService.js';
import { getFullList, hkpPost, relationId } from './hkpApi.js';

let cache = [];

export function mapUsage(row, item) {
  const assetId = relationId(row.asset) || row.asset_id;
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId,
    userName: row.user_name,
    department: row.department,
    usedAt: row.used_at,
    purpose: row.purpose,
    note: row.note || '',
    loanId: relationId(row.loan) || row.loan_id
  };
}

export async function loadUsage() {
  if (isDemoMode()) {
    cache = demoUsage().map((row) => mapUsage(row, getItem(relationId(row.asset))));
    return cache;
  }
  const rows = await getFullList(PB.usage, { sort: '-used_at' });
  cache = (rows || []).map((row) => mapUsage(row, getItem(relationId(row.asset))));
  return cache;
}

export function listUsage(propertyId) {
  const logs = Array.isArray(cache) ? cache.slice() : [];
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export async function addUsage({ propertyId, userName, department, usedAt, purpose, note }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  const data = isDemoMode()
    ? demoAddUsage({
      asset_id: item.id,
      user_name: userName,
      department,
      used_at: new Date(usedAt).toISOString(),
      purpose,
      note: note || null
    })
    : await hkpPost('/api/hkproperty/usage', {
    asset_id: item.id,
    user_name: userName,
    department,
    used_at: new Date(usedAt).toISOString(),
    purpose,
    note: note || null,
    usage_type: 'on_site',
    idempotency_key: `usage-${item.id}-${usedAt}-${userName}-${Math.random().toString(36).slice(2, 8)}`
  });
  await loadCatalog();
  await loadUsage();
  return { entry: mapUsage(data, item), item: getItem(propertyId) };
}

export function monthUsageCount() {
  return cache.filter((log) => isCurrentMonth(log.usedAt)).length;
}
