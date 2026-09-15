/**
 * Shared reservation status machine (browser + Node).
 * Single source of truth — do not duplicate status strings in pages.
 */

export const RESERVATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  CHECKED_OUT: 'checked_out',
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  OVERDUE: 'overdue'
});

export const RESERVATION_STATUS_LABEL = Object.freeze({
  pending: '等待確認',
  approved: '已核准',
  checked_out: '已借出',
  return_requested: '待確認歸還',
  returned: '已歸還',
  rejected: '已拒絕',
  cancelled: '已取消',
  overdue: '已逾期'
});

export const RESERVATION_STATUSES = Object.freeze(Object.values(RESERVATION_STATUS));

/** Allowed transitions: from -> Set(to) */
export const RESERVATION_TRANSITIONS = Object.freeze({
  pending: new Set(['approved', 'rejected', 'cancelled']),
  approved: new Set(['checked_out', 'cancelled', 'rejected']),
  checked_out: new Set(['return_requested', 'returned', 'overdue']),
  return_requested: new Set(['returned', 'checked_out']),
  overdue: new Set(['return_requested', 'returned']),
  rejected: new Set([]),
  cancelled: new Set([]),
  returned: new Set([])
});

export function canTransition(from, to) {
  const allowed = RESERVATION_TRANSITIONS[from];
  return !!(allowed && allowed.has(to));
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`不允許的狀態轉換：${from || '∅'} → ${to}`);
  }
}

/** Map legacy statuses into the unified machine. */
export function mapLegacyStatus(status) {
  const value = String(status || '');
  if (value === 'borrowed') return RESERVATION_STATUS.CHECKED_OUT;
  if (value === 'return_pending') return RESERVATION_STATUS.RETURN_REQUESTED;
  if (RESERVATION_STATUSES.includes(value)) return value;
  return value;
}

export const INVENTORY_RESULT = Object.freeze({
  NORMAL: '正常',
  LOCATION_MISMATCH: '位置不符',
  CHECKED_OUT: '借出中',
  MAINTENANCE: '維修中',
  LOST: '遺失',
  SCRAPPED: '報廢'
});

export const INVENTORY_RESULTS = Object.freeze(Object.values(INVENTORY_RESULT));

export const INVENTORY_SESSION_STATUS = Object.freeze({
  OPEN: 'open',
  COMPLETED: 'completed',
  VOID: 'void'
});
