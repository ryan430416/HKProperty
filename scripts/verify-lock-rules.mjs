import fs from 'node:fs';
import { createHash } from 'node:crypto';
function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}
const env = readEnv('.env');
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const anon = new PocketBase('https://db.keson.pro');
const result = {};
const marker = 'HKP-VERIFY-LOCK';
const slot = '2031-06-01T00:00:00.000Z';
let asset = null;
let previous = null;

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

async function cleanup() {
  if (asset && previous) {
    await pb.collection('hkp_assets').update(asset.id, { availability_status: previous }).catch(() => {});
  }
  const borrows = await pb.collection('hkp_borrow_requests').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of borrows) await pb.collection('hkp_borrow_requests').delete(row.id).catch(() => {});
  const locks = await pb.collection('hkp_time_locks').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of locks) await pb.collection('hkp_time_locks').delete(row.id).catch(() => {});
  const reservations = await pb.collection('hkp_reservations_v2').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of reservations) await pb.collection('hkp_reservations_v2').delete(row.id).catch(() => {});
}

try {
  const found = await pb.collection('hkp_assets').getList(1, 1, { filter: 'availability_status = "available"' });
  asset = found.items[0];
  if (!asset) throw new Error('no available asset');
  previous = asset.availability_status;

  const payload = {
    request_number: `BR-LOCK-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: hash('驗證姓名'),
    borrower_phone: '0912000111',
    asset: asset.id,
    purpose: '權限驗證',
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: 'b'.repeat(64),
    privacy_ack: true
  };
  const created = await anon.collection('hkp_borrow_requests').create(payload).then(() => 'created').catch((error) => error.status || 'failed');
  result.available_borrow = created;
  await cleanup();

  await pb.collection('hkp_assets').update(asset.id, { availability_status: 'checked_out' });
  const blocked = await anon.collection('hkp_borrow_requests').create({
    ...payload,
    request_number: `BR-LOCK2-${Date.now().toString(36)}`
  }).then(() => 'created').catch((error) => error.status || 'failed');
  result.checked_out_borrow = blocked;
  await pb.collection('hkp_assets').update(asset.id, { availability_status: previous });
  previous = null;

  const lockPayload = {
    reservation_number: `RV-LOCK-${Date.now().toString(36)}`,
    asset: asset.id,
    slot_start: slot,
    start_at: slot,
    end_at: '2031-06-01T01:00:00.000Z',
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: hash('驗證姓名'),
    borrower_phone: '0912000111',
    purpose: '權限驗證',
    notes: marker,
    status: 'pending',
    public_token_hash: 'c'.repeat(64),
    privacy_ack: true
  };
  const first = await anon.collection('hkp_time_locks').create(lockPayload).then(() => 'created').catch((error) => error.status || 'failed');
  result.first_lock = first;
  const second = await anon.collection('hkp_time_locks').create({
    ...lockPayload,
    reservation_number: `RV-LOCKB-${Date.now().toString(36)}`,
    public_token_hash: 'd'.repeat(64)
  }).then(() => 'created').catch((error) => error.status || 'failed');
  result.overlap_lock = second;
  const listed = await anon.collection('hkp_time_locks').getList(1, 5).catch((error) => ({ totalItems: 0, status: error.status }));
  result.anon_lock_list = listed.totalItems ?? 0;
  const publicSlots = await anon.collection('hkp_lock_public').getList(1, 5, {
    filter: `asset = "${asset.id}" && slot_start = "${slot}"`,
    fields: 'id,slot_start,status'
  }).catch((error) => ({ totalItems: 0, status: error.status }));
  result.public_slot_visible = publicSlots.totalItems ?? 0;
  result.public_slot_has_name = Boolean(publicSlots.items?.[0]?.borrower_name || publicSlots.items?.[0]?.borrower_phone);

  const overlap = await anon.collection('hkp_reservations_v2').create({
    reservation_number: `RV-RAW-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_phone: '0912000111',
    asset: asset.id,
    start_at: slot,
    end_at: '2031-06-01T02:00:00.000Z',
    purpose: '權限驗證',
    notes: marker,
    status: 'pending',
    public_token_hash: 'e'.repeat(64),
    privacy_ack: true
  }).then(() => 'created').catch((error) => error.status || 'failed');
  result.raw_v2_overlap = overlap;
} finally {
  await cleanup();
  const assets = await pb.collection('hkp_assets').getList(1, 1);
  const leftoverBorrows = await pb.collection('hkp_borrow_requests').getList(1, 1, { filter: `notes = "${marker}"` }).catch(() => ({ totalItems: -1 }));
  const leftoverLocks = await pb.collection('hkp_time_locks').getList(1, 1, { filter: `notes = "${marker}"` }).catch(() => ({ totalItems: -1 }));
  result.assets = assets.totalItems;
  result.leftover_borrows = leftoverBorrows.totalItems;
  result.leftover_locks = leftoverLocks.totalItems;
  if (asset) {
    const restored = await pb.collection('hkp_assets').getOne(asset.id, { fields: 'id,availability_status' });
    result.asset_status = restored.availability_status;
  }
  console.log(JSON.stringify(result));
  if (result.available_borrow !== 'created' || result.checked_out_borrow === 'created' || result.overlap_lock === 'created' || result.assets !== 390 || result.leftover_locks !== 0 || result.leftover_borrows !== 0) {
    process.exitCode = 1;
  }
}
