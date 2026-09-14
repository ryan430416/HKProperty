import fs from 'node:fs';

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
const result = {};

const root = new PocketBase(URL);
await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);
const staffCol = await root.collections.getOne('hkp_staff_users');
result.staff_fields = (staffCol.fields || []).map((field) => field.name);
result.staff_type = staffCol.type;
result.assets = (await root.collection('hkp_assets').getList(1, 1)).totalItems;

const names = ['hkp_borrow_requests', 'hkp_reservations_v2', 'hkp_borrow_records', 'hkp_return_requests', 'hkp_usage_records', 'hkp_operation_logs', 'hkp_assets_guest', 'hkp_reservation_public', 'hkp_borrow_slots'];
result.collections = {};
for (const name of names) {
  try {
    const list = await root.collection(name).getList(1, 1);
    result.collections[name] = list.totalItems;
  } catch (error) {
    result.collections[name] = `fail:${error.status}`;
  }
}

const anon = new PocketBase(URL);
const guest = await anon.collection('hkp_assets_guest').getList(1, 1, { filter: 'availability_status = "available" && is_borrowable = true' });
const assetId = guest.items[0].id;
const beforeAsset = await root.collection('hkp_assets').getOne(assetId);
const beforeUsage = (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${assetId}"` })).totalItems;

const created = await anon.collection('hkp_borrow_requests').create({
  request_number: `BR-GAP-${Date.now().toString(36)}`,
  borrower_unit: '驗證單位',
  borrower_name: '驗證姓名',
  borrower_phone: '0912000111',
  asset: assetId,
  purpose: '缺口驗證',
  requested_at: new Date().toISOString(),
  expected_return_at: new Date(Date.now() + 86400000).toISOString(),
  status: 'pending',
  public_token_hash: 'c'.repeat(64),
  privacy_ack: true
});
const afterCreate = await root.collection('hkp_assets').getOne(assetId);
const afterUsage = (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${assetId}"` })).totalItems;
result.anon_create_status = created.status;
result.anon_create_did_not_change_asset = afterCreate.availability_status === beforeAsset.availability_status;
result.anon_create_did_not_change_usage = afterUsage === beforeUsage;
result.anon_get_created = await anon.collection('hkp_borrow_requests').getOne(created.id).then(() => 'visible').catch((error) => error.status);

const borrowedAttempt = await anon.collection('hkp_borrow_requests').create({
  request_number: `BR-BAD-${Date.now().toString(36)}`,
  borrower_unit: '驗證單位',
  borrower_name: '驗證姓名',
  borrower_phone: '0912000111',
  asset: assetId,
  purpose: '不該直接借出',
  status: 'borrowed',
  public_token_hash: 'd'.repeat(64),
  privacy_ack: true
}).then(() => 'created').catch((error) => error.status);
result.anon_cannot_create_borrowed = borrowedAttempt;

const staff = new PocketBase(URL);
const admin = new PocketBase(URL);
await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);
await admin.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_ADMIN_EMAIL, formal.HKP_FORMAL_PASSWORD);
result.staff_role = staff.authStore.record.role;
result.admin_role = admin.authStore.record.role;
result.staff_active = staff.authStore.record.active !== false && staff.authStore.record.is_active !== false;
result.staff_logs = await staff.collection('hkp_operation_logs').getList(1, 1).then((list) => list.totalItems).catch((error) => error.status);
result.staff_cannot_set_admin = await staff.collection('hkp_staff_users').update(staff.authStore.record.id, { role: 'admin' }).then(() => 'updated').catch((error) => error.status);
result.admin_password_field = Object.prototype.hasOwnProperty.call(admin.authStore.record, 'password') ? 'present' : 'absent';
result.staff_visible_accounts = (await staff.collection('hkp_staff_users').getList(1, 20)).totalItems;

const returnCreate = await anon.collection('hkp_return_requests').create({
  borrow_request: created.id,
  request_number: created.request_number,
  asset: assetId,
  borrower_name: '別人',
  borrower_phone: '0988000111',
  condition: '未驗證',
  status: 'pending',
  requested_at: new Date().toISOString()
}).then((row) => row.id).catch((error) => error.status);
result.anon_return_create = typeof returnCreate === 'string' ? 'created' : returnCreate;

if (typeof returnCreate === 'string') await root.collection('hkp_return_requests').delete(returnCreate);
await root.collection('hkp_borrow_requests').delete(created.id);
const restored = await root.collection('hkp_assets').getOne(assetId);
result.assets_after = (await root.collection('hkp_assets').getList(1, 1)).totalItems;
result.asset_restored = restored.availability_status === beforeAsset.availability_status && restored.name === beforeAsset.name;
console.log(JSON.stringify(result));
if (result.assets_after !== 390 || !result.asset_restored) process.exitCode = 1;
