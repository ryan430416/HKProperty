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
const test = await import(pathToFileURL(join(winRoot, 'services', 'selfServiceFlowTest.js')).href);

await inventory.loadCatalog();
const before = JSON.stringify(store);
const result = test.runSelfServiceFlowTest();
if (!result.ok) throw new Error(result.error || result.steps.map((step) => step.detail).join('; '));
const after = JSON.stringify(store);
if (before !== after) throw new Error('self-service test left data in storage');
if (inventory.listItems().length !== 390) throw new Error('catalog changed');

console.log(JSON.stringify({
  ok: true,
  propertyId: result.propertyId,
  loanId: result.loanId,
  steps: result.steps.map((step) => step.name)
}, null, 2));
