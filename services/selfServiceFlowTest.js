import { snapshotAppStorage, restoreAppStorage, clearOperationalData } from './storageService.js';
import { AVAILABILITY, getItem, getStats, listItems } from './inventoryService.js';
import {
  CHECKOUT_METHOD,
  assertAvailableForCheckout,
  checkin,
  checkout,
  checkoutMethodLabel,
  getOpenLoan,
  lookupSelfServiceLoans,
  verifySelfServiceLoan
} from './loanService.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fail(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

export function runSelfServiceFlowTest() {
  const snapshot = snapshotAppStorage();
  const steps = [];
  let propertyId = '';
  let beforeCount = 0;
  let loanId = '';
  let result = { ok: false, propertyId: '', loanId: '', steps };

  try {
    const catalogCount = listItems().length;
    assert(catalogCount === 390, `原始財產應為 390 筆，實際 ${catalogCount}`);
    const item = listItems().find((row) => row.availabilityStatus === AVAILABILITY.AVAILABLE && !getOpenLoan(row.propertyId));
    assert(item, '找不到可借用財產');
    propertyId = item.propertyId;
    beforeCount = item.useCount;
    const availableBefore = getStats().available;
    const checkedOutBefore = getStats().checkedOut;

    const looked = assertAvailableForCheckout(propertyId);
    assert(looked.propertyId === propertyId, '查找財產失敗');
    steps.push({ name: '搜尋可借用財產', ok: true, detail: propertyId });

    const checkedOut = checkout({
      propertyId,
      borrowerName: '流程測試借用人',
      borrowerId: 'SELFTEST01',
      borrowerDepartment: '系統檢測社團',
      purpose: '自助借出流程測試',
      checkedOutAt: new Date().toISOString(),
      expectedReturnAt: new Date(Date.now() + 3600000).toISOString(),
      contact: '',
      checkoutCondition: '測試用',
      note: 'self-service-flow-test',
      borrowerConfirmed: true,
      checkoutMethod: CHECKOUT_METHOD.SELF
    });
    loanId = checkedOut.entry.id;
    assert(/^LOAN-\d{8}-\d{4}$/.test(loanId), `借用編號格式不正確：${loanId}`);
    assert(checkedOut.entry.checkoutMethod === 'self_service', '借出方式應為 self_service');
    assert(checkedOut.entry.checkoutOperator === '自助借用', '經手人應為自助借用');
    assert(checkoutMethodLabel(checkedOut.entry) === '自助借用', '借出方式顯示應為自助借用');
    assert(checkedOut.item.availabilityStatus === AVAILABILITY.CHECKED_OUT, '借出後應為已借出');
    assert(checkedOut.item.useCount === beforeCount + 1, '使用次數應增加 1');
    assert(checkedOut.item.currentLoanId === loanId, '應寫入 currentLoanId');
    assert(getStats().available === availableBefore - 1, '可借用數量應減少');
    assert(getStats().checkedOut === checkedOutBefore + 1, '已借出數量應增加');
    steps.push({ name: '自助借出成功', ok: true, detail: loanId });

    const blocked = fail(() => checkout({
      propertyId,
      borrowerName: '另一人',
      borrowerId: 'SELFTEST02',
      borrowerDepartment: '系統檢測',
      purpose: '應被拒絕',
      checkedOutAt: new Date().toISOString(),
      expectedReturnAt: new Date(Date.now() + 7200000).toISOString(),
      borrowerConfirmed: true,
      checkoutMethod: CHECKOUT_METHOD.SELF
    }));
    assert(blocked, '同一財產不可再次借出');
    assert(getItem(propertyId).useCount === beforeCount + 1, '重複借出後使用次數不可再增加');
    steps.push({ name: '防止重複借出', ok: true, detail: blocked });

    const found = lookupSelfServiceLoans(loanId, 'SELFTEST01');
    assert(found.length === 1 && found[0].id === loanId, '應可用借用編號與學號查到自己的紀錄');
    const byProperty = lookupSelfServiceLoans(propertyId, 'SELFTEST01');
    assert(byProperty.some((row) => row.id === loanId), '應可用財產編號查到自己的紀錄');
    const hidden = fail(() => lookupSelfServiceLoans(loanId, 'WRONG9999'));
    assert(hidden === '查無符合的借用資料', '錯誤學號不可查到他人借用紀錄');
    steps.push({ name: '查詢借用狀態', ok: true, detail: '僅顯示符合的紀錄' });

    const verified = verifySelfServiceLoan(loanId, 'SELFTEST01');
    assert(verified.loan.id === loanId, '歸還驗證失敗');
    const returned = checkin({
      loanId,
      propertyId,
      returnedAt: new Date().toISOString(),
      returnLocation: item.location,
      returnResult: '正常',
      issueNote: '',
      note: 'self-service-return-test',
      returnConfirmed: true,
      selfService: true
    });
    assert(returned.item.availabilityStatus === AVAILABILITY.AVAILABLE, '正常歸還後應恢復可借用');
    assert(returned.item.currentLoanId === null, '應清除 currentLoanId');
    assert(returned.item.useCount === beforeCount + 1, '歸還時不可再次增加使用次數');
    assert(returned.entry.returnedAt, '應寫入實際歸還時間');
    assert(returned.entry.returnLocation === item.location, '應寫入歸還位置');
    assert(returned.entry.returnResult === '正常歸還', '應寫入歸還狀況');
    assert(getStats().checkedOut === checkedOutBefore, '歸還後已借出數量應恢復');
    steps.push({ name: '自助歸還成功', ok: true, detail: `使用次數維持 ${returned.item.useCount}` });

    const repeat = fail(() => checkin({
      loanId,
      propertyId,
      returnedAt: new Date().toISOString(),
      returnLocation: item.location,
      returnResult: '正常',
      returnConfirmed: true,
      selfService: true
    }));
    assert(repeat, '已歸還紀錄不可重複歸還');
    steps.push({ name: '防止重複歸還', ok: true, detail: repeat });

    clearOperationalData();
    assert(listItems().length === 390, '清除後仍應保留 390 筆財產');
    assert(listItems().every((row) => row.availabilityStatus === AVAILABILITY.AVAILABLE), '清除後財產應恢復可借用');
    assert(listItems().every((row) => row.useCount === 0), '清除後使用次數應回到 0');
    assert(getStats().total === 390, '統計總數應仍為 390');
    steps.push({ name: '清除測試紀錄', ok: true, detail: '已清除借用資料，未刪除原始清冊' });
    result = { ok: true, propertyId, loanId, steps };
  } catch (error) {
    steps.push({ name: '測試失敗', ok: false, detail: error.message });
    result = { ok: false, propertyId, loanId, steps, error: error.message };
  }

  restoreAppStorage(snapshot);
  result.steps = steps;
  result.propertyId = propertyId;
  result.loanId = loanId;
  result.ok = Boolean(result.ok) && steps.every((step) => step.ok);
  return result;
}
