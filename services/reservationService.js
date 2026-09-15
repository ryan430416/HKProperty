import { PB } from '../pocketbase/schema.mjs';
import { getProfile, isDemoMode } from './authService.js';
import {
  demoApproveReservation,
  demoCancelReservation,
  demoCreateReservation,
  demoRejectReservation,
  demoReservations
} from './demoStore.js';
import { getItem, loadCatalog } from './inventoryService.js';
import { getFullList, hkpPost, relationId } from './hkpApi.js';
import { loadLoans } from './loanService.js';

let cache = [];

export const RESERVATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  CONVERTED: 'converted'
};

export const RESERVATION_STATUS_LABEL = {
  pending: '待核准',
  approved: '已核准',
  rejected: '已拒絕',
  cancelled: '已取消',
  expired: '已過期',
  converted: '已轉借出'
};

export function mapReservation(row) {
  const assetId = relationId(row.asset) || row.asset_id || row.asset;
  const item = getItem(assetId) || getItem(row.property_id);
  return {
    recordId: row.id,
    id: row.reservation_number || row.id,
    assetId,
    propertyId: item?.propertyId || row.property_id || '',
    propertyName: item?.name || row.property_name || row.expand?.asset?.name || '',
    userId: relationId(row.user) || row.user_id || row.user || '',
    userName: row.user_name || row.borrower_name || row.expand?.user?.name || '',
    purpose: row.purpose,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    statusLabel: RESERVATION_STATUS_LABEL[row.status] || row.status,
    rejectionReason: row.rejection_reason || '',
    contact: row.contact || row.borrower_phone || '',
    note: row.note || row.notes || '',
    approvedAt: row.approved_at,
    convertedLoanId: relationId(row.converted_loan) || ''
  };
}

export function clearReservationCache() {
  cache = [];
}

export async function loadReservations() {
  if (isDemoMode()) {
    cache = demoReservations().map(mapReservation);
    return cache;
  }
  const rows = await getFullList(PB.timeLocks, { sort: '-created', expand: 'asset' });
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row.reservation_number || row.id;
    if (groups.has(key)) continue;
    groups.set(key, mapReservation(row));
  }
  cache = [...groups.values()];
  return cache;
}

export function listReservations(propertyId) {
  const list = Array.isArray(cache) ? cache.slice() : [];
  if (!propertyId) return list;
  return list.filter((row) => row.propertyId === propertyId || row.assetId === propertyId);
}

export function listMyReservations() {
  const profile = getProfile();
  if (!profile?.id) return [];
  return listReservations().filter((row) => row.userId === profile.id);
}

export function listManageReservations() {
  return listReservations().filter((row) => ['pending', 'approved'].includes(row.status));
}

export async function createReservation(payload) {
  const item = getItem(payload.propertyId);
  if (!item) throw new Error('找不到財產');
  if (!String(payload.purpose || '').trim()) throw new Error('請填寫預約用途');
  if (!payload.startAt || !payload.endAt) throw new Error('請填寫預約起迄時間');
  if (new Date(payload.endAt) <= new Date(payload.startAt)) throw new Error('預約結束時間必須晚於開始時間');
  if (new Date(payload.startAt).getTime() < Date.now() - 60_000) throw new Error('不可預約過去時間');
  const body = {
    asset_id: item.id,
    purpose: payload.purpose,
    start_at: new Date(payload.startAt).toISOString(),
    end_at: new Date(payload.endAt).toISOString(),
    contact: payload.contact || null,
    note: payload.note || null
  };
  const data = isDemoMode()
    ? demoCreateReservation(body)
    : await hkpPost('/api/hkproperty/reservations', body);
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function approveReservation(id) {
  const data = isDemoMode()
    ? demoApproveReservation(id)
    : await hkpPost(`/api/hkproperty/reservations/${id}/approve`);
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function rejectReservation(id, reason) {
  const data = isDemoMode()
    ? demoRejectReservation(id, reason)
    : await hkpPost(`/api/hkproperty/reservations/${id}/reject`, { reason });
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function cancelReservation(id) {
  const data = isDemoMode()
    ? demoCancelReservation(id)
    : await hkpPost(`/api/hkproperty/reservations/${id}/cancel`);
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function checkoutReservation(id, payload = {}) {
  if (isDemoMode()) throw new Error('測試模式請改用立即借用完成取件');
  const data = await hkpPost(`/api/hkproperty/reservations/${id}/checkout`, {
    checkout_condition: payload.checkoutCondition || null,
    note: payload.note || null,
    idempotency_key: payload.idempotencyKey || `rsv-checkout-${id}-${Date.now()}`
  });
  await Promise.all([loadCatalog(), loadLoans(), loadReservations()]);
  return data;
}
