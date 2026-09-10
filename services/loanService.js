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

export const ITEM_CONDITION = {
  NORMAL: '正常',
  DAMAGED: '有損壞',
  MISSING_PARTS: '配件缺少',
  REPAIR: '送修',
  LOST: '遺失'
};

const RETURN_ALIASES = {
  正常: RETURN_RESULT.NORMAL,
  正常歸還: RETURN_RESULT.NORMAL,
  有損壞: RETURN_RESULT.DAMAGED,
  配件缺少: RETURN_RESULT.MISSING_PARTS,
  送修: RETURN_RESULT.REPAIR,
  遺失: RETURN_RESULT.LOST
};

export function normalizeReturnResult(value) {
  const key = String(value || '').trim();
  return RETURN_ALIASES[key] || '';
}

export const CHECKOUT_METHOD = {
  SELF: 'self_service',
  ADMIN: 'admin'
};

export function checkoutMethodLabel(loan) {
  if (loan?.checkoutMethod === CHECKOUT_METHOD.SELF) return '自助借用';
  return '管理者辦理';
}

function addActivity(entry) {
  const list = readStore(STORAGE_KEYS.activity, []);
  list.push({
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: nowIso(),
    ...entry
  });
  writeStore(STORAGE_KEYS.activity, list);
}

