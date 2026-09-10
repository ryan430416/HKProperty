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

const inventoryUrl = pathToFileURL(join(winRoot, 'services', 'inventoryService.js')).href;
const usageUrl = pathToFileURL(join(winRoot, 'services', 'usageService.js')).href;
const auditUrl = pathToFileURL(join(winRoot, 'services', 'auditService.js')).href;

const inventory = await import(inventoryUrl);
const usage = await import(usageUrl);
const audit = await import(auditUrl);

await inventory.loadCatalog();
const items = inventory.listItems();
if (items.length !== 390) throw new Error(`expected 390, got ${items.length}`);
if (items.some((item) => item.useCount !== 0)) throw new Error('useCount must start at 0');
if (items.some((item) => item.auditStatus !== '待盤點')) throw new Error('auditStatus must start as 待盤點');

const first = inventory.getItem('820091001');
const usageResult = usage.addUsage({
  propertyId: first.propertyId,
  userName: '測試人員',
  department: '課外組',
  usedAt: new Date().toISOString(),
  purpose: '功能驗證',
  note: ''
});
if (usageResult.item.useCount !== 1) throw new Error('useCount did not increment');
if (usage.listUsage(first.propertyId).length !== 1) throw new Error('usage log missing');

const auditResult = audit.addAudit({
  propertyId: first.propertyId,
  registeredLocation: first.location,
  actualLocation: 'H10100',
  result: '位置異常',
  auditor: '盤點人員',
  auditedAt: new Date().toISOString(),
  note: '測試'
});
if (!auditResult.needsLocationConfirm) throw new Error('should ask to update location');
audit.confirmLocationUpdate({
  propertyId: first.propertyId,
  fromLocation: first.location,
  toLocation: 'H10100',
  operator: '管理者',
  reason: '測試更新'
});
const updated = inventory.getItem(first.propertyId);
if (updated.location !== 'H10100') throw new Error('location not updated');
if (updated.auditStatus !== '位置異常') throw new Error('audit status not saved');

const snapshot = JSON.stringify(store);
store.overrides = undefined;
globalThis.localStorage.setItem('hkproperty.overrides', JSON.parse(snapshot)['hkproperty.overrides']);
const persisted = inventory.getItem(first.propertyId);
if (persisted.useCount !== 1 || persisted.location !== 'H10100') {
  throw new Error('localStorage persistence failed');
}

console.log(JSON.stringify({
  count: items.length,
  unique: new Set(items.map((item) => item.propertyId)).size,
  sampleDate: first.purchaseDate,
  useCount: persisted.useCount,
  location: persisted.location,
  auditStatus: persisted.auditStatus,
  usageLogs: usage.listUsage().length,
  auditLogs: audit.listAudits().length,
  locationLogs: audit.listLocationChanges().length
}, null, 2));
console.log('service checks ok');
