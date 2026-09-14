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
const root = new PocketBase(URL);
const anon = new PocketBase(URL);
const staff = new PocketBase(URL);
const result = {};
const marker = 'HKP-VERIFY-FLOW';
const phone = '09125550123';
const name = '時段驗證';
const nameHash = createHash('sha256').update(name).digest('hex');
const tokenHash = createHash('sha256').update('flow-token-not-a-secret').digest('hex');
const headers = { 'x-hkp-token': tokenHash, 'x-hkp-name': nameHash, 'x-hkp-phone': phone };
let asset = null;
let previous = null;

function lockBody(number, slot, end) {
  return {
    reservation_number: number,
    asset: asset.id,
    slot_start: slot,
    start_at: slot,
    end_at: end,
    borrower_unit: '驗證單位',
    borrower_name: name,
    borrower_name_hash: nameHash,
    borrower_phone: phone,
    purpose: '時段流程驗證',
    notes: marker,
    status: 'pending',
    public_token_hash: tokenHash,
    privacy_ack: true
  };
}

async function cleanup() {
  if (asset && previous) {
    await root.collection('hkp_assets').update(asset.id, { availability_status: previous }).catch(() => {});
    previous = null;
  }
  for (const name of ['hkp_time_locks', 'hkp_borrow_requests', 'hkp_reservations_v2']) {
    const rows = await root.collection(name).getFullList({ filter: `notes = "${marker}"` }).catch(() => []);
    for (const row of rows) await root.collection(name).delete(row.id).catch(() => {});
  }
}

await root.collection('_superusers').authWithPassword(formal.POCKETBASE_ADMIN_EMAIL, formal.POCKETBASE_ADMIN_PASSWORD);

