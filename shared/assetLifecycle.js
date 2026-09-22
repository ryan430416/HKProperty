/**
 * Formal / soft-deleted / test asset lifecycle helpers (client + server safe).
 */

const TEST_PROPERTY_RE = /^(PROD-SMOKE-TMP-|PREVIEW-TMP-)/i;

export function isSoftDeletedRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.isSoftDeleted === true) return true;
  const deletedAt = row.deleted_at ?? row.deletedAt;
  return deletedAt != null && String(deletedAt).trim() !== '';
}

export function isTestPropertyId(propertyId) {
  return TEST_PROPERTY_RE.test(String(propertyId || ''));
}

export function isEnabledRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.enabled === true) return true;
  if (row.enabled === false) return false;
  // Legacy rows may omit enabled; fall back to is_active / isActive.
  if (row.is_active === false || row.isActive === false || row.active === false) return false;
  return true;
}

/**
 * Formal operational asset shown in public menus, desk, stats (target: 390).
 * Requires: enabled, not soft-deleted, not smoke/preview TMP id.
 */
export function isOperationalAsset(row) {
  if (!row || typeof row !== 'object') return false;
  const propertyId = row.property_id ?? row.propertyId;
  if (isTestPropertyId(propertyId)) return false;
  if (isSoftDeletedRow(row)) return false;
  return isEnabledRow(row);
}

export function assetLifecycle(row) {
  if (isSoftDeletedRow(row)) return 'soft_deleted';
  if (!isEnabledRow(row)) return 'disabled';
  if (isTestPropertyId(row.property_id ?? row.propertyId)) return 'test';
  return 'active';
}

/** Hide Preview / TMP session titles from end users without mutating history. */
export function displayInventorySessionTitle(title) {
  const text = String(title || '').trim();
  if (!text) return '財產盤點';
  if (/preview/i.test(text) || /PROD-SMOKE|PREVIEW-TMP/i.test(text)) return '財產盤點';
  return text;
}
