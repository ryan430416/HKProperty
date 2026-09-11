import { PB } from '../pocketbase/schema.mjs';
import { isDemoMode } from './authService.js';
import { demoAddAudit, demoAudits, demoLocations, demoUpdateLocation } from './demoStore.js';
import { AUDIT_RESULTS, AUDIT_STATUS } from '../js/format.js';
import { getItem, loadCatalog } from './inventoryService.js';
import { getFullList, hkpPost, relationId } from './hkpApi.js';

let auditCache = [];
let locationCache = [];

export function mapAudit(row, item) {
  const assetId = relationId(row.asset) || row.asset_id;
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId,
    registeredLocation: row.registered_location,
    actualLocation: row.actual_location,
    result: row.result,
    auditor: row.auditor,
    auditedAt: row.audited_at,
    note: row.note || ''
  };
}

export function mapLocation(row, item) {
  const assetId = relationId(row.asset) || row.asset_id;
  return {
    id: row.id,
    propertyId: item?.propertyId || row.property_id,
    assetId,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    operator: row.operator_name,
    reason: row.reason,
    changedAt: row.created || row.changed_at
  };
}

export async function loadAudits() {
  if (isDemoMode()) {
    auditCache = demoAudits().map((row) => mapAudit(row, getItem(relationId(row.asset))));
    return auditCache;
  }
  try {
    const rows = await getFullList(PB.audits, { sort: '-audited_at' });
    auditCache = (rows || []).map((row) => mapAudit(row, getItem(relationId(row.asset))));
  } catch {
    auditCache = [];
  }
  return auditCache;
}

export async function loadLocationHistory() {
  if (isDemoMode()) {
    locationCache = demoLocations().map((row) => mapLocation(row, getItem(relationId(row.asset))));
    return locationCache;
  }
  try {
    const rows = await getFullList(PB.locations, { sort: '-created' });
    locationCache = (rows || []).map((row) => mapLocation(row, getItem(relationId(row.asset))));
  } catch {
    locationCache = [];
  }
  return locationCache;
}

export function listAudits(propertyId) {
  const logs = Array.isArray(auditCache) ? auditCache.slice() : [];
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export function listLocationChanges(propertyId) {
  const logs = Array.isArray(locationCache) ? locationCache.slice() : [];
  if (!propertyId) return logs;
  return logs.filter((log) => log.propertyId === propertyId || log.assetId === propertyId);
}

export async function addAudit({ propertyId, registeredLocation, actualLocation, result, auditor, auditedAt, note }) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  if (isDemoMode()) {
    demoAddAudit({
      asset_id: item.id,
      registered_location: registeredLocation,
      actual_location: actualLocation,
      result,
      auditor,
      audited_at: new Date(auditedAt || Date.now()).toISOString(),
      note: note || null
    });
  } else {
    await hkpPost('/api/hkproperty/audits', {
    asset_id: item.id,
    registered_location: registeredLocation,
    actual_location: actualLocation,
    result,
    auditor,
    audited_at: new Date(auditedAt || Date.now()).toISOString(),
    note: note || null
  });
  }
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
  if (isDemoMode()) {
    demoUpdateLocation(item.id, {
      from_location: fromLocation,
      to_location: toLocation,
      reason: reason || `由 ${operator || '管理者'} 更新位置`
    });
  } else {
    await hkpPost(`/api/hkproperty/assets/${item.id}/location`, {
    from_location: fromLocation,
    to_location: toLocation,
    reason: reason || `由 ${operator || '管理者'} 更新位置`
  });
  }
  await Promise.all([loadCatalog(), loadLocationHistory()]);
  return { item: getItem(propertyId), entry: listLocationChanges(propertyId)[0] };
}

export { AUDIT_STATUS };
