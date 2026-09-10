import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const winRoot = 'd:\\HKProperty';
const payload = JSON.parse(readFileSync(join(winRoot, 'data', 'inventory.json'), 'utf8'));
const store = {};
globalThis.localStorage = {
  getItem: (key) => Object.hasOwn(store, key) ? store[key] : null,
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; }
};
globalThis.fetch = async (url) => {
  if (String(url).includes('inventory.json')) {
    return { ok: true, json: async () => payload };
  }
  return { ok: false, json: async () => ({}) };
};

const inventory = await import(pathToFileURL(join(winRoot, 'services', 'inventoryService.js')).href);
const usage = await import(pathToFileURL(join(winRoot, 'services', 'usageService.js')).href);
const loan = await import(pathToFileURL(join(winRoot, 'services', 'loanService.js')).href);

await inventory.loadCatalog();
const items = inventory.listItems();
if (items.length !== 390) throw new Error(`expected 390, got ${items.length}`);
if (items.some((item) => item.availabilityStatus !== 'available')) throw new Error('default availability should be available');
if (items.some((item) => item.useCount !== 0)) throw new Error('useCount must start at 0');

const first = inventory.getItem('820091001');
const past = new Date(Date.now() - 48 * 3600000);
const due = new Date(Date.now() - 2 * 3600000);
const out = loan.checkout({
  propertyId: first.propertyId,
  borrowerName: '測試同學',
  borrowerId: 'B12345678',
  borrowerDepartment: '資訊工程系',
  checkedOutAt: past.toISOString(),
  expectedReturnAt: due.toISOString(),
  purpose: '課程演示',
  checkoutOperator: '管理者',
  checkoutCondition: '正常',
  note: ''
});
if (out.item.useCount !== 1) throw new Error('useCount should increase once');
if (out.item.availabilityStatus !== 'checked_out') throw new Error('should be checked out');
try {
  loan.checkout({
    propertyId: first.propertyId,
    borrowerName: '另一人',
    borrowerId: 'B000',
    borrowerDepartment: 'x',
    checkedOutAt: new Date().toISOString(),
    expectedReturnAt: new Date(Date.now() + 3600000).toISOString(),
    purpose: '重複',
    checkoutOperator: '管理者'
  });
  throw new Error('duplicate checkout should fail');
} catch (error) {
  if (error.message === 'duplicate checkout should fail') throw error;
}

loan.refreshOverdueStatus();
const overdueItem = inventory.getItem(first.propertyId);
if (overdueItem.availabilityStatus !== 'overdue') throw new Error('overdue not detected');
if (usage.listUsage(first.propertyId).length !== 1) throw new Error('usage record missing');

const returned = loan.checkin({
  propertyId: first.propertyId,
  returnedAt: new Date().toISOString(),
  returnOperator: '管理者',
  returnCondition: '外觀正常',
  returnLocation: 'H10100',
  returnResult: '正常歸還',
  note: '測試歸還'
});
if (returned.item.availabilityStatus !== 'available') throw new Error('should return to available');
if (returned.item.useCount !== 1) throw new Error('useCount should stay 1 after return');
if (returned.item.location !== 'H10100') throw new Error('location should update');

const second = inventory.getItem('820091002');
loan.checkout({
  propertyId: second.propertyId,
  borrowerName: '送修測試',
  borrowerId: 'ST01',
  borrowerDepartment: '課外組',
  checkedOutAt: new Date().toISOString(),
  expectedReturnAt: new Date(Date.now() + 3600000).toISOString(),
  purpose: '送修流程',
  checkoutOperator: '管理者'
});
loan.checkin({
  propertyId: second.propertyId,
  returnedAt: new Date().toISOString(),
  returnOperator: '管理者',
  returnCondition: '故障',
  returnLocation: second.location,
  returnResult: '送修',
  note: ''
});
if (inventory.getItem(second.propertyId).availabilityStatus !== 'maintenance') throw new Error('repair status failed');
try {
  loan.checkout({
    propertyId: second.propertyId,
    borrowerName: '不可借',
    borrowerId: 'x',
    borrowerDepartment: 'x',
    checkedOutAt: new Date().toISOString(),
    expectedReturnAt: new Date(Date.now() + 3600000).toISOString(),
    purpose: 'x',
    checkoutOperator: '管理者'
  });
  throw new Error('maintenance checkout should fail');
} catch (error) {
  if (error.message === 'maintenance checkout should fail') throw error;
}

const csv = loan.exportLoansCsv(loan.listLoans());
if (!csv.startsWith('\uFEFF')) throw new Error('CSV missing BOM');
if (!csv.includes('測試同學')) throw new Error('CSV missing Chinese name');

console.log(JSON.stringify({
  count: items.length,
  useCount: returned.item.useCount,
  availability: returned.item.availabilityStatus,
  maintenance: inventory.getItem(second.propertyId).availabilityStatus,
  loans: loan.listLoans().length,
  usage: usage.listUsage().length,
  csvBom: csv.charCodeAt(0) === 0xFEFF
}, null, 2));
console.log('loan checks ok');
