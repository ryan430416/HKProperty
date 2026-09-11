import { PB } from '../pocketbase/schema.mjs';
import { isDemoMode } from './authService.js';
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
  return {
    recordId: row.id,
    id: row.reservation_number,
    assetId: relationId(row.asset) || row.asset_id,
    propertyId: getItem(relationId(row.asset))?.propertyId || row.property_id || '',
    propertyName: getItem(relationId(row.asset))?.name || row.property_name || '',
    userId: relationId(row.user) || row.user_id,
    purpose: row.purpose,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    statusLabel: RESERVATION_STATUS_LABEL[row.status] || row.status,
    rejectionReason: row.rejection_reason || '',
    contact: row.contact || '',
    note: row.note || '',
    approvedAt: row.approved_at,
    convertedLoanId: relationId(row.converted_loan) || ''
  };
}

export async function loadReservations() {
  if (isDemoMode()) {
    cache = [];
    return cache;
  }
  const rows = await getFullList(PB.reservations, { sort: '-created' });
  cache = (rows || []).map(mapReservation);
  return cache;
}

export function listReservations(propertyId) {
  const list = Array.isArray(cache) ? cache.slice() : [];
  if (!propertyId) return list;
  return list.filter((row) => row.propertyId === propertyId || row.assetId === propertyId);
}

export async function createReservation(payload) {
  const item = getItem(payload.propertyId);
  if (!item) throw new Error('找不到財產');
  if (isDemoMode()) throw new Error('測試模式暫不支援預借，請改用立即借用');
  const data = await hkpPost('/api/hkproperty/reservations', {
    asset_id: item.id,
    purpose: payload.purpose,
    start_at: new Date(payload.startAt).toISOString(),
    end_at: new Date(payload.endAt).toISOString(),
    contact: payload.contact || null,
    note: payload.note || null
  });
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function approveReservation(id) {
  const data = await hkpPost(`/api/hkproperty/reservations/${id}/approve`);
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function rejectReservation(id, reason) {
  const data = await hkpPost(`/api/hkproperty/reservations/${id}/reject`, { reason });
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function cancelReservation(id) {
  const data = await hkpPost(`/api/hkproperty/reservations/${id}/cancel`);
  await Promise.all([loadCatalog(), loadReservations()]);
  return mapReservation(data);
}

export async function checkoutReservation(id, payload = {}) {
  const data = await hkpPost(`/api/hkproperty/reservations/${id}/checkout`, {
    checkout_condition: payload.checkoutCondition || null,
    note: payload.note || null,
    idempotency_key: payload.idempotencyKey || `rsv-checkout-${id}-${Date.now()}`
  });
  await Promise.all([loadCatalog(), loadLoans(), loadReservations()]);
  return data;
}
