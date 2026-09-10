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
  images: 'hkproperty_images',
  activity: 'hkproperty_activity_records'
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
  if (!localStorage.getItem(STORAGE_KEYS.activity)) writeStore(STORAGE_KEYS.activity, []);
}

export function restoreAppStorage(snap) {
  for (const key of Object.values(STORAGE_KEYS)) {
    if (snap[key] == null) localStorage.removeItem(key);
    else localStorage.setItem(key, snap[key]);
  }
}

export function snapshotAppStorage() {
  const snap = {};
  for (const key of Object.values(STORAGE_KEYS)) {
    snap[key] = localStorage.getItem(key);
  }
  return snap;
}

export function storageUsageBytes() {
  let chars = 0;
  const details = [];
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    const raw = localStorage.getItem(key) || '';
    chars += raw.length;
    details.push({ name, key, bytes: raw.length * 2 });
  }
  return { bytes: chars * 2, details };
}

export function exportOperationalJson() {
  const data = {};
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    data[name] = readStore(key, key.includes('image') || name === 'overrides' ? {} : []);
  }
  return {
    exportedAt: new Date().toISOString(),
    note: '不含原始財產清冊 inventory.json',
    data
  };
}

export function importOperationalJson(payload) {
  const bundle = payload?.data || payload;
  if (!bundle || typeof bundle !== 'object') throw new Error('匯入資料格式不正確');
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    if (bundle[name] !== undefined) writeStore(key, bundle[name]);
  }
}

export function clearOperationalData() {
  writeStore(STORAGE_KEYS.loans, []);
  writeStore(STORAGE_KEYS.usage, []);
  writeStore(STORAGE_KEYS.audits, []);
  writeStore(STORAGE_KEYS.locations, []);
  writeStore(STORAGE_KEYS.images, {});
  writeStore(STORAGE_KEYS.activity, []);
  writeStore(STORAGE_KEYS.overrides, {});
}
