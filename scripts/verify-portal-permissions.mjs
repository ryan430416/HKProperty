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
const marker = 'HKP-PORTAL-FIX';
function note(name, pass, detail) {
  result.checks.push({ name, pass, detail });
}
function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);
await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);

note('anon_assets_full_list_empty', (await anon.collection('hkp_assets').getList(1, 1).catch(() => ({ totalItems: 0 }))).totalItems === 0, 'full assets hidden');
note('anon_staff_users_empty', (await anon.collection('hkp_staff_users').getList(1, 1).catch(() => ({ totalItems: 0 }))).totalItems === 0, 'staff users hidden');
note('anon_usage_empty', (await anon.collection('hkp_usage_records').getList(1, 1).catch(() => ({ totalItems: 0 }))).totalItems === 0, 'usage hidden');

const guest = await anon.collection('hkp_assets_guest').getList(1, 1);
const asset = await root.collection('hkp_assets').getOne(guest.items[0].id);
const before = asset.availability_status;

try {
  note('staff_no_asset_create', await staff.collection('hkp_assets').create({ name: 'x', property_id: `NO-${Date.now()}` }).then(() => false).catch(() => true), 'blocked');
  note('staff_no_account_create', await staff.collection('hkp_staff_users').create({
    email: `nope-${Date.now()}@example.com`,
    password: process.env.HKP_TEST_TEMP_PASSWORD || '',
    passwordConfirm: process.env.HKP_TEST_TEMP_PASSWORD || '',
    name: 'nope',
    employee_number: `NOPE-${Date.now()}`,
    role: 'staff',
    active: true,
    is_active: true
  }).then(() => false).catch(() => true), 'blocked');

  await root.collection('hkp_assets').update(asset.id, { availability_status: 'checked_out' });
  note('no_second_borrow_while_out', await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-PF-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: hash('驗證姓名'),
    borrower_phone: '0912000111',
    asset: asset.id,
    purpose: marker,
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: hash('token'),
    privacy_ack: true
  }).then(() => false).catch(() => true), 'blocked');
  await root.collection('hkp_assets').update(asset.id, { availability_status: before });

  const req = await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-PF2-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_name_hash: hash('驗證姓名'),
    borrower_phone: '0912000111',
    asset: asset.id,
    purpose: marker,
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: hash('token-2'),
    privacy_ack: true
  });
  await staff.collection('hkp_borrow_requests').update(req.id, { status: 'borrowed' });
  await staff.collection('hkp_borrow_requests').update(req.id, { status: 'return_pending' });
  await staff.collection('hkp_borrow_requests').update(req.id, { status: 'returned' });
  const reopen = await staff.collection('hkp_borrow_requests').update(req.id, { status: 'return_pending' })
    .then(() => 'reopened')
    .catch((error) => error.status || 'blocked');
  note('cannot_return_twice', reopen !== 'reopened', String(reopen));
  const finalStatus = (await root.collection('hkp_borrow_requests').getOne(req.id)).status;
  note('stays_returned', finalStatus === 'returned', finalStatus);
  await root.collection('hkp_borrow_requests').delete(req.id);
} finally {
  const leftovers = await root.collection('hkp_borrow_requests').getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
  for (const row of leftovers) await root.collection('hkp_borrow_requests').delete(row.id).catch(() => {});
  await root.collection('hkp_assets').update(asset.id, { availability_status: before }).catch(() => {});
}

const assets = await root.collection('hkp_assets').getList(1, 1);
note('assets_390', assets.totalItems === 390, String(assets.totalItems));
const failed = result.checks.filter((row) => !row.pass);
console.log(JSON.stringify({ assets: assets.totalItems, failed: failed.length, checks: result.checks }, null, 2));
if (failed.length) process.exitCode = 1;
