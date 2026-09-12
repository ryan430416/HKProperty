import { PB } from '../pocketbase/schema.mjs';
import { isDemoMode } from './authService.js';
import { demoApprove, demoCheckout, demoCompleteCheckout, demoLoans, demoLogs, demoReject, demoReturn, demoSaveSettings, demoSettings } from './demoStore.js';
import { getItem, loadCatalog, setOverdueAssetIds } from './inventoryService.js';
import { getFullList, hkpPost, relationId } from './hkpApi.js';
import { pbMessage } from './pocketbaseClient.js';

export const LOAN_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  CHECKED_OUT: 'checked_out',
  RETURNED: 'returned',
  OVERDUE: 'overdue',
  RETURN_PENDING: 'return_pending',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

export const LOAN_STATUS_LABEL = {
  pending: '待核准',
  approved: '已核准',
  checked_out: '借用中',
  returned: '已歸還',
  overdue: '已逾期',
  return_pending: '待確認歸還',
  rejected: '已拒絕',
  cancelled: '已取消'
};

export const RETURN_RESULT = {
  NORMAL: '正常歸還',
  DAMAGED: '有損壞',
  MISSING_PARTS: '配件缺少',
  REPAIR: '送修',
  LOST: '遺失'
};

export const CHECKOUT_METHOD = {
  SELF: 'self_service',
  ADMIN: 'admin'
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
  return RETURN_ALIASES[String(value || '').trim()] || '';
}

export function checkoutMethodLabel(loan) {
  if (loan?.checkoutMethod === CHECKOUT_METHOD.SELF) return '自助借用';
  return '管理者辦理';
}

let cache = [];
let settings = {
  require_loan_approval: false,
  allow_self_checkout: true,
  default_loan_days: 1
};

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdueRow(row, now = new Date()) {
  if (row.returned_at || row.status === 'returned') return false;
  if (row.status !== 'checked_out' && row.status !== 'overdue') return false;
  const expected = toDate(row.expected_return_at);
  return Boolean(expected && now.getTime() > expected.getTime());
}

export function mapLoan(row) {
  const overdue = isOverdueRow(row);
  const display = overdue ? 'overdue' : row.status;
  return {
    recordId: row.id,
    id: row.loan_number,
    propertyId: row.property_id,
    propertyName: row.property_name,
    assetId: relationId(row.asset) || row.asset_id,
    borrowerProfileId: relationId(row.borrower) || row.borrower_id,
    borrowerName: row.borrower_name,
    borrowerId: row.borrower_number,
    borrowerDepartment: row.borrower_department,
    purpose: row.purpose,
    contact: row.contact || '',
    checkedOutAt: row.checkout_at || row.requested_at,
    expectedReturnAt: row.expected_return_at,
    returnedAt: row.returned_at,
    checkoutOperator: row.checkout_operator || '',
    checkoutMethod: row.checkout_method,
    returnOperator: row.return_operator || '',
    checkoutCondition: row.checkout_condition || '',
    returnCondition: row.return_condition || '',
    returnResult: row.return_result,
    returnLocation: row.return_location,
    status: display,
    rawStatus: row.status,
    rejectionReason: row.rejection_reason,
    note: row.note || '',
    createdAt: row.created,
    updatedAt: row.updated,
    isOverdue: overdue
  };
}

export function getSettings() {
  return settings;
}

export async function loadSettings() {
  if (isDemoMode()) {
    settings = demoSettings();
    return settings;
  }
  try {
    const rows = await getFullList(PB.settings, { sort: '-created' });
    if (rows[0]) settings = rows[0];
  } catch {
    // keep defaults
  }
  return settings;
}

export async function saveSettings(patch) {
  if (isDemoMode()) {
    settings = demoSaveSettings({
      require_loan_approval: patch.requireLoanApproval,
      allow_self_checkout: patch.allowSelfCheckout,
      default_loan_days: patch.defaultLoanDays
    });
    return settings;
  }
  const data = await hkpPost('/api/hkproperty/settings', {
    require_loan_approval: patch.requireLoanApproval,
    allow_self_checkout: patch.allowSelfCheckout,
    default_loan_days: patch.defaultLoanDays
  });
  settings = data;
  return settings;
}

export function clearLoanCache() {
  cache = [];
}

