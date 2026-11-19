import { getItem, listItems, loadCatalog } from './inventoryService.js';
import {
  backfillLoan,
  listLoans,
  loadLoans,
  mapLoan
} from './loanService.js';
import { isDemoMode } from './authService.js';
import { rocYearRange } from './usageLogPdf.js';

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isLogbookComplete(row) {
  return Boolean(
    String(row.borrowerName || '').trim()
    && String(row.borrowerDepartment || '').trim()
    && String(row.borrowerTitle || '').trim()
    && String(row.purpose || '').trim()
    && row.checkedOutAt
    && row.returnedAt
  );
}

export function listLogbookRows({ rocYear, propertyId } = {}) {
  const { start, end } = rocYear ? rocYearRange(rocYear) : { start: null, end: null };
  return listLoans()
    .filter((loan) => loan.rawStatus === 'returned' || loan.status === 'returned')
    .filter((loan) => Boolean(loan.returnedAt))
    .filter((loan) => (!propertyId ? true : loan.propertyId === propertyId))
    .filter((loan) => {
      if (!start || !end) return true;
      const returned = new Date(loan.returnedAt);
      return returned >= start && returned <= end;
    })
    .sort((a, b) => {
      const byAsset = String(a.propertyId).localeCompare(String(b.propertyId), 'zh-Hant');
      if (byAsset) return byAsset;
      return new Date(a.checkedOutAt) - new Date(b.checkedOutAt);
    });
}

export function groupLogbookForPdf(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.propertyId;
    if (!map.has(key)) {
      const item = getItem(key) || {
        propertyId: row.propertyId,
        name: row.propertyName,
        purchaseDate: '',
        department: ''
      };
      map.set(key, {
        asset: {
          propertyId: item.propertyId || row.propertyId,
          name: item.name || row.propertyName,
          purchaseDate: item.purchaseDate || '',
          department: item.department || ''
        },
        rows: []
      });
    }
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}

export function logbookExportPreview(rocYear, propertyId = '') {
  const rows = listLogbookRows({ rocYear, propertyId });
  const complete = rows.filter(isLogbookComplete);
  const incomplete = rows.filter((row) => !isLogbookComplete(row));
  return {
    rows,
    complete,
    incomplete,
    groups: groupLogbookForPdf(complete),
    assetOptions: listItems()
      .filter((item) => item.isActive !== false)
      .map((item) => ({ propertyId: item.propertyId, name: item.name }))
      .sort((a, b) => String(a.propertyId).localeCompare(String(b.propertyId), 'zh-Hant'))
  };
}

export async function submitBackfill(payload) {
  await loadCatalog();
  await loadLoans();
  const propertyId = String(payload.propertyId || '').trim();
  const item = getItem(propertyId);
  if (!item) throw new Error('查無此財產編號');

  const borrowerName = String(payload.borrowerName || '').trim();
  const borrowerId = String(payload.borrowerId || '').trim();
  const borrowerDepartment = String(payload.borrowerDepartment || '').trim();
  const borrowerTitle = String(payload.borrowerTitle || '').trim();
  const purpose = String(payload.purpose || '').trim();
  const borrowedAt = payload.borrowedAt || payload.checkedOutAt;
  const returnedAt = payload.returnedAt;

  if (!borrowerName) throw new Error('請填寫借用人姓名');
  if (borrowerId.length < 4) throw new Error('學號或教職員編號至少 4 個字元');
  if (!borrowerDepartment) throw new Error('請填寫借用單位');
  if (!borrowerTitle) throw new Error('請填寫職稱');
  if (!purpose) throw new Error('請填寫借用用途');
  if (!borrowedAt) throw new Error('請填寫借用日期');
  if (!returnedAt) throw new Error('請填寫歸還日期');
  if (new Date(returnedAt) < new Date(borrowedAt)) throw new Error('歸還日期不得早於借用日期');

  const dup = listLoans().find((loan) => (
    loan.propertyId === propertyId
    && loan.borrowerName === borrowerName
    && dayKey(loan.checkedOutAt) === dayKey(borrowedAt)
    && (loan.rawStatus === 'returned' || loan.status === 'returned')
  ));
  if (dup) throw new Error('已有相同財產、借用日與借用人的紀錄，請勿重複補登');

  const entry = await backfillLoan({
    propertyId,
    borrowerName,
    borrowerId,
    borrowerDepartment,
    borrowerTitle,
    purpose,
    checkedOutAt: borrowedAt,
    returnedAt,
    note: payload.note || '補登使用紀錄',
    countUsage: payload.countUsage !== false
  });
  return { entry: mapLoan(entry), item, demo: isDemoMode() };
}