try {
  const health = await fetch(`${URL}/api/health`);
  const reserve = await fetch(`${URL}/api/hkp/public/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  result.health = health.status;
  result.reserve_route = reserve.status;

  const guest = await anon.collection('hkp_assets_guest').getList(1, 1, {
    filter: 'availability_status = "available" && is_borrowable != false'
  });
  const guestRow = guest.items[0] || {};
  result.guest_has_price = Object.prototype.hasOwnProperty.call(guestRow, 'price') || Object.prototype.hasOwnProperty.call(guestRow, 'custodian');
  asset = await root.collection('hkp_assets').getOne(guestRow.id, { fields: 'id,availability_status' });
  previous = asset.availability_status;

  const created = [];
  for (const slot of ['2032-03-01T02:00:00.000Z', '2032-03-01T03:00:00.000Z']) {
    created.push(await anon.collection('hkp_time_locks').create(lockBody('RV-FLOW-A', slot, '2032-03-01T04:00:00.000Z')));
  }
  result.two_hour_rows = created.length;
  result.overlap_second_hour = await anon.collection('hkp_time_locks').create(
    lockBody('RV-FLOW-B', '2032-03-01T03:00:00.000Z', '2032-03-01T04:00:00.000Z')
  ).then(() => 'created').catch((error) => error.status);
  result.adjacent_hour = await anon.collection('hkp_time_locks').create(
    lockBody('RV-FLOW-C', '2032-03-01T04:00:00.000Z', '2032-03-01T05:00:00.000Z')
  ).then(() => 'created').catch((error) => error.status);

  const publicSlots = await anon.collection('hkp_lock_public').getList(1, 5, {
    filter: `asset = "${asset.id}" && slot_start = "2032-03-01T02:00:00.000Z"`,
    fields: 'id,slot_start,status,borrower_name,borrower_phone'
  });
  result.public_slot = publicSlots.totalItems;
  result.public_leaks_name = publicSlots.items.some((row) => row.borrower_name || row.borrower_phone);
  result.anon_lock_list = (await anon.collection('hkp_time_locks').getList(1, 1).catch(() => ({ totalItems: -1 }))).totalItems;

  result.lookup_wrong_phone = (await anon.collection('hkp_lock_verify').getList(1, 1, {
    filter: 'reservation_number = "RV-FLOW-A"',
    headers: { ...headers, 'x-hkp-phone': '0988000111' }
  })).totalItems;
  const looked = await anon.collection('hkp_lock_verify').getList(1, 1, {
    filter: 'reservation_number = "RV-FLOW-A"',
    fields: 'id,reservation_number,status',
    headers
  });
  result.lookup_match = looked.items.length;
  result.lookup_has_phone = Boolean(looked.items[0]?.borrower_phone);
  result.lookup_keys = Object.keys(looked.items[0] || {}).filter((key) => !['collectionId', 'collectionName', 'id'].includes(key)).sort();

  result.cancel_wrong_phone = await anon.collection('hkp_time_locks').update(created[0].id, {
    status: 'cancelled',
    slot_start: `released:${created[0].id}`
  }, { headers: { ...headers, 'x-hkp-phone': '0988000111' } }).then(() => 'updated').catch((error) => error.status);

  await staff.collection('hkp_staff_users').authWithPassword(formal.HKP_FORMAL_STAFF_EMAIL, formal.HKP_FORMAL_PASSWORD);
  const desk = await staff.collection('hkp_time_locks').getFullList({
    filter: `reservation_number = "RV-FLOW-A"`,
    fields: 'id,reservation_number,status,slot_start'
  });
  result.staff_sees_group = desk.length;
  await staff.collection('hkp_time_locks').update(created[0].id, { status: 'approved' });
  result.approved_still_blocks = await anon.collection('hkp_time_locks').create(
    lockBody('RV-FLOW-D', '2032-03-01T02:00:00.000Z', '2032-03-01T03:00:00.000Z')
  ).then(() => 'created').catch((error) => error.status);
  result.cancel_after_approve = await anon.collection('hkp_time_locks').update(created[0].id, {
    status: 'cancelled',
    slot_start: `released:${created[0].id}`
  }, { headers }).then(() => 'updated').catch((error) => error.status);

  await staff.collection('hkp_time_locks').update(created[1].id, {
    status: 'rejected',
    slot_start: `released:${created[1].id}`
  });
  result.rebook_after_reject = await anon.collection('hkp_time_locks').create(
    lockBody('RV-FLOW-E', '2032-03-01T03:00:00.000Z', '2032-03-01T04:00:00.000Z')
  ).then(() => 'created').catch((error) => error.status);

  const adjacent = await root.collection('hkp_time_locks').getFirstListItem('reservation_number = "RV-FLOW-C"');
  await anon.collection('hkp_time_locks').update(adjacent.id, {
    status: 'cancelled',
    slot_start: `released:${adjacent.id}`
  }, { headers });
  result.cancel_releases = await anon.collection('hkp_time_locks').create(
    lockBody('RV-FLOW-F', '2032-03-01T04:00:00.000Z', '2032-03-01T05:00:00.000Z')
  ).then(() => 'created').catch((error) => error.status);

  previous = asset.availability_status;
  await root.collection('hkp_assets').update(asset.id, { availability_status: 'checked_out' });
  result.borrow_while_out = await anon.collection('hkp_borrow_requests').create({
    request_number: `BR-FLOW-${Date.now().toString(36)}`,
    borrower_unit: '驗證單位',
    borrower_name: name,
    borrower_name_hash: nameHash,
    borrower_phone: phone,
    asset: asset.id,
    purpose: '借用規則驗證',
    notes: marker,
    requested_at: new Date().toISOString(),
    expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
    public_token_hash: tokenHash,
    privacy_ack: true
  }).then(() => 'created').catch((error) => error.status);
  await root.collection('hkp_assets').update(asset.id, { availability_status: previous });
  previous = null;
} catch (error) {
  result.error = error.status || error.message || 'failed';
} finally {
  await cleanup();
  const assets = await root.collection('hkp_assets').getList(1, 1);
  const leftover = await root.collection('hkp_time_locks').getList(1, 1, { filter: `notes = "${marker}"` }).catch(() => ({ totalItems: -1 }));
  result.assets = assets.totalItems;
  result.leftover_locks = leftover.totalItems;
  if (asset) {
    const restored = await root.collection('hkp_assets').getOne(asset.id, { fields: 'id,availability_status' });
    result.asset_status = restored.availability_status;
  }
  console.log(JSON.stringify(result));
  const expected = {
    health: 200,
    reserve_route: 404,
    guest_has_price: false,
    two_hour_rows: 2,
    overlap_second_hour: 400,
    adjacent_hour: 'created',
    public_slot: 1,
    public_leaks_name: false,
    anon_lock_list: 0,
    lookup_wrong_phone: 0,
    lookup_match: 1,
    lookup_has_phone: false,
    cancel_wrong_phone: 404,
    staff_sees_group: 2,
    approved_still_blocks: 400,
    cancel_after_approve: 404,
    rebook_after_reject: 'created',
    cancel_releases: 'created',
    borrow_while_out: 400,
    assets: 390,
    leftover_locks: 0,
    asset_status: 'available'
  };
  const failed = Object.entries(expected).filter(([key, value]) => JSON.stringify(result[key]) !== JSON.stringify(value));
  if (failed.length || result.error) {
    console.log(JSON.stringify({ failed: failed.map(([key, value]) => ({ key, expected: value, actual: result[key] })), error: result.error || null }));
    process.exitCode = 1;
  }
}