export function listActivity() {
  return readStore(STORAGE_KEYS.activity, []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function assertAvailableForCheckout(propertyId) {
  const item = getItem(propertyId);
  if (!item) throw new Error('查無此財產編號');
  if (item.availabilityStatus === AVAILABILITY.MAINTENANCE) throw new Error('此財產維修中，無法辦理借出');
  if (item.availabilityStatus === AVAILABILITY.LOST) throw new Error('此財產狀態為異常，無法辦理借出');
  if (item.availabilityStatus === AVAILABILITY.CHECKED_OUT || item.availabilityStatus === AVAILABILITY.OVERDUE) {
    throw new Error('此財產目前已借出，不可再次借出');
  }
  if (item.availabilityStatus !== AVAILABILITY.AVAILABLE) throw new Error('僅可借用狀態的財產才能辦理借出');
  if (getOpenLoan(item.propertyId)) throw new Error('此財產已有未歸還的借用紀錄，不可重複借出');
  return item;
}

export function verifySelfServiceLoan(code, borrowerId) {
  const token = String(code || '').trim();
  const bid = String(borrowerId || '').trim();
  if (!token) throw new Error('請輸入財產編號或借用編號');
  if (bid.length < 4) throw new Error('學號或教職員編號至少 4 個字元');
  const loan = getLoan(token) || getOpenLoan(token) || listLoans(token).find((row) => isOpenLoan(row));
  if (!loan || loan.borrowerId.trim().toLowerCase() !== bid.toLowerCase()) {
    throw new Error('查無符合的借用資料');
  }
  if (!isOpenLoan(loan)) throw new Error('此筆借用已完成歸還，不可重複歸還');
  const item = getItem(loan.propertyId);
  if (!item) throw new Error('查無此財產編號');
  return { loan, item };
}

export function lookupSelfServiceLoans(code, borrowerId) {
  const token = String(code || '').trim().toLowerCase();
  const bid = String(borrowerId || '').trim().toLowerCase();
  if (!token) throw new Error('請輸入借用編號或財產編號');
  if (bid.length < 4) throw new Error('學號或教職員編號至少 4 個字元');
  const rows = listLoans().filter((loan) => (
    loan.borrowerId.trim().toLowerCase() === bid
    && (loan.id.toLowerCase() === token || loan.propertyId.toLowerCase() === token)
  ));
  if (!rows.length) throw new Error('查無符合的借用資料');
  return rows;
}

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
  return `${prefix}${String(next).padStart(4, '0')}`;
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
  const method = payload.checkoutMethod === CHECKOUT_METHOD.SELF ? CHECKOUT_METHOD.SELF : CHECKOUT_METHOD.ADMIN;
  const item = assertAvailableForCheckout(payload.propertyId);

  const required = [
    ['borrowerName', '請填寫借用人姓名'],
    ['borrowerId', '請填寫學號或教職員編號'],
    ['borrowerDepartment', '請填寫借用單位、系所或社團'],
    ['purpose', '請填寫借用用途'],
    ['checkedOutAt', '請填寫借出日期與時間'],
    ['expectedReturnAt', '請填寫預計歸還日期與時間']
  ];
  if (method === CHECKOUT_METHOD.ADMIN) {
    required.push(['checkoutOperator', '請填寫經手人']);
  }
  for (const [key, message] of required) {
    if (!String(payload[key] || '').trim()) throw new Error(message);
  }
  if (String(payload.borrowerId || '').trim().length < 4) {
    throw new Error('學號或教職員編號至少 4 個字元');
  }
  if (method === CHECKOUT_METHOD.SELF && !payload.borrowerConfirmed) {
    throw new Error('請勾選借用人確認');
  }

  const checkedOutAt = toDate(payload.checkedOutAt);
  const expectedReturnAt = toDate(payload.expectedReturnAt);
  if (!checkedOutAt || !expectedReturnAt) throw new Error('借出或歸還時間格式不正確');
  if (expectedReturnAt.getTime() < checkedOutAt.getTime()) {
    throw new Error('預計歸還時間不得早於借出時間');
  }

  const operator = method === CHECKOUT_METHOD.SELF
    ? '自助借用'
    : (payload.checkoutOperator || '管理者').trim();
  if (method === CHECKOUT_METHOD.ADMIN && !operator) throw new Error('請填寫經手人');

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
    checkoutOperator: operator,
    checkoutMethod: method,
    contact: (payload.contact || '').trim(),
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
  addActivity({
    type: 'checkout',
    propertyId: item.propertyId,
    loanId: entry.id,
    operator,
    method,
    summary: `借出 ${item.name}（${item.propertyId}）`
  });
  return { entry, item: updated };
}

export function checkin(payload) {
  const selfService = payload.checkoutMethod === CHECKOUT_METHOD.SELF || payload.selfService === true;
  let loan = null;
  if (payload.loanId) loan = getLoan(payload.loanId);
  if (!loan && payload.propertyId) loan = getOpenLoan(payload.propertyId);
  if (!loan) throw new Error('找不到未歸還的借用紀錄');
  if (!isOpenLoan(loan)) throw new Error('此筆借用已完成歸還，不可重複歸還');

  const item = getItem(loan.propertyId);
  if (!item) throw new Error('找不到財產');

  if (!selfService && !payload.returnOperator?.trim()) throw new Error('請填寫歸還經手人');
  if (!payload.returnedAt) throw new Error('請填寫實際歸還日期與時間');
  if (!payload.returnLocation?.trim()) throw new Error('請填寫歸還後存放地點');
  if (selfService && !payload.returnConfirmed) throw new Error('請勾選歸還人確認');

  const returnedAt = toDate(payload.returnedAt);
  if (!returnedAt) throw new Error('歸還時間格式不正確');
  if (returnedAt.getTime() < toDate(loan.checkedOutAt).getTime()) {
    throw new Error('實際歸還時間不得早於借出時間');
  }

  const result = normalizeReturnResult(payload.returnResult);
  if (!result) throw new Error('請選擇物品歸還狀況');
  const needsIssue = result !== RETURN_RESULT.NORMAL;
  const issueNote = (payload.issueNote || payload.returnCondition || '').trim();
  if (selfService && needsIssue && !issueNote) throw new Error('請填寫問題說明');

  let availabilityStatus = AVAILABILITY.AVAILABLE;
  let returnAlert = null;
  if (result === RETURN_RESULT.REPAIR) availabilityStatus = AVAILABILITY.MAINTENANCE;
  if (result === RETURN_RESULT.LOST) availabilityStatus = AVAILABILITY.LOST;
  if (result === RETURN_RESULT.DAMAGED) returnAlert = 'damaged';
  if (result === RETURN_RESULT.MISSING_PARTS) returnAlert = 'missing_parts';

  const list = allLoans();
  const index = list.findIndex((row) => row.id === loan.id);
  if (index < 0) throw new Error('找不到未歸還的借用紀錄');
  const operator = selfService ? '自助歸還' : payload.returnOperator.trim();
  list[index] = {
    ...loan,
    returnedAt: returnedAt.toISOString(),
    returnOperator: operator,
    returnCondition: issueNote,
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
      operator,
      reason: `歸還後更新存放位置（${result}）`
    });
  }

  const updated = patchItem(item.propertyId, {
    availabilityStatus,
    currentLoanId: null,
    returnAlert
  });
  addActivity({
    type: 'checkin',
    propertyId: item.propertyId,
    loanId: loan.id,
    operator,
    method: selfService ? CHECKOUT_METHOD.SELF : CHECKOUT_METHOD.ADMIN,
    summary: `歸還 ${item.name}（${item.propertyId}）${result === RETURN_RESULT.NORMAL ? '' : ` · ${result}`}`
  });
  return { entry: list[index], item: updated, locationChange, returnAlert };
}

export function exportLoansCsv(rows) {
  const header = [
    '借用編號', '財產名稱', '財產編號', '借用人', '學號或教職員編號', '借用單位',
    '借出時間', '預計歸還時間', '實際歸還時間', '借用用途', '借出方式', '經手人', '借用狀態', '歸還結果', '備註'
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
    checkoutMethodLabel(loan),
    loan.returnOperator || loan.checkoutOperator,
    displayLoanStatus(loan),
    loan.returnResult || '',
    loan.note || ''
  ])].map((cols) => cols.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}
