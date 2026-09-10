import { STORAGE_KEYS, readStore, writeStore } from './storageService.js';
import { AVAILABILITY, getItem, incrementUseCount, patchItem } from './inventoryService.js';
import { addUsage } from './usageService.js';
import { confirmLocationUpdate } from './auditService.js';
import { nowIso, pad } from '../js/format.js';

export const LOAN_STATUS = {
  CHECKED_OUT: 'checked_out',
  RETURNED: 'returned',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled'
};

export const LOAN_STATUS_LABEL = {
  checked_out: '借用中',
  returned: '已歸還',
  overdue: '已逾期',
  cancelled: '已取消'
};

export const RETURN_RESULT = {
  NORMAL: '正常歸還',
  DAMAGED: '有損壞',
  MISSING_PARTS: '配件缺少',
  REPAIR: '送修',
  LOST: '遺失'
};

function allLoans() {
  return readStore(STORAGE_KEYS.loans, []);
}

function saveLoans(list) {
  writeStore(STORAGE_KEYS.loans, list);
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isOpenLoan(loan) {
  return Boolean(loan) && !loan.returnedAt && loan.status !== LOAN_STATUS.CANCELLED;
}

export function isLoanOverdue(loan, now = new Date()) {
  if (!isOpenLoan(loan)) return false;
  const expected = toDate(loan.expectedReturnAt);
  return Boolean(expected && now.getTime() > expected.getTime());
}

function nextLoanId(list, at = new Date()) {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const prefix = `LOAN-${stamp}-`;
  const serials = list
    .map((loan) => loan.id)
    .filter((id) => String(id).startsWith(prefix))
    .map((id) => Number(String(id).slice(prefix.length)))
    .filter((num) => Number.isFinite(num));
  const next = (serials.length ? Math.max(...serials) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export function listLoans(propertyId) {
  const list = allLoans().slice().sort((a, b) => new Date(b.checkedOutAt) - new Date(a.checkedOutAt));
  if (!propertyId) return list;
  return list.filter((loan) => loan.propertyId === propertyId);
}

export function getLoan(loanId) {
  return allLoans().find((loan) => loan.id === loanId) || null;
}

export function getOpenLoan(propertyId) {
  return allLoans().find((loan) => loan.propertyId === propertyId && isOpenLoan(loan)) || null;
}

export function currentLoanOf(item) {
  if (!item) return null;
  return (item.currentLoanId && getLoan(item.currentLoanId)) || getOpenLoan(item.propertyId);
}

export function displayLoanStatus(loan, now = new Date()) {
  if (!loan) return '';
  if (loan.status === LOAN_STATUS.CANCELLED) return LOAN_STATUS_LABEL.cancelled;
  if (loan.returnedAt || loan.status === LOAN_STATUS.RETURNED) return LOAN_STATUS_LABEL.returned;
  if (isLoanOverdue(loan, now) || loan.status === LOAN_STATUS.OVERDUE) return LOAN_STATUS_LABEL.overdue;
  return LOAN_STATUS_LABEL.checked_out;
}

export function overdueDuration(loan, now = new Date()) {
  if (!isLoanOverdue(loan, now)) return '';
  const expected = toDate(loan.expectedReturnAt);
  const ms = now.getTime() - expected.getTime();
  const hours = Math.max(1, Math.floor(ms / 3600000));
  if (hours < 24) return `逾期 ${hours} 小時`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `逾期 ${days} 天 ${rem} 小時` : `逾期 ${days} 天`;
}

export function isDueToday(loan, now = new Date()) {
  if (!isOpenLoan(loan)) return false;
  const expected = toDate(loan.expectedReturnAt);
  if (!expected) return false;
  return expected.getFullYear() === now.getFullYear()
    && expected.getMonth() === now.getMonth()
    && expected.getDate() === now.getDate();
}

export function isDueWithinHours(loan, hours = 24, now = new Date()) {
  if (!isOpenLoan(loan) || isLoanOverdue(loan, now)) return false;
  const expected = toDate(loan.expectedReturnAt);
  if (!expected) return false;
  const diff = expected.getTime() - now.getTime();
  return diff >= 0 && diff <= hours * 3600000;
}

export function refreshOverdueStatus(now = new Date()) {
  const list = allLoans();
  let changed = false;
  for (const loan of list) {
    if (!isOpenLoan(loan)) continue;
    const overdue = isLoanOverdue(loan, now);
    if (overdue && loan.status !== LOAN_STATUS.OVERDUE) {
      loan.status = LOAN_STATUS.OVERDUE;
      loan.updatedAt = now.toISOString();
      changed = true;
    }
    const item = getItem(loan.propertyId);
    if (!item) continue;
    if (item.availabilityStatus === AVAILABILITY.MAINTENANCE || item.availabilityStatus === AVAILABILITY.LOST) continue;
    const nextStatus = overdue ? AVAILABILITY.OVERDUE : AVAILABILITY.CHECKED_OUT;
    if (item.availabilityStatus !== nextStatus || item.currentLoanId !== loan.id) {
      patchItem(loan.propertyId, {
        availabilityStatus: nextStatus,
        currentLoanId: loan.id
      });
    }
  }
  if (changed) saveLoans(list);
  return list;
}

export function getLoanDashboardStats(now = new Date()) {
  refreshOverdueStatus(now);
  const open = allLoans().filter((loan) => isOpenLoan(loan));
  return {
    dueToday: open.filter((loan) => isDueToday(loan, now)).length,
    overdue: open.filter((loan) => isLoanOverdue(loan, now)).length,
    dueSoon: open.filter((loan) => isDueWithinHours(loan, 24, now)).length,
    open: open.length
  };
}

export function checkout(payload) {
  const item = getItem(payload.propertyId);
  if (!item) throw new Error('找不到財產');
  if (item.availabilityStatus === AVAILABILITY.MAINTENANCE) throw new Error('此財產維修中，無法辦理借出');
  if (item.availabilityStatus === AVAILABILITY.LOST) throw new Error('此財產狀態為異常，無法辦理借出');
  if (item.availabilityStatus !== AVAILABILITY.AVAILABLE) throw new Error('僅可借用狀態的財產才能辦理借出');
  if (getOpenLoan(item.propertyId)) throw new Error('此財產已有未歸還的借用紀錄，不可重複借出');

  const required = [
    ['borrowerName', '請填寫借用人姓名'],
    ['borrowerId', '請填寫學號或教職員編號'],
    ['borrowerDepartment', '請填寫借用單位或系所'],
    ['purpose', '請填寫借用用途'],
    ['checkoutOperator', '請填寫經手人'],
    ['checkedOutAt', '請填寫借出日期與時間'],
    ['expectedReturnAt', '請填寫預計歸還日期與時間']
  ];
  for (const [key, message] of required) {
    if (!String(payload[key] || '').trim()) throw new Error(message);
  }

  const checkedOutAt = toDate(payload.checkedOutAt);
  const expectedReturnAt = toDate(payload.expectedReturnAt);
  if (!checkedOutAt || !expectedReturnAt) throw new Error('借出或歸還時間格式不正確');
  if (expectedReturnAt.getTime() < checkedOutAt.getTime()) {
    throw new Error('預計歸還時間不得早於借出時間');
  }

  const list = allLoans();
  const now = new Date();
  const entry = {
    id: nextLoanId(list, now),
    propertyId: item.propertyId,
    propertyName: item.name,
    borrowerName: payload.borrowerName.trim(),
    borrowerId: payload.borrowerId.trim(),
    borrowerDepartment: payload.borrowerDepartment.trim(),
    purpose: payload.purpose.trim(),
    checkedOutAt: checkedOutAt.toISOString(),
    expectedReturnAt: expectedReturnAt.toISOString(),
    returnedAt: null,
    checkoutOperator: payload.checkoutOperator.trim(),
    returnOperator: '',
    checkoutCondition: (payload.checkoutCondition || '').trim(),
    returnCondition: '',
    returnResult: null,
    returnLocation: null,
    status: LOAN_STATUS.CHECKED_OUT,
    note: (payload.note || '').trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  list.push(entry);
  saveLoans(list);

  incrementUseCount(item.propertyId);
  addUsage({
    propertyId: item.propertyId,
    userName: entry.borrowerName,
    department: entry.borrowerDepartment,
    usedAt: entry.checkedOutAt,
    purpose: entry.purpose,
    note: `借用編號 ${entry.id}`,
    loanId: entry.id,
    countUsage: false
  });

  const updated = patchItem(item.propertyId, {
    availabilityStatus: AVAILABILITY.CHECKED_OUT,
    currentLoanId: entry.id,
    returnAlert: null
  });
  return { entry, item: updated };
}

export function checkin(payload) {
  const item = getItem(payload.propertyId);
  if (!item) throw new Error('找不到財產');
  const loan = getOpenLoan(item.propertyId);
  if (!loan) throw new Error('找不到未歸還的借用紀錄');
  if (!payload.returnOperator?.trim()) throw new Error('請填寫歸還經手人');
  if (!payload.returnedAt) throw new Error('請填寫實際歸還日期與時間');
  if (!payload.returnResult) throw new Error('請選擇歸還結果');
  if (!payload.returnLocation?.trim()) throw new Error('請填寫歸還後存放地點');

  const returnedAt = toDate(payload.returnedAt);
  if (!returnedAt) throw new Error('歸還時間格式不正確');
  if (returnedAt.getTime() < toDate(loan.checkedOutAt).getTime()) {
    throw new Error('實際歸還時間不得早於借出時間');
  }

  const result = payload.returnResult;
  const valid = Object.values(RETURN_RESULT);
  if (!valid.includes(result)) throw new Error('歸還結果不正確');

  let availabilityStatus = AVAILABILITY.AVAILABLE;
  let returnAlert = null;
  if (result === RETURN_RESULT.REPAIR) availabilityStatus = AVAILABILITY.MAINTENANCE;
  if (result === RETURN_RESULT.LOST) availabilityStatus = AVAILABILITY.LOST;
  if (result === RETURN_RESULT.DAMAGED) returnAlert = 'damaged';
  if (result === RETURN_RESULT.MISSING_PARTS) returnAlert = 'missing_parts';

  const list = allLoans();
  const index = list.findIndex((row) => row.id === loan.id);
  list[index] = {
    ...loan,
    returnedAt: returnedAt.toISOString(),
    returnOperator: payload.returnOperator.trim(),
    returnCondition: (payload.returnCondition || '').trim(),
    returnResult: result,
    returnLocation: payload.returnLocation.trim(),
    status: LOAN_STATUS.RETURNED,
    note: payload.note?.trim() ? `${loan.note ? `${loan.note}；` : ''}${payload.note.trim()}` : loan.note,
    updatedAt: nowIso()
  };
  saveLoans(list);

  let locationChange = null;
  const nextLocation = payload.returnLocation.trim();
  if (nextLocation && nextLocation !== item.location) {
    locationChange = confirmLocationUpdate({
      propertyId: item.propertyId,
      fromLocation: item.location,
      toLocation: nextLocation,
      operator: payload.returnOperator.trim(),
      reason: `歸還後更新存放位置（${result}）`
    });
  }

  const updated = patchItem(item.propertyId, {
    availabilityStatus,
    currentLoanId: null,
    returnAlert
  });
  return { entry: list[index], item: updated, locationChange, returnAlert };
}

export function exportLoansCsv(rows) {
  const header = [
    '借用編號', '財產名稱', '財產編號', '借用人', '學號或教職員編號', '借用單位',
    '借出時間', '預計歸還時間', '實際歸還時間', '借用用途', '經手人', '借用狀態', '歸還結果', '備註'
  ];
  const lines = [header, ...rows.map((loan) => [
    loan.id,
    loan.propertyName,
    loan.propertyId,
    loan.borrowerName,
    loan.borrowerId,
    loan.borrowerDepartment,
    loan.checkedOutAt,
    loan.expectedReturnAt,
    loan.returnedAt || '',
    loan.purpose,
    loan.returnOperator || loan.checkoutOperator,
    displayLoanStatus(loan),
    loan.returnResult || '',
    loan.note || ''
  ])].map((cols) => cols.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}
