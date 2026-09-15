/**
 * Phase-2 API smoke tests using service credentials from .env.service.local.
 * Does not deploy. Cleans up created reservation rows.
 */
import fs from 'node:fs';
import PocketBase from 'pocketbase';
import { RESERVATION_STATUS, canTransition, assertTransition } from '../shared/reservationStatus.js';
import { createRequestNo, createVerificationCode, hashToken, assertPerson } from '../server/security.js';

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = {
  ...readEnv('.env.local'),
  ...readEnv('.env'),
  ...readEnv('.env.service.local')
};
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  if (!pass) console.error('FAIL', name, detail);
}

ok('status_pending_to_approved', canTransition('pending', 'approved'));
ok('status_block_returned_to_pending', !canTransition('returned', 'pending'));
try {
  assertTransition('checked_out', 'returned');
  ok('assert_checkout_to_returned', true);
} catch {
  ok('assert_checkout_to_returned', false);
}

ok('assertPerson_requires_unit', (() => {
  try { assertPerson({ unit: '', name: '测', phone: '0912345678' }); return false; } catch { return true; }
})());

const root = new PocketBase(env.POCKETBASE_URL || 'https://db.keson.pro');
await root.collection('_superusers').authWithPassword(
  readEnv('.env').POCKETBASE_ADMIN_EMAIL,
  readEnv('.env').POCKETBASE_ADMIN_PASSWORD
);

const assets = await root.collection('hkp_assets').getList(1, 1, {
  filter: 'availability_status = "available" && is_borrowable = true && is_active = true',
  fields: 'id,property_id,name,location,availability_status,usage_count'
});
ok('admin_list_assets', assets.totalItems > 0, `n=${assets.totalItems}`);

const pb = new PocketBase(env.POCKETBASE_URL || 'https://db.keson.pro');
await pb.collection('hkp_staff_users').authWithPassword(env.POCKETBASE_SERVICE_EMAIL, env.POCKETBASE_SERVICE_PASSWORD);
ok('service_login_role', pb.authStore.record?.role === 'service');

const serviceList = await pb.collection('hkp_assets').getList(1, 1, {
  filter: 'availability_status = "available" && is_borrowable = true && is_active = true',
  fields: 'id,property_id,name,location,availability_status'
});
ok('service_can_list_assets', serviceList.totalItems > 0, `n=${serviceList.totalItems}`);

const asset = assets.items[0];
const requestNo = createRequestNo();
const code = createVerificationCode();
let createdId = '';
try {
  const row = await pb.collection('hkp_reservations').create({
    request_no: requestNo,
    request_group_no: requestNo,
    verification_hash: hashToken(code),
    borrower_unit: '測試單位',
    borrower_name: '測試人員',
    borrower_phone: '0912345678',
    asset: asset.id,
    purpose: 'phase2 smoke',
    borrow_date: new Date().toISOString(),
    expected_return_date: new Date(Date.now() + 86400000).toISOString(),
    status: RESERVATION_STATUS.PENDING
  });
  createdId = row.id;
  ok('create_reservation', true, requestNo);

  await pb.collection('hkp_reservations').update(row.id, { status: RESERVATION_STATUS.APPROVED });
  await pb.collection('hkp_reservations').update(row.id, {
    status: RESERVATION_STATUS.CHECKED_OUT,
    checked_out_at: new Date().toISOString(),
    idempotency_key: row.id
  });
  const usage1 = await pb.collection('hkp_usage_records').create({
    asset: asset.id,
    user_name: '測試人員',
    department: '測試單位',
    purpose: 'phase2 smoke',
    used_at: new Date().toISOString(),
    note: `idem:${row.id}`
  });
  await root.collection('hkp_assets').update(asset.id, {
    usage_count: Number(asset.usage_count || 0) + 1,
    availability_status: 'checked_out'
  });
  ok('checkout_usage_created', !!usage1.id);

  const usageCount = await root.collection('hkp_usage_records').getList(1, 5, { filter: `note ~ "idem:${row.id}"` });
  ok('usage_single_for_idem', usageCount.totalItems === 1, `n=${usageCount.totalItems}`);

  await pb.collection('hkp_reservations').update(row.id, {
    status: RESERVATION_STATUS.RETURNED,
    returned_at: new Date().toISOString(),
    condition_return: '正常'
  });
  await root.collection('hkp_assets').update(asset.id, {
    availability_status: 'available',
    usage_count: Number(asset.usage_count || 0)
  });
  ok('return_ok', true);
} finally {
  if (createdId) {
    const usages = await root.collection('hkp_usage_records').getFullList({ filter: `note ~ "${createdId}"` }).catch(() => []);
    for (const u of usages) await root.collection('hkp_usage_records').delete(u.id).catch(() => {});
    await root.collection('hkp_reservations').delete(createdId).catch(() => {});
    await root.collection('hkp_assets').update(asset.id, {
      availability_status: 'available',
      usage_count: Number(asset.usage_count || 0)
    }).catch(() => {});
  }
}

const count = (await root.collection('hkp_assets').getList(1, 1)).totalItems;
ok('assets_still_390', count === 390, `n=${count}`);

const cryptoMod = await import('node:crypto');
const ids = (await root.collection('hkp_assets').getFullList({ fields: 'property_id', sort: 'property_id' }))
  .map((r) => r.property_id || '').join('\n');
const hash = cryptoMod.createHash('sha256').update(ids).digest('hex');
ok('fingerprint', hash === '421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132', hash);

fs.mkdirSync('docs/exports/phase2', { recursive: true });
fs.writeFileSync('docs/exports/phase2/smoke-results.json', JSON.stringify({ results, hash, count }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failedItems: failed }, null, 2));
process.exit(failed.length ? 1 : 0);