export async function loadLoans() {
  if (isDemoMode()) {
    cache = demoLoans().map(mapLoan);
    setOverdueAssetIds(cache.filter((loan) => loan.isOverdue).map((loan) => loan.assetId));
    return cache;
  }
    const rows = await getFullList(PB.loans, { sort: '-requested_at' });
  cache = (rows || []).map(mapLoan);
  setOverdueAssetIds(cache.filter((loan) => loan.isOverdue).map((loan) => loan.assetId));
  return cache;
}

export function listLoans(propertyId) {
  const list = Array.isArray(cache) ? cache.slice() : [];
  if (!propertyId) return list;
  return list.filter((loan) => loan.propertyId === propertyId || loan.assetId === propertyId);
}

export function listActivity() {
  return [];
}

export async function loadOperationLogs() {
  if (isDemoMode()) return demoLogs();
  try {
    const rows = await getFullList(PB.logs, { sort: '-created' });
    return (rows || []).slice(0, 200).map((row) => ({
      ...row,
      created_at: row.created,
      actor_name: row.actor_name
    }));
  } catch (error) {
    throw new Error(pbMessage(error, '無法載入操作紀錄'));
  }
}

export function getLoan(loanId) {
  const token = String(loanId || '').trim();
  return cache.find((loan) => loan.id === token || loan.recordId === token) || null;
}

export function isOpenLoan(loan) {
  return Boolean(loan) && !loan.returnedAt && !['cancelled', 'rejected', 'returned'].includes(loan.rawStatus || loan.status);
}

export function isLoanOverdue(loan, now = new Date()) {
  if (!loan || loan.returnedAt) return false;
  if (loan.isOverdue) return true;
  const expected = toDate(loan.expectedReturnAt);
  const open = ['checked_out', 'overdue', 'return_pending'].includes(loan.rawStatus || loan.status);
  return Boolean(open && expected && now.getTime() > expected.getTime());
}

export function getOpenLoan(propertyId) {
  return listLoans(propertyId).find((loan) => isOpenLoan(loan) && ['pending', 'approved', 'checked_out', 'overdue', 'return_pending'].includes(loan.rawStatus || loan.status)) || null;
}

export function currentLoanOf(item) {
  if (!item) return null;
  return (item.currentLoanId && cache.find((loan) => loan.recordId === item.currentLoanId)) || getOpenLoan(item.propertyId);
}

