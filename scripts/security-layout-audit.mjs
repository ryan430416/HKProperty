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

const rootEnv = readEnv('.env');
const formal = { ...rootEnv, ...readEnv('.env.local'), ...rootEnv };
const URL = 'https://db.keson.pro';
const PocketBase = (await import('pocketbase')).default;
const anon = new PocketBase(URL);
const staff = new PocketBase(URL);
const root = new PocketBase(URL);
const result = { checks: [] };

function note(name, pass, detail) {
  result.checks.push({ name, pass, detail });
}

await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);
await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);

const collections = [
  'hkp_staff_users',
  'hkp_borrow_requests',
  'hkp_reservations_v2',
  'hkp_time_locks',
  'hkp_borrow_records',
  'hkp_return_requests',
  'hkp_usage_records',
  'hkp_operation_logs'
];

for (const name of collections) {
  const listed = await anon.collection(name).getList(1, 1).catch((error) => ({ totalItems: 0, status: error.status, message: error.message }));
  note(`anon_list_${name}`, (listed.totalItems || 0) === 0, `totalItems=${listed.totalItems ?? 'n/a'} status=${listed.status || 200}`);
}

const guest = await anon.collection('hkp_assets_guest').getList(1, 1, {
  fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active,photo,price,custodian'
}).catch((error) => ({ items: [], status: error.status }));
const row = guest.items?.[0] || {};
note('guest_no_price', !Object.prototype.hasOwnProperty.call(row, 'price') && !Object.prototype.hasOwnProperty.call(row, 'custodian'), Object.keys(row).join(','));
note('guest_photo_hidden', !Object.prototype.hasOwnProperty.call(row, 'photo'), row.photo ? 'photo still exposed' : 'guest view has no photo');

const asset = await root.collection('hkp_assets').getOne(row.id || (await root.collection('hkp_assets').getList(1, 1)).items[0].id);
const before = asset.availability_status;
const marker = 'HKP-AUDIT-SEC';

try {
  note('staff_cannot_create_asset', await staff.collection('hkp_assets').create({
    name: 'should-fail',
    property_id: `NO-${Date.now()}`
  }).then(() => false).catch(() => true), 'create blocked');

  note('staff_cannot_rename', await staff.collection('hkp_assets').update(asset.id, {
    name: '不應寫入'
  }).then(() => false).catch(() => true), 'rename blocked');

  note('staff_cannot_set_admin', await staff.collection('hkp_staff_users').update(staff.authStore.record.id, {
    role: 'admin'
  }).then(() => false).catch(() => true), 'self promote blocked');

  note('anon_cannot_borrow_borrowed_status', await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-BAD-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: createHash('sha256').update('驗證姓名').digest('hex'),
    borrower_phone: '0912000111',
    asset: asset.id,
    purpose: marker,
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'borrowed',
    public_token_hash: 'a'.repeat(64),
    privacy_ack: true
  }).then(() => false).catch(() => true), 'status borrowed blocked');

  await root.collection('hkp_assets').update(asset.id, { availability_status: 'checked_out' });
  note('anon_cannot_borrow_checked_out', await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-OUT-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: createHash('sha256').update('驗證姓名').digest('hex'),
    borrower_phone: '0912000111',
    asset: asset.id,
    purpose: marker,
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: 'b'.repeat(64),
    privacy_ack: true
  }).then(() => false).catch(() => true), 'checked_out blocked');
  await root.collection('hkp_assets').update(asset.id, { availability_status: before });

  note('anon_cannot_create_v2_reservation', await anon.collection('hkp_reservations_v2').create({
    reservation_number: `RV-OLD-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_phone: '0912000111',
    asset: asset.id,
    start_at: '2033-01-01T00:00:00.000Z',
    end_at: '2033-01-01T01:00:00.000Z',
    purpose: marker,
    notes: marker,
    status: 'pending',
    public_token_hash: 'c'.repeat(64),
    privacy_ack: true
  }).then(() => false).catch(() => true), 'legacy reservation closed');

  const slot = '2033-02-01T08:00:00.000Z';
  const lock = await anon.collection('hkp_time_locks').create({
    reservation_number: `RV-AUD-${Date.now().toString(36)}`,
    asset: asset.id,
    slot_start: slot,
    start_at: slot,
    end_at: '2033-02-01T09:00:00.000Z',
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: createHash('sha256').update('驗證姓名').digest('hex'),
    borrower_phone: '0912000111',
    purpose: marker,
    notes: marker,
    status: 'pending',
    public_token_hash: 'd'.repeat(64),
    privacy_ack: true
  });
  note('overlap_lock_blocks', await anon.collection('hkp_time_locks').create({
    reservation_number: `RV-AUD2-${Date.now().toString(36)}`,
    asset: asset.id,
    slot_start: slot,
    start_at: slot,
    end_at: '2033-02-01T09:00:00.000Z',
    borrower_unit: '驗證單位',
    borrower_name: '另一人',
    borrower_name_hash: createHash('sha256').update('另一人').digest('hex'),
    borrower_phone: '09125550111',
    purpose: marker,
    notes: marker,
    status: 'pending',
    public_token_hash: 'e'.repeat(64),
    privacy_ack: true
  }).then(() => false).catch(() => true), 'unique slot');
  await root.collection('hkp_time_locks').delete(lock.id);
} finally {
  const leftovers = await root.collection('hkp_borrow_requests').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of leftovers) await root.collection('hkp_borrow_requests').delete(row.id).catch(() => {});
  const locks = await root.collection('hkp_time_locks').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of locks) await root.collection('hkp_time_locks').delete(row.id).catch(() => {});
  await root.collection('hkp_assets').update(asset.id, { availability_status: before }).catch(() => {});
}

const assets = await root.collection('hkp_assets').getList(1, 1);
note('assets_still_390', assets.totalItems === 390, String(assets.totalItems));

const route = await fetch(`${URL}/api/hkp/public/borrow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
note('public_hook_still_missing', route.status === 404, `status=${route.status}`);

const failed = result.checks.filter((row) => !row.pass);
console.log(JSON.stringify({ assets: assets.totalItems, failed: failed.length, checks: result.checks }, null, 2));
if (failed.length) process.exitCode = 1;
