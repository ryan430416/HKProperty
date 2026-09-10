import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';
import { isStaff } from './authService.js';
import { publicImageUrl, uploadAssetImage } from './storageService.js';
import { requireClient, throwIfError } from './supabaseClient.js';

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

let cache = [];
let loaded = false;
let overdueAssetIds = new Set();

function primaryImage(row) {
  const images = row.asset_images || row.images || [];
  const primary = images.find((img) => img.is_primary) || images[0];
  return primary?.storage_path ? publicImageUrl(primary.storage_path) : PLACEHOLDER_IMAGE;
}

export function mapAsset(row) {
  let availabilityStatus = row.availability_status || AVAILABILITY.AVAILABLE;
  if (availabilityStatus === AVAILABILITY.CHECKED_OUT && overdueAssetIds.has(row.id)) {
    availabilityStatus = AVAILABILITY.OVERDUE;
  }
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
    currentLoanId: row.current_loan_id || null,
    returnAlert: row.return_alert || null,
    image: primaryImage(row),
    hasCustomImage: Boolean((row.asset_images || []).length)
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
  const client = requireClient();
  const staff = isStaff();
  const table = staff ? 'assets' : 'assets_basic';
  let query = client.from(table).select(staff ? '*, asset_images(*)' : '*').order('property_id');
  const { data, error } = await query;
  throwIfError(error, '無法載入財產清冊');
  cache = (data || []).map(mapAsset);
  loaded = true;
  return listItems();
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
  await uploadAssetImage(item.id, file);
  await loadCatalog();
  return getItem(propertyId);
}

export async function setAssetActive(propertyId, isActive) {
  const item = getItem(propertyId);
  if (!item) throw new Error('找不到財產');
  const client = requireClient();
  const { error } = await client.rpc('admin_set_asset_active', {
    p_asset_id: item.id,
    p_is_active: isActive
  });
  throwIfError(error, '無法更新財產狀態');
  await loadCatalog();
  return getItem(propertyId);
}

export { PLACEHOLDER_IMAGE };
