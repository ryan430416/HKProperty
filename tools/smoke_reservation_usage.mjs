/**
 * Demo reservation + usage_count smoke.
 * Usage: npx vite-node tools/smoke_reservation_usage.mjs
 */
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear()
};
globalThis.localStorage = globalThis.sessionStorage;

const { enterDemoSession } = await import('../services/authService.js');
const { loadCatalog, getItem } = await import('../services/inventoryService.js');
const { createReservation, loadReservations, listMyReservations } = await import('../services/reservationService.js');
const { addUsage, loadUsage } = await import('../services/usageService.js');

store.clear();
await enterDemoSession('staff');
await loadCatalog();
const item = getItem('820091001') || (await loadCatalog())[0];
if (!item) throw new Error('no asset');
const before = item.useCount;

const start = new Date();
const end = new Date(start.getTime() + 3600000);
await createReservation({
  propertyId: item.propertyId,
  purpose: 'smoke test reserve',
  startAt: start.toISOString().slice(0, 16),
  endAt: end.toISOString().slice(0, 16),
  contact: 'test@example.com',
  note: ''
});
await loadCatalog();
const afterReserve = getItem(item.propertyId).useCount;
if (afterReserve !== before) throw new Error(`reservation changed usage_count ${before} -> ${afterReserve}`);

try {
  await createReservation({
    propertyId: item.propertyId,
    purpose: 'conflict',
    startAt: start.toISOString().slice(0, 16),
    endAt: end.toISOString().slice(0, 16)
  });
  throw new Error('expected conflict');
} catch (error) {
  if (!/衝突|時段|已有/.test(error.message)) throw error;
}

await addUsage({
  propertyId: item.propertyId,
  userName: '測試使用人',
  department: '資訊',
  usedAt: start.toISOString().slice(0, 16),
  purpose: '現場測試',
  note: ''
});
await loadCatalog();
await loadUsage();
const afterUsage = getItem(item.propertyId).useCount;
if (afterUsage !== before + 1) throw new Error(`usage should +1 once, got ${before} -> ${afterUsage}`);

await loadReservations();
if (!listMyReservations().length) throw new Error('my reservations empty');

const { exitDemo } = await import('../services/demoStore.js');
exitDemo();
console.log(JSON.stringify({
  ok: true,
  propertyId: item.propertyId,
  usageBefore: before,
  afterReserve,
  afterUsage
}, null, 2));
