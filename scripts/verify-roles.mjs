import fs from 'node:fs';

function load(file) {
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

const formal = { ...load('.env'), ...load('.env.local') };
const URL = 'https://db.keson.pro';

function keysOf(row) {
  return Object.keys(row || {}).filter((key) => !key.startsWith('collection')).sort();
}

async function main() {
  const PocketBase = (await import('pocketbase')).default;
  const anon = new PocketBase(URL);
  const result = {};
  const assets = await anon.collection('hkp_assets').getList(1, 1).catch((error) => ({ error: error.status }));
  result.anon_assets = assets.totalItems ?? assets.error ?? 'fail';
  const guest = await anon.collection('hkp_assets_guest').getList(1, 1);
  result.guest_total = guest.totalItems;
  result.guest_fields = keysOf(guest.items[0]);
  result.guest_has_price = result.guest_fields.includes('price') || result.guest_fields.includes('custodian');
  const borrows = await anon.collection('hkp_borrow_requests').getList(1, 1).catch((error) => ({ status: error.status, total: error.status }));
  result.anon_borrow_list = borrows.totalItems ?? borrows.status;
  const route = await fetch(`${URL}/api/hkp/public/borrow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  result.public_route = route.status;

  const admin = new PocketBase(URL);
  await admin.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_ADMIN_EMAIL, formal.HKP_FORMAL_PASSWORD);
  result.admin_role = admin.authStore.record?.role;
  result.admin_active = admin.authStore.record?.active !== false && admin.authStore.record?.is_active !== false;
  const catalog = await admin.collection('hkp_assets').getList(1, 1);
  result.admin_assets = catalog.totalItems;
  const staffUsers = await admin.collection('hkp_staff_users').getList(1, 5);
  result.admin_can_list_staff = staffUsers.totalItems;

  const staff = new PocketBase(URL);
  await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);
  result.staff_role = staff.authStore.record?.role;
  const staffList = await staff.collection('hkp_staff_users').getList(1, 20).catch((error) => ({ status: error.status, totalItems: 0 }));
  result.staff_visible_accounts = staffList.totalItems ?? 0;
  result.staff_cannot_create_asset = Boolean(await staff.collection('hkp_assets').create({ name: 'should-fail', property_id: `NO-${Date.now()}` }).then(() => false).catch(() => true));

  const sample = guest.items[0];
  const created = await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-VERIFY-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: '驗證姓名',
    borrower_phone: '0912000111',
    asset: sample.id,
    purpose: '權限驗證',
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: 'a'.repeat(64),
    privacy_ack: true
  });
  result.anon_create_pending = created.status === 'pending';
  const seen = await staff.collection('hkp_borrow_requests').getOne(created.id);
  result.staff_can_read_request = Boolean(seen.id);
  const blocked = await anon.collection('hkp_borrow_requests').getOne(created.id).then(() => false).catch((error) => error.status);
  result.anon_view_request = blocked;
  await admin.collection('hkp_borrow_requests').delete(created.id);
  result.cleaned = true;
  const nameChange = await staff.collection('hkp_assets').update(sample.id, { name: '不應寫入' }).then(() => false).catch(() => true);
  result.staff_cannot_rename_asset = nameChange;
  console.log(JSON.stringify(result));
  if (!nameChange) throw new Error('staff renamed an asset');
  if (catalog.totalItems !== 390) throw new Error('asset count changed');
  if (result.guest_has_price) throw new Error('guest view leaked internal fields');
  if (result.anon_borrow_list !== 0 && result.anon_borrow_list !== 403 && result.anon_borrow_list !== 400) {
    throw new Error('anonymous borrow list was not blocked');
  }
}

main().catch((error) => {
  console.error(error?.message || 'verify failed');
  process.exit(1);
});