export function displayLoanStatus(loan) {
  if (!loan) return '';
  if (isLoanOverdue(loan)) return LOAN_STATUS_LABEL.overdue;
  return LOAN_STATUS_LABEL[loan.rawStatus || loan.status] || LOAN_STATUS_LABEL[loan.status] || loan.status;
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

export function refreshOverdueStatus() {
  return cache;
}

export function getLoanDashboardStats(now = new Date()) {
  const open = cache.filter((loan) => isOpenLoan(loan));
  return {
    dueToday: open.filter((loan) => isDueToday(loan, now)).length,
    overdue: open.filter((loan) => isLoanOverdue(loan, now)).length,
    dueSoon: open.filter((loan) => isDueWithinHours(loan, 24, now)).length,
    open: open.length,
    pending: cache.filter((loan) => loan.rawStatus === 'pending').length
  };
}

export async function assertAvailableForCheckout(propertyId) {
  await loadCatalog();
  const item = getItem(propertyId);
  if (!item) throw new Error('查無此財產編號');
  if (item.availabilityStatus === 'maintenance') throw new Error('此財產維修中，無法辦理借出');
  if (item.availabilityStatus === 'lost') throw new Error('此財產狀態為異常，無法辦理借出');
  if (item.availabilityStatus === 'checked_out' || item.availabilityStatus === 'overdue') {
    throw new Error('此財產目前已借出，不可再次借出');
  }
  if (item.availabilityStatus === 'reserved' || item.availabilityStatus === 'pending') {
    throw new Error('此財產已有預借或待處理申請');
  }
  if (item.availabilityStatus !== 'available') throw new Error('僅可借用狀態的財產才能辦理借出');
  return item;
}

export async function checkout(payload) {
  const item = await assertAvailableForCheckout(payload.propertyId);
  const method = payload.checkoutMethod === CHECKOUT_METHOD.ADMIN ? CHECKOUT_METHOD.ADMIN : CHECKOUT_METHOD.SELF;
  const body = {
    asset_id: item.id,
    property_id: item.propertyId,
    borrower_name: payload.borrowerName,
    borrower_number: payload.borrowerId,
    borrower_department: payload.borrowerDepartment,
    purpose: payload.purpose,
    expected_return_at: new Date(payload.expectedReturnAt).toISOString(),
    contact: payload.contact || null,
    checkout_at: new Date(payload.checkedOutAt || Date.now()).toISOString(),
    checkout_condition: payload.checkoutCondition || null,
    note: payload.note || null,
    checkout_method: method,
    idempotency_key: payload.idempotencyKey || `checkout-${item.id}-${Date.now()}`
  };
  const data = isDemoMode()
    ? demoCheckout({
      assetId: item.id,
      propertyId: item.propertyId,
      borrower_name: body.borrower_name,
      borrower_number: body.borrower_number,
      borrower_department: body.borrower_department,
      purpose: body.purpose,
      expected_return_at: body.expected_return_at,
      contact: body.contact,
      checkout_at: body.checkout_at,
      checkout_condition: body.checkout_condition,
      note: body.note,
      checkout_method: method
    })
    : await hkpPost('/api/hkproperty/loans/checkout', body);
  await Promise.all([loadCatalog(), loadLoans()]);
  return { entry: mapLoan(data), item: getItem(item.propertyId) };
}

export async function approveLoan(loanId) {
  const loan = getLoan(loanId);
  if (!loan) throw new Error('找不到借用申請');
  if (isDemoMode()) demoApprove(loan.recordId);
  else await hkpPost(`/api/hkproperty/loans/${loan.recordId}/approve`);
  await Promise.all([loadCatalog(), loadLoans()]);
  return getLoan(loan.id);
}

export async function rejectLoan(loanId, reason) {
  const loan = getLoan(loanId);
  if (!loan) throw new Error('找不到借用申請');
  if (isDemoMode()) demoReject(loan.recordId, reason);
  else await hkpPost(`/api/hkproperty/loans/${loan.recordId}/reject`, { reason });
  await Promise.all([loadCatalog(), loadLoans()]);
  return getLoan(loan.id);
}

export async function completeCheckout(loanId) {
  const loan = getLoan(loanId);
  if (!loan) throw new Error('找不到借用申請');
  if (isDemoMode()) demoCompleteCheckout(loan.recordId);
  else await hkpPost('/api/hkproperty/loans/checkout', { loan_id: loan.recordId });
  await Promise.all([loadCatalog(), loadLoans()]);
  return { entry: getLoan(loan.id), item: getItem(loan.propertyId) };
}

export async function checkin(payload) {
  const item = payload.propertyId ? getItem(payload.propertyId) : null;
  const loan = payload.loanId
    ? getLoan(payload.loanId)
    : getOpenLoan(payload.propertyId);
  if (!loan) throw new Error('找不到未歸還的借用紀錄');
  const result = payload.returnResult || '正常歸還';
  const args = {
    returned_at: new Date(payload.returnedAt).toISOString(),
    return_location: payload.returnLocation,
    return_result: result,
    return_condition: payload.issueNote || payload.returnCondition || null,
    note: payload.note || null
  };
  if (isDemoMode()) {
    demoReturn(loan.recordId, args);
  } else {
    await hkpPost('/api/hkproperty/loans/return', {
      loan_id: loan.recordId,
      ...args
    });
  }
  await Promise.all([loadCatalog(), loadLoans()]);
  return { entry: getLoan(loan.id), item: getItem(loan.propertyId || item?.propertyId) };
}

export async function verifySelfServiceLoan(code, borrowerId) {
  await loadLoans();
  const token = String(code || '').trim();
  const bid = String(borrowerId || '').trim();
  if (!token) throw new Error('請輸入財產編號或借用編號');
  if (bid.length < 4) throw new Error('學號或教職員編號至少 4 個字元');
  const loan = getLoan(token) || getOpenLoan(token) || listLoans(token).find((row) => isOpenLoan(row));
  if (!loan || loan.borrowerId.trim().toLowerCase() !== bid.toLowerCase()) {
    throw new Error('查無符合的借用資料');
  }
  if (loan.returnedAt || loan.rawStatus === 'returned') throw new Error('此筆借用已完成歸還，不可重複歸還');
  const found = getItem(loan.propertyId);
  if (!found) throw new Error('查無此財產編號');
  return { loan, item: found };
}

export async function lookupSelfServiceLoans(code, borrowerId) {
  await loadLoans();
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
