import { STORAGE_KEYS, migrateLegacyStorage, readStore, uid, writeStore } from './storageService.js';
import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';

export const AVAILABILITY = {
  AVAILABLE: 'available',
  CHECKED_OUT: 'checked_out',
  OVERDUE: 'overdue',
  MAINTENANCE: 'maintenance',
  LOST: 'lost'
};

export const AVAILABILITY_LABEL = {
  available: '可借用',
  checked_out: '已借出',
  overdue: '已逾期',
  maintenance: '維修中',
  lost: '異常'
};

const CATALOG_URL = 'data/inventory.json';

let catalog = [];
let loaded = false;

migrateLegacyStorage();

function getOverrides() {
  return readStore(STORAGE_KEYS.overrides, {});
}

function saveOverrides(map) {
  writeStore(STORAGE_KEYS.overrides, map);
}

function getImages() {
  return readStore(STORAGE_KEYS.images, {});
}

function saveImages(map) {
  writeStore(STORAGE_KEYS.images, map);
}

function mergeItem(base) {
  const override = getOverrides()[base.propertyId] || {};
  const image = getImages()[base.propertyId];
  const availabilityStatus = override.availabilityStatus || AVAILABILITY.AVAILABLE;
  return {
    ...base,
    originalLocation: base.location,
    location: override.location ?? base.location,
    useCount: Number.isFinite(override.useCount) ? override.useCount : 0,
    lastAuditAt: override.lastAuditAt ?? null,
    auditStatus: override.auditStatus ?? AUDIT_STATUS.PENDING,
    availabilityStatus,
    availabilityLabel: AVAILABILITY_LABEL[availabilityStatus] || AVAILABILITY_LABEL.available,
    currentLoanId: override.currentLoanId ?? null,
    returnAlert: override.returnAlert ?? null,
    image: image || PLACEHOLDER_IMAGE,
    hasCustomImage: Boolean(image)
  };
}

export async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`無法載入財產清冊資料（HTTP ${response.status}）。請確認以本機或網站伺服器開啟，且 data/inventory.json 存在。`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('財產清冊資料格式不正確，無法解析 inventory.json。');
  }
  catalog = Array.isArray(payload.items) ? payload.items : [];
  if (!catalog.length) {
    throw new Error('財產清冊沒有資料，請確認 inventory.json 內容。');
  }
  loaded = true;
  return listItems();
}

export function isCatalogLoaded() {
  return loaded;
}

export function listItems() {
  if (!loaded) return [];
  return catalog.map(mergeItem);
}

export function getItem(propertyId) {
  const id = String(propertyId ?? '').trim();
  const base = catalog.find((item) => item.propertyId === id);
  return base ? mergeItem(base) : null;
}

export function findByPropertyId(propertyId) {
  return getItem(propertyId);
}

export function patchItem(propertyId, patch) {
  const map = getOverrides();
  const next = { ...(map[propertyId] || {}), ...patch };
  if ('image' in next) delete next.image;
  map[propertyId] = next;
  saveOverrides(map);
  return getItem(propertyId);
}

export function incrementUseCount(propertyId) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  return patchItem(propertyId, { useCount: item.useCount + 1 });
}

export function updateLocation(propertyId, location) {
  return patchItem(propertyId, { location });
}

export function saveImage(propertyId, dataUrl) {
  const images = getImages();
  images[propertyId] = dataUrl;
  saveImages(images);
  return getItem(propertyId);
}

export function getFilterOptions() {
  const items = listItems();
  const unique = (key) => [...new Set(items.map((item) => item[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hant'));
  return {
    locations: unique('location'),
    departments: unique('department'),
    statuses: unique('status'),
    auditStatuses: [...new Set(items.map((item) => item.auditStatus))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  };
}

export function locationRanking(limit = 10) {
  const counts = new Map();
  for (const item of listItems()) {
    const key = item.location || '未提供';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location, 'zh-Hant'))
    .slice(0, limit);
}

export function getStats() {
  const items = listItems();
  return {
    total: items.length,
    done: items.filter((item) => item.auditStatus === AUDIT_STATUS.DONE).length,
    pending: items.filter((item) => item.auditStatus === AUDIT_STATUS.PENDING).length,
    mismatch: items.filter((item) => (
      item.auditStatus === AUDIT_STATUS.MISMATCH || item.auditStatus === AUDIT_STATUS.MISSING
    )).length,
    available: items.filter((item) => item.availabilityStatus === AVAILABILITY.AVAILABLE).length,
    checkedOut: items.filter((item) => item.availabilityStatus === AVAILABILITY.CHECKED_OUT).length,
    overdue: items.filter((item) => item.availabilityStatus === AVAILABILITY.OVERDUE).length,
    maintenance: items.filter((item) => item.availabilityStatus === AVAILABILITY.MAINTENANCE).length,
    lost: items.filter((item) => item.availabilityStatus === AVAILABILITY.LOST).length
  };
}

export { uid };
