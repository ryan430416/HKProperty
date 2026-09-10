import { AUDIT_RESULTS, AUDIT_STATUS } from '../js/format.js';
import { getItem, loadCatalog } from './inventoryService.js';
import { requireClient, throwIfError } from './supabaseClient.js';

let auditCache = [];
let locationCache = [];

export function mapAudit(row, item) {
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId: row.asset_id,
    registeredLocation: row.registered_location,
    actualLocation: row.actual_location,
    result: row.result,
    auditor: row.auditor,
    auditedAt: row.audited_at,
    note: row.note || ''
  };
}

export function mapLocation(row, item) {
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId: row.asset_id,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    operator: row.operator_name,
    reason: row.reason,
    changedAt: row.changed_at
  };
}

export async function loadAudits() {
  const client = requireClient();
  const { data, error } = await client
    .from('inventory_audits')
    .select('*')
    .order('audited_at', { ascending: false });
  if (error) {
    auditCache = [];
    return auditCache;
  }
  auditCache = (data || []).map((row) => mapAudit(row, getItem(row.asset_id)));
  return auditCache;
}

export async function loadLocationHistory() {
  const client = requireClient();
  const { data, error } = await client
    .from('location_history')
    .select('*')
    .order('changed_at', { ascending: false });
  if (error) {
    locationCache = [];
    return locationCache;
  }
  locationCache = (data || []).map((row) => mapLocation(row, getItem(row.asset_id)));
  return locationCache;
}

export function listAudits(propertyId) {
  const logs = auditCache.slice();
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export function listLocationChanges(propertyId) {
  const logs = locationCache.slice();
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export async function addAudit({ propertyId, registeredLocation, actualLocation, result, auditor, auditedAt, note }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  const client = requireClient();
  const { error } = await client.rpc('record_inventory_audit', {
    p_asset_id: item.id,
    p_registered_location: registeredLocation,
    p_actual_location: actualLocation,
    p_result: result,
    p_auditor: auditor,
    p_audited_at: new Date(auditedAt || Date.now()).toISOString(),
    p_note: note || null
  });
  throwIfError(error, '盤點失敗');
  await Promise.all([loadCatalog(), loadAudits()]);
  const updated = getItem(propertyId);
  return {
    entry: listAudits(propertyId)[0],
    item: updated,
    needsLocationConfirm: result === AUDIT_RESULTS.MISMATCH && String(actualLocation).trim() !== registeredLocation
  };
}

export async function confirmLocationUpdate({ propertyId, fromLocation, toLocation, operator, reason }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  const client = requireClient();
  const { error } = await client.rpc('update_asset_location', {
    p_asset_id: item.id,
    p_from_location: fromLocation,
    p_to_location: toLocation,
    p_reason: reason || `由 ${operator || '管理者'} 更新位置`
  });
  throwIfError(error, '位置更新失敗');
  await Promise.all([loadCatalog(), loadLocationHistory()]);
  return { item: getItem(propertyId), entry: listLocationChanges(propertyId)[0] };
}

export { AUDIT_STATUS };
