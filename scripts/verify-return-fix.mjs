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
const result = {};
const token = 'e'.repeat(32);
const hash = createHash('sha256').update(token).digest('hex');
const phone = '0912000111';
const name = '驗證姓名';
const nameHash = createHash('sha256').update(name).digest('hex');

const root = new PocketBase(URL);
const anon = new PocketBase(URL);
const staff = new PocketBase(URL);
await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);
await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);

const guest = await anon.collection('hkp_assets_guest').getList(1, 1, { filter: 'availability_status = "available" && is_borrowable = true' });
const asset = await root.collection('hkp_assets').getOne(guest.items[0].id);
const before = {
  status: asset.availability_status,
  loan: asset.current_loan || null,
  usage: (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` })).totalItems
};
const request = await anon.collection('hkp_borrow_requests').create({
  request_number: `BR-RET-${Date.now().toString(36)}`,
  borrower_unit: '驗證單位',
  borrower_name: name,
  borrower_phone: phone,
  asset: asset.id,
  purpose: '歸還驗證',
  requested_at: new Date().toISOString(),
  expected_return_at: new Date(Date.now() + 86400000).toISOString(),
  status: 'pending',
  public_token_hash: hash,
  borrower_name_hash: nameHash,
  privacy_ack: true
});

const headers = { 'x-hkp-token': hash, 'x-hkp-name': nameHash, 'x-hkp-phone': phone };
try {
  result.anon_return_create = await anon.collection('hkp_return_requests').create({
    borrow_request: request.id,
    request_number: request.request_number,
    borrower_name: name,
    borrower_phone: phone,
    status: 'pending'
  }).then(() => 'created').catch((error) => error.status);
  result.verify_list_without_headers = (await anon.collection('hkp_borrow_verify').getList(1, 1)).totalItems;
  await staff.collection('hkp_borrow_requests').update(request.id, { status: 'borrowed' });
  result.verify_wrong_phone = (await anon.collection('hkp_borrow_verify').getList(1, 1, {
    filter: `request_number = "${request.request_number}"`,
    headers: { ...headers, 'x-hkp-phone': '0988000111' }
  })).totalItems;
  const matched = await anon.collection('hkp_borrow_verify').getList(1, 1, {
    filter: `request_number = "${request.request_number}"`,
    fields: 'id,request_number,status',
    headers
  });
  result.verify_match = matched.totalItems;
  result.verify_response_keys = Object.keys(matched.items[0] || {}).filter((key) => !['collectionId', 'collectionName'].includes(key));
  result.wrong_update = await anon.collection('hkp_borrow_requests').update(request.id, { status: 'return_pending' }, {
    headers: { ...headers, 'x-hkp-phone': '0988000111' }
  }).then(() => 'updated').catch((error) => error.status);
  await anon.collection('hkp_borrow_requests').update(request.id, { status: 'return_pending' }, { headers });
  const pending = await root.collection('hkp_borrow_requests').getOne(request.id, { fields: 'status' });
  result.return_pending = pending.status;
  const usageBeforeConfirm = (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` })).totalItems;
  await staff.collection('hkp_borrow_requests').update(request.id, { status: 'returned' });
  await staff.collection('hkp_assets').update(asset.id, { availability_status: 'available', current_loan: null });
  const usageAfter = (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` })).totalItems;
  result.return_did_not_add_usage = usageAfter === usageBeforeConfirm;
} finally {
  await root.collection('hkp_assets').update(asset.id, { availability_status: before.status, current_loan: before.loan });
  await root.collection('hkp_borrow_requests').delete(request.id).catch(async () => {
    const returns = await root.collection('hkp_return_requests').getFullList({ filter: `borrow_request = "${request.id}"` });
    for (const row of returns) await root.collection('hkp_return_requests').delete(row.id);
    await root.collection('hkp_borrow_requests').delete(request.id);
  });
  const after = await root.collection('hkp_assets').getOne(asset.id);
  result.assets = (await root.collection('hkp_assets').getList(1, 1)).totalItems;
  result.restored = after.availability_status === before.status && (after.current_loan || null) === before.loan;
  result.usage_same = (await root.collection('hkp_usage_records').getList(1, 1, { filter: `asset = "${asset.id}"` })).totalItems === before.usage;
  console.log(JSON.stringify(result));
  if (result.assets !== 390 || !result.restored) process.exitCode = 1;
}
