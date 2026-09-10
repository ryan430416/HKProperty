import { readJson, writeJson } from './storage.js';
import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';

const CATALOG_URL = 'data/inventory.json';
const OVERRIDE_KEY = 'overrides';

let catalog = [];
let loaded = false;

function getOverrides() {
  return readJson(OVERRIDE_KEY, {});
}

function saveOverrides(map) {
  writeJson(OVERRIDE_KEY, map);
}

function mergeItem(base) {
  const override = getOverrides()[base.propertyId] || {};
  return {
    ...base,
    originalLocation: base.location,
    location: override.location ?? base.location,
    useCount: Number.isFinite(override.useCount) ? override.useCount : 0,
    lastAuditAt: override.lastAuditAt ?? null,
    auditStatus: override.auditStatus ?? AUDIT_STATUS.PENDING,
    image: override.image || PLACEHOLDER_IMAGE,
    hasCustomImage: Boolean(override.image)
  };
}

export async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('無法載入財產清冊資料');
  }
  const payload = await response.json();
  catalog = Array.isArray(payload.items) ? payload.items : [];
  loaded = true;
  return listItems();
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
  map[propertyId] = { ...(map[propertyId] || {}), ...patch };
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
  return patchItem(propertyId, { image: dataUrl });
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
    )).length
  };
}
