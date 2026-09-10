import { requireClient, throwIfError } from './supabaseClient.js';
import { getItem, loadCatalog } from './inventoryService.js';
import { isCurrentMonth } from '../js/format.js';

let cache = [];

export function mapUsage(row, item) {
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId: row.asset_id,
    userName: row.user_name,
    department: row.department,
    usedAt: row.used_at,
    purpose: row.purpose,
    note: row.note || '',
    loanId: row.loan_id
  };
}

export async function loadUsage() {
  const client = requireClient();
  const { data, error } = await client
    .from('usage_records')
    .select('*')
    .order('used_at', { ascending: false });
  throwIfError(error, '無法載入使用紀錄');
  cache = (data || []).map((row) => mapUsage(row, getItem(row.asset_id)));
  return cache;
}

export function listUsage(propertyId) {
  const logs = cache.slice();
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export async function addUsage({ propertyId, userName, department, usedAt, purpose, note }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  const client = requireClient();
  const { data, error } = await client.rpc('record_asset_usage', {
    p_asset_id: item.id,
    p_user_name: userName,
    p_department: department,
    p_used_at: new Date(usedAt).toISOString(),
    p_purpose: purpose,
    p_note: note || null
  });
  throwIfError(error, '現場使用登記失敗');
  await loadCatalog();
  await loadUsage();
  return { entry: mapUsage(data, item), item: getItem(propertyId) };
}

export function monthUsageCount() {
  return cache.filter((log) => isCurrentMonth(log.usedAt)).length;
}
