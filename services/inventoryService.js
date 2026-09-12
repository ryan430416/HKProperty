import { PB } from '../pocketbase/schema.mjs';
import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';
import { isDemoMode, isStaff } from './authService.js';
import { demoAssets, demoSavePhoto, demoSetActive } from './demoStore.js';
import { hkpPost } from './hkpApi.js';
import { logPocketBaseError, pbMessage, requireClient } from './pocketbaseClient.js';
import { publicImageUrl, uploadAssetImage } from './storageService.js';

export const AVAILABILITY = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  PENDING: 'reserved', // alias — UI 舊碼仍可用
  CHECKED_OUT: 'checked_out',
  OVERDUE: 'overdue',
  MAINTENANCE: 'maintenance',
  LOST: 'lost'
};

export const AVAILABILITY_LABEL = {
  available: '可借用',
  reserved: '已預借／待處理',
  pending: '已預借／待處理',
  checked_out: '已借出',
  overdue: '已逾期',
  maintenance: '維修中',
  lost: '異常'
};

const PUBLIC_FIELDS = 'id,property_id,name,location,specification,unit,availability_status,usage_count,is_borrowable,is_active,asset_status,brand,model,photo,audit_status';
const STAFF_FIELDS = `${PUBLIC_FIELDS},department,custodian,price,purchase_date,service_life,supplier,note,current_loan,last_audit_at,return_alert`;

let cache = [];
let loaded = false;
let overdueAssetIds = new Set();

function photoName(row) {
  const raw = row?.image || row?.photo;
  if (!raw) return '';
  if (typeof raw === 'string' && raw.startsWith('data:')) return raw;
  return Array.isArray(raw) ? raw[0] : raw;
}

export function mapAsset(row) {
  let availabilityStatus = row.availability_status || AVAILABILITY.AVAILABLE;
  if (availabilityStatus === 'pending') availabilityStatus = AVAILABILITY.RESERVED;
  if (availabilityStatus === AVAILABILITY.CHECKED_OUT && overdueAssetIds.has(row.id)) {
    availabilityStatus = AVAILABILITY.OVERDUE;
  }
  const filename = photoName(row);
  const borrowable = row.borrowable !== false && row.is_borrowable !== false;
  const active = row.active !== false && row.is_active !== false;
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
    status: row.asset_status === 'normal' || !row.asset_status ? '正常' : (row.asset_status === 'abnormal' ? '異常' : row.asset_status),
    note: row.note,
    brand: row.brand,
    model: row.model,
    isBorrowable: borrowable,
    isActive: active,
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
    const collection = staff ? PB.assets : PB.assetsPublic;
    options.fields = staff ? STAFF_FIELDS : PUBLIC_FIELDS;
    let data;
    try {
      data = await client.collection(collection).getFullList(options);
    } catch (error) {
      if (!staff) {
        logPocketBaseError('loadCatalog.public', error, { collection, fallback: PB.assets });
        data = await client.collection(PB.assets).getFullList({ sort: 'property_id', fields: PUBLIC_FIELDS });
      } else {
        throw error;
      }
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    cache = rows.map(mapAsset);
    await overlayUsageCounts(client);
    loaded = true;
    return listItems();
  } catch (error) {
    logPocketBaseError('loadCatalog', error, { collection: staff ? PB.assets : PB.assetsPublic });
    throw new Error(pbMessage(error, '無法載入財產清冊'));
  }
}

async function overlayUsageCounts(client) {
  try {
    const rows = await client.collection(PB.usageCounts).getFullList({ fields: 'id,usage_count' });
    const counts = new Map((rows || []).map((row) => [row.id, Number(row.usage_count || 0)]));
    cache = cache.map((item) => {
      if (!counts.has(item.id)) return item;
      const useCount = counts.get(item.id);
      return { ...item, useCount };
    });
  } catch (error) {
    logPocketBaseError('usageCounts', error, { collection: PB.usageCounts });
  }
}

export function clearInventoryCache() {
  cache = [];
  loaded = false;
}

export function isCatalogLoaded() {
  return loaded;
}

export function listItems() {
  return Array.isArray(cache) ? cache.slice() : [];
}

export function getItem(propertyId) {
  if (!Array.isArray(cache)) return null;
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
    auditStatuses: unique('auditStatus'),
    availabilities: unique('availabilityStatus')
  };
}

export function locationRanking(limit = 0) {
  const map = new Map();
  for (const item of listItems()) {
    const key = item.location || '未設定';
    map.set(key, (map.get(key) || 0) + 1);
  }
  const rows = [...map.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location, 'zh-Hant'));
  if (limit > 0) return rows.slice(0, limit);
  return rows;
}

export function getStats() {
  const items = listItems();
  const auditPending = items.filter((item) => item.auditStatus === AUDIT_STATUS.PENDING).length;
  return {
    total: items.length,
    available: items.filter((item) => item.availabilityStatus === AVAILABILITY.AVAILABLE).length,
    reserved: items.filter((item) => item.availabilityStatus === AVAILABILITY.RESERVED).length,
    approvalPending: items.filter((item) => item.availabilityStatus === AVAILABILITY.RESERVED).length,
    checkedOut: items.filter((item) => item.availabilityStatus === AVAILABILITY.CHECKED_OUT).length,
    overdue: items.filter((item) => item.availabilityStatus === AVAILABILITY.OVERDUE).length,
    maintenance: items.filter((item) => item.availabilityStatus === AVAILABILITY.MAINTENANCE).length,
    lost: items.filter((item) => item.availabilityStatus === AVAILABILITY.LOST).length,
    pending: auditPending
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
  else await hkpPost(`/api/hkproperty/assets/${item.id}/active`, { active: isActive, is_active: isActive });
  await loadCatalog();
  return getItem(propertyId);
}
