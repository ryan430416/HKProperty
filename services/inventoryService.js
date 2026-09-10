import { PB } from '../pocketbase/schema.mjs';
import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';
import { isDemoMode, isStaff } from './authService.js';
import { demoAssets, demoSavePhoto, demoSetActive } from './demoStore.js';
import { hkpPost } from './hkpApi.js';
import { pbMessage, requireClient } from './pocketbaseClient.js';
import { publicImageUrl, uploadAssetImage } from './storageService.js';

export const AVAILABILITY = {
  AVAILABLE: 'available',
  PENDING: 'pending',
  CHECKED_OUT: 'checked_out',
  OVERDUE: 'overdue',
  MAINTENANCE: 'maintenance',
  LOST: 'lost'
};

export const AVAILABILITY_LABEL = {
  available: '可借用',
  pending: '待核准',
  checked_out: '已借出',
  overdue: '已逾期',
  maintenance: '維修中',
  lost: '異常'
};

const BASIC_FIELDS = 'id,property_id,name,location,department,specification,unit,availability_status,usage_count,is_borrowable,is_active,current_loan,audit_status,last_audit_at,created,updated,photo';

let cache = [];
let loaded = false;
let overdueAssetIds = new Set();

function photoName(row) {
  if (!row?.photo) return '';
  if (typeof row.photo === 'string' && row.photo.startsWith('data:')) return row.photo;
  return Array.isArray(row.photo) ? row.photo[0] : row.photo;
}

export function mapAsset(row) {
  let availabilityStatus = row.availability_status || AVAILABILITY.AVAILABLE;
  if (availabilityStatus === AVAILABILITY.CHECKED_OUT && overdueAssetIds.has(row.id)) {
    availabilityStatus = AVAILABILITY.OVERDUE;
  }
  const filename = photoName(row);
  return {
    id: row.id,
    propertyId: String(row.property_id),
    name: row.name,
    location: row.location,
    originalLocation: row.location,
    department: row.department,
    custodian: row.custodian,
    specification: row.specification,
    unit: row.unit,
    price: row.price,
    purchaseDate: row.purchase_date,
    serviceLife: row.service_life,
    supplier: row.supplier,
    status: row.asset_status === 'normal' ? '正常' : (row.asset_status || '正常'),
    note: row.note,
    brand: row.brand,
    model: row.model,
    isBorrowable: row.is_borrowable !== false,
    isActive: row.is_active !== false,
    useCount: Number(row.usage_count || 0),
    lastAuditAt: row.last_audit_at || null,
    auditStatus: row.audit_status || AUDIT_STATUS.PENDING,
    availabilityStatus,
    availabilityLabel: AVAILABILITY_LABEL[availabilityStatus] || AVAILABILITY_LABEL.available,
    currentLoanId: row.current_loan || null,
    returnAlert: row.return_alert || null,
    image: !filename ? PLACEHOLDER_IMAGE : filename.startsWith('data:') ? filename : publicImageUrl(row, filename),
    hasCustomImage: Boolean(filename),
    _raw: row
  };
}

export function setOverdueAssetIds(ids) {
  overdueAssetIds = new Set(ids || []);
  cache = cache.map((item) => {
    const rawStatus = item.availabilityStatus === AVAILABILITY.OVERDUE ? AVAILABILITY.CHECKED_OUT : item.availabilityStatus;
    const availabilityStatus = rawStatus === AVAILABILITY.CHECKED_OUT && overdueAssetIds.has(item.id)
      ? AVAILABILITY.OVERDUE
      : rawStatus;
    return {
      ...item,
      availabilityStatus,
      availabilityLabel: AVAILABILITY_LABEL[availabilityStatus] || item.availabilityLabel
    };
  });
}

export async function loadCatalog() {
  if (isDemoMode()) {
    cache = demoAssets().map(mapAsset);
    loaded = true;
    return listItems();
  }
  const client = requireClient();
  const staff = isStaff();
  try {
    const options = { sort: 'property_id' };
    if (!staff) {
      options.filter = 'is_active = true';
      options.fields = BASIC_FIELDS;
    }
    const data = await client.collection(PB.assets).getFullList(options);
    cache = (data || []).map(mapAsset);
    loaded = true;
    return listItems();
  } catch (error) {
    throw new Error(pbMessage(error, '無法載入財產清冊'));
  }
}

export function isCatalogLoaded() {
  return loaded;
}

export function listItems() {
  return cache.slice();
}

export function getItem(propertyId) {
  const id = String(propertyId ?? '').trim();
  return cache.find((item) => item.propertyId === id || item.id === id) || null;
}

export function findByPropertyId(propertyId) {
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
    approvalPending: items.filter((item) => item.availabilityStatus === AVAILABILITY.PENDING).length,
    checkedOut: items.filter((item) => item.availabilityStatus === AVAILABILITY.CHECKED_OUT).length,
    overdue: items.filter((item) => item.availabilityStatus === AVAILABILITY.OVERDUE).length,
    maintenance: items.filter((item) => item.availabilityStatus === AVAILABILITY.MAINTENANCE).length,
    lost: items.filter((item) => item.availabilityStatus === AVAILABILITY.LOST).length
  };
}

export async function saveImage(propertyId, file) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  if (isDemoMode()) await demoSavePhoto(item.id, file);
  else await uploadAssetImage(item.id, file);
  await loadCatalog();
  return getItem(propertyId);
}

export async function setAssetActive(propertyId, isActive) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  if (isDemoMode()) demoSetActive(item.id, isActive);
  else await hkpPost(`/api/hkp/assets/${item.id}/active`, { is_active: isActive });
  await loadCatalog();
  return getItem(propertyId);
}

export { PLACEHOLDER_IMAGE };
