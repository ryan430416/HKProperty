import { snapshotAppStorage, restoreAppStorage } from './legacySnapshots.js';
import { AVAILABILITY, getItem, listItems } from './inventoryService.js';
import { checkin, checkout, getOpenLoan } from './loanService.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runLoanLifecycleTest() {
  const snapshot = snapshotAppStorage();
  const steps = [];
  let propertyId = '';
  let beforeCount = 0;
  let startStatus = '';
  let result = { ok: false, propertyId: '', steps };

  try {
    const item = listItems().find((row) => row.availabilityStatus === AVAILABILITY.AVAILABLE && !getOpenLoan(row.propertyId));
    assert(item, '找不到可借用財產，無法執行測試');
    propertyId = item.propertyId;
    beforeCount = item.useCount;
    startStatus = item.availabilityStatus;

    const checkedOut = checkout({
      propertyId,
      borrowerName: '流程測試借用人',
      borrowerId: 'TEST-0001',
      borrowerDepartment: '系統檢測',
      checkedOutAt: new Date().toISOString(),
      expectedReturnAt: new Date(Date.now() + 3600000).toISOString(),
      purpose: '自動化借出流程測試',
      checkoutOperator: '測試模式',
      checkoutCondition: '測試用，完成後會還原',
      note: 'loan-flow-test'
    });
    assert(checkedOut.item.availabilityStatus === AVAILABILITY.CHECKED_OUT, '借出後狀態應為已借出');
    assert(checkedOut.item.useCount === beforeCount + 1, '借出後使用次數應只增加 1');
    assert(Boolean(getOpenLoan(propertyId)), '借出後應存在未歸還紀錄');
    steps.push({ name: '可借用 → 借出', ok: true, detail: `${propertyId} 已借出，使用次數 ${beforeCount} → ${checkedOut.item.useCount}` });

    let blocked = false;
    try {
      checkout({
        propertyId,
        borrowerName: '重複借出',
        borrowerId: 'TEST-0002',
        borrowerDepartment: '系統檢測',
        checkedOutAt: new Date().toISOString(),
        expectedReturnAt: new Date(Date.now() + 7200000).toISOString(),
        purpose: '應被拒絕',
        checkoutOperator: '測試模式'
      });
    } catch {
      blocked = true;
    }
    assert(blocked, '同一件財產不應允許重複借出');
    assert(getItem(propertyId).useCount === beforeCount + 1, '重複借出失敗後使用次數不可再增加');
    steps.push({ name: '防止重複借出', ok: true, detail: '第二次借出已被拒絕' });

    const returned = checkin({
      propertyId,
      returnedAt: new Date().toISOString(),
      returnOperator: '測試模式',
      returnCondition: '測試歸還',
      returnLocation: item.location,
      returnResult: '正常歸還',
      note: 'loan-flow-test-return'
    });
    assert(returned.item.availabilityStatus === AVAILABILITY.AVAILABLE, '歸還後應恢復可借用');
    assert(returned.item.useCount === beforeCount + 1, '歸還時不可再次增加使用次數');
    assert(!getOpenLoan(propertyId), '歸還後不應再有未歸還紀錄');
    steps.push({ name: '歸還 → 恢復可借用', ok: true, detail: `使用次數維持 ${returned.item.useCount}` });
    result = { ok: true, propertyId, steps };
  } catch (error) {
    steps.push({ name: '測試失敗', ok: false, detail: error.message });
    result = { ok: false, propertyId, steps, error: error.message };
  }

  restoreAppStorage(snapshot);
  if (propertyId) {
    const restored = getItem(propertyId);
    const clean = Boolean(
      restored
      && restored.useCount === beforeCount
      && restored.availabilityStatus === startStatus
      && !getOpenLoan(propertyId)
    );
    steps.push({
      name: '清除測試紀錄',
      ok: clean,
      detail: clean ? '已還原 localStorage，未留下測試借用資料' : '還原後資料與測試前不一致'
    });
    if (!clean) result = { ok: false, propertyId, steps, error: '測試資料還原失敗' };
  }
  result.steps = steps;
  result.propertyId = propertyId;
  result.ok = result.ok && steps.every((step) => step.ok);
  return result;
}
