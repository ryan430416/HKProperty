const LEGACY = {
  overrides: 'hkproperty.overrides',
  usage: 'hkproperty.usageLogs',
  audits: 'hkproperty.auditLogs',
  locations: 'hkproperty.locationLogs'
};

export const STORAGE_KEYS = {
  overrides: 'hkproperty_asset_overrides',
  loans: 'hkproperty_loan_records',
  usage: 'hkproperty_usage_records',
  audits: 'hkproperty_audit_records',
  locations: 'hkproperty_location_records',
  images: 'hkproperty_images'
};

function parse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readStore(key, fallback) {
  return parse(localStorage.getItem(key), fallback);
}

export function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function migrateList(oldKey, newKey) {
  const next = readStore(newKey, null);
  if (next) return;
  const old = readStore(oldKey, null);
  if (Array.isArray(old)) writeStore(newKey, old);
}

function migrateOverridesAndImages() {
  const hasNew = localStorage.getItem(STORAGE_KEYS.overrides);
  if (hasNew) return;
  const old = readStore(LEGACY.overrides, {});
  if (!old || typeof old !== 'object') return;
  const overrides = {};
  const images = readStore(STORAGE_KEYS.images, {});
  for (const [id, value] of Object.entries(old)) {
    const copy = { ...(value || {}) };
    if (copy.image) {
      images[id] = copy.image;
      delete copy.image;
    }
    overrides[id] = copy;
  }
  writeStore(STORAGE_KEYS.overrides, overrides);
  writeStore(STORAGE_KEYS.images, images);
}

export function migrateLegacyStorage() {
  migrateOverridesAndImages();
  migrateList(LEGACY.usage, STORAGE_KEYS.usage);
  migrateList(LEGACY.audits, STORAGE_KEYS.audits);
  migrateList(LEGACY.locations, STORAGE_KEYS.locations);
  if (!localStorage.getItem(STORAGE_KEYS.loans)) writeStore(STORAGE_KEYS.loans, []);
  if (!localStorage.getItem(STORAGE_KEYS.images)) writeStore(STORAGE_KEYS.images, {});
}
