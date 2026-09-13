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
const staff = new PocketBase(URL);
const anon = new PocketBase(URL);
const admin = new PocketBase(URL);
const root = new PocketBase(URL);
await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);
await admin.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_ADMIN_EMAIL, formal.HKP_FORMAL_PASSWORD);
await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);

const guest = await anon.collection('hkp_assets_guest').getList(1, 1, { filter: 'availability_status = "available" && is_borrowable = true' });
const asset = await admin.collection('hkp_assets').getOne(guest.items[0].id);
const beforeCount = await admin.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` });
const before = { status: asset.availability_status, loan: asset.current_loan || null, usage: beforeCount.totalItems };
const request = await anon.collection('hkp_borrow_requests').create({
  request_number: `BR-CHK-${Date.now().toString(36)}`,
  borrower_unit: '驗證單位',
  borrower_name: '驗證姓名',
  borrower_phone: '0912000111',
  asset: asset.id,
  purpose: '確認借出驗證',
  requested_at: new Date().toISOString(),
  expected_return_at: new Date(Date.now() + 86400000).toISOString(),
  status: 'pending',
  public_token_hash: 'b'.repeat(64),
  privacy_ack: true,
  checkout_condition: '正常'
});
let usage = null;
let record = null;
try {
  await staff.collection('hkp_borrow_requests').update(request.id, { status: 'borrowed' });
  record = await staff.collection('hkp_borrow_records').create({
    borrow_request: request.id,
    asset: asset.id,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_phone: '0912000111',
    purpose: '確認借出驗證',
    borrowed_at: new Date().toISOString(),
    expected_return_at: request.expected_return_at,
    status: 'borrowed',
    checkout_condition: '正常',
    processed_by: staff.authStore.record.id
  });
  await staff.collection('hkp_assets').update(asset.id, { availability_status: 'checked_out', current_loan: record.id });
  usage = await staff.collection('hkp_usage_records').create({
    asset: asset.id,
    user_name: '驗證姓名',
    user_number: 'PUBLIC',
    department: '驗證單位',
    used_at: new Date().toISOString(),
    purpose: '確認借出驗證',
    note: '驗證後刪除',
    property_id: asset.property_id,
    property_name: asset.name
  });
  const mid = await admin.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` });
  const changed = await admin.collection('hkp_assets').getOne(asset.id);
  if (mid.totalItems !== before.usage + 1) throw new Error('usage did not increase');
  if (changed.availability_status !== 'checked_out') throw new Error('asset status did not change');
  console.log(JSON.stringify({ checkout: 'ok', usage_delta: mid.totalItems - before.usage }));
} finally {
  if (usage) await root.collection('hkp_usage_records').delete(usage.id).catch(() => {});
  await root.collection('hkp_assets').update(asset.id, { availability_status: before.status, current_loan: before.loan });
  if (record) await root.collection('hkp_borrow_records').delete(record.id).catch(() => {});
  await root.collection('hkp_borrow_requests').delete(request.id).catch(() => {});
  const afterAsset = await root.collection('hkp_assets').getOne(asset.id);
  const afterCount = await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` });
  const total = await root.collection('hkp_assets').getList(1, 1);
  const restored = afterAsset.availability_status === before.status && afterCount.totalItems === before.usage && total.totalItems === 390;
  console.log(JSON.stringify({ restored, assets: total.totalItems, usage_back: afterCount.totalItems === before.usage }));
  if (!restored) process.exit(1);
}
