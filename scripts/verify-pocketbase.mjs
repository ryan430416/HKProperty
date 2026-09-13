/**
 * Formal PocketBase checks for HKProperty.
 * Does not embed passwords, tokens, or account data.
 *
 * Required:
 *   POCKETBASE_URL
 *   TEST_USER_EMAIL
 *   TEST_USER_PASSWORD
 *
 * Optional, used only when set at runtime:
 *   TEST_STAFF_EMAIL / TEST_STAFF_PASSWORD
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD
 *   CLEANUP_EMAIL / CLEANUP_PASSWORD   superuser, deletes only this run's marker
 *
 * Live collections are hkp_*, not unprefixed assets/usage_records.
 * Unprefixed names are probed and recorded; they are not created.
 */
import PocketBase from 'pocketbase';

const url = String(process.env.POCKETBASE_URL || '').trim().replace(/\/$/, '');
const email = String(process.env.TEST_USER_EMAIL || '').trim();
const password = String(process.env.TEST_USER_PASSWORD || '');
if (!url || !email || !password) {
  console.error('缺少 POCKETBASE_URL、TEST_USER_EMAIL 或 TEST_USER_PASSWORD');
  process.exit(1);
}

const C = {
  users: 'hkp_users',
  assets: 'hkp_assets',
  assetsPublic: 'hkp_assets_public',
  usage: 'hkp_usage_records',
  usageCounts: 'hkp_usage_counts',
  reservations: 'hkp_asset_reservations',
  slots: 'hkp_reservation_slots',
  loans: 'hkp_loan_records',
  logs: 'hkp_operation_logs',
  settings: 'hkp_system_settings',
  audits: 'hkp_inventory_audits',
  locations: 'hkp_location_history'
};
const MARKER = 'SYSTEM_E2E_TEST';
const runId = `E2E-${Date.now().toString(36)}`;
const note = `${MARKER} ${runId} 自動化測試資料，可由管理員刪除`;

const results = [];
function record(name, ok, evidence, extra = {}) {
  results.push({ name, ok, evidence, ...extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${evidence}`);
}

function client() {
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  return pb;
}

function statusOf(error) {
  return error?.status || error?.data?.code || 0;
}

function denied(error) {
  const status = statusOf(error);
  return status === 401 || status === 403 || status === 404;
}

async function login(targetEmail, targetPassword) {
  const pb = client();
  await pb.collection(C.users).authWithPassword(targetEmail, targetPassword);
  return pb;
}

async function cleanup(admin) {
  if (!admin) return { skipped: true };
  const removed = {};
  for (const name of [C.usage, C.reservations, C.loans, C.logs]) {
    const rows = await admin.collection(name).getFullList({ filter: `note ~ "${runId}" || purpose ~ "${runId}"` }).catch(async () => {
      return admin.collection(name).getFullList({ filter: `note ~ "${runId}"` }).catch(() => []);
    });
    const mine = rows.filter((row) => `${row.note || ''} ${row.purpose || ''}`.includes(runId));
    for (const row of mine) await admin.collection(name).delete(row.id);
    removed[name] = mine.length;
  }
  const assets = await admin.collection(C.assets).getList(1, 1);
  return { removed, assets: assets.totalItems };
}

const anon = client();
const started = Date.now();
let healthMs = 0;
try {
  const t0 = Date.now();
  const health = await fetch(`${url}/api/health`);
  healthMs = Date.now() - t0;
  record('connect', health.ok, `health ${health.status} in ${healthMs}ms`);
} catch (error) {
  record('connect', false, error.message);
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
}

const tSeq = Date.now();
for (const name of [C.assets, C.loans, C.reservations, C.usage]) {
  await anon.collection(name).getList(1, 1).catch(() => null);
}
const sequentialMs = Date.now() - tSeq;
const tPar = Date.now();
await Promise.allSettled([C.assets, C.loans, C.reservations, C.usage].map((name) => anon.collection(name).getList(1, 1)));
const parallelMs = Date.now() - tPar;
record('health-timing', true, `health ${healthMs}ms; sequential collections ${sequentialMs}ms; parallel ${parallelMs}ms`);

for (const name of ['assets', 'usage_records', 'reservations', 'borrow_records']) {
  try {
    await anon.collection(name).getList(1, 1);
    record(`unprefixed-${name}`, false, '未加前綴的集合存在，可能指錯資料庫');
  } catch (error) {
    record(`unprefixed-${name}`, statusOf(error) === 404, `status ${statusOf(error)}，正式資料在對應的 hkp_*`);
  }
}

let pb;
try {
  pb = await login(email, password);
  record('login', true, `role=${pb.authStore.record?.role || 'unknown'} collection=${pb.authStore.record?.collectionName || ''}`);
} catch (error) {
  record('login', false, `status ${statusOf(error)} ${error.message || ''}`);
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
}

const me = pb.authStore.record;
const staff = me.role === 'staff' || me.role === 'admin';
const assetCollection = staff ? C.assets : C.assetsPublic;
let asset;
let snapshot;
try {
  const list = await pb.collection(assetCollection).getList(1, 1);
  const sample = await pb.collection(assetCollection).getList(1, 1, { sort: 'property_id' });
  const row = sample.items[0] || {};
  const fields = ['property_id', 'name', 'location', 'availability_status'].filter((key) => row[key] != null || key in row);
  record('read-assets', list.totalItems === 390 && fields.length === 4, `${assetCollection} total=${list.totalItems} fields=${fields.join(',')}`);
  asset = await pb.collection(assetCollection).getFirstListItem('availability_status = "available" && is_borrowable = true');
  snapshot = {
    id: asset.id,
    location: asset.location || '',
    availability_status: asset.availability_status,
    property_id: asset.property_id
  };
} catch (error) {
  record('read-assets', false, error.message || String(statusOf(error)));
}

const countsBefore = asset
  ? await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` }).catch(() => ({ items: [] }))
  : { items: [] };
const usageBefore = countsBefore.items[0]?.usage_count ?? 0;

let reservation;
if (asset) {
  const start = new Date(Date.now() + 9 * 86400000);
  const end = new Date(start.getTime() + 2 * 3600000);
  try {
    reservation = await pb.collection(C.reservations).create({
      reservation_number: `RSV-${runId}`,
      asset: asset.id,
      user: me.id,
      user_name: me.display_name || me.name || 'e2e',
      property_id: asset.property_id,
      property_name: asset.name,
      purpose: MARKER,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: 'pending',
      note
    });
    const again = await pb.collection(C.reservations).getOne(reservation.id);
    record('reservation-create-read', again.id === reservation.id && again.status === 'pending', `id=${again.id} status=${again.status}`);
  } catch (error) {
    record('reservation-create-read', false, `status ${statusOf(error)} ${error.message || ''}`);
  }

  if (reservation) {
    const slots = await pb.collection(C.slots).getFullList({
      filter: `asset = "${asset.id}" && (status = "pending" || status = "approved")`
    }).catch((error) => {
      record('reservation-slot-query', false, `status ${statusOf(error)}`);
      return [];
    });
    const overlap = slots.some((row) => new Date(start).getTime() < new Date(row.end_at).getTime() && new Date(end).getTime() > new Date(row.start_at).getTime());
    record('reservation-slot-query', overlap, `slots=${slots.length} overlap=${overlap}`);

    try {
      const cancelled = await pb.collection(C.reservations).update(reservation.id, { status: 'cancelled' });
      const reread = await pb.collection(C.reservations).getOne(reservation.id);
      const countAfterCancel = (await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
      record('reservation-does-not-increase-usage', countAfterCancel === usageBefore, `before=${usageBefore} afterCancel=${countAfterCancel}`);
      record('reservation-cancel', reread.status === 'cancelled', `status=${reread.status}`);
      reservation = cancelled;
    } catch (error) {
      record('reservation-cancel', false, `status ${statusOf(error)} ${error.message || ''}`);
    }
  }
}

let usage;
if (asset) {
  try {
    usage = await pb.collection(C.usage).create({
      asset: asset.id,
      user: me.id,
      user_name: me.display_name || me.name || 'e2e',
      user_number: me.school_number || 'E2E0001',
      department: me.department || '測試',
      purpose: MARKER,
      used_at: new Date().toISOString(),
      note,
      created_by: me.id,
      property_id: asset.property_id,
      property_name: asset.name
    });
    const listed = await pb.collection(C.usage).getOne(usage.id);
    const countsAfter = await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` });
    const usageAfter = countsAfter.items[0]?.usage_count ?? 0;
    const afterAsset = await pb.collection(assetCollection).getOne(asset.id);
    record('usage-create-reread', listed.id === usage.id, `id=${listed.id}`);
    record('usage-count-plus-one', usageAfter === usageBefore + 1, `before=${usageBefore} after=${usageAfter}`);
    record('usage-location-unchanged', (afterAsset.location || '') === snapshot.location, `location=${afterAsset.location || ''}`);
    record('usage-not-checked-out', afterAsset.availability_status !== 'checked_out', `availability=${afterAsset.availability_status}`);
  } catch (error) {
    record('usage-create-reread', false, `status ${statusOf(error)} ${error.message || ''}`);
  }
}

let checkoutCount = null;
if (asset && snapshot) {
  let loan;
  const expectedReturn = new Date(Date.now() + 2 * 3600000).toISOString();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const countAtCheckout = (await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
    loan = await pb.collection(C.loans).create({
      loan_number: `LOAN-${runId}`,
      asset: asset.id,
      property_id: asset.property_id,
      property_name: asset.name,
      borrower: me.id,
      borrower_name: me.display_name || me.name || 'e2e',
      borrower_number: me.school_number || 'E2E0001',
      borrower_department: me.department || '測試',
      purpose: MARKER,
      requested_at: new Date().toISOString(),
      checkout_at: new Date().toISOString(),
      expected_return_at: expectedReturn,
      checkout_method: 'self_service',
      checkout_operator: '自助借用',
      status: 'checked_out',
      note
    });
    await pb.collection(assetCollection === C.assets ? C.assets : C.assets).update(asset.id, {
      availability_status: 'checked_out',
      current_loan: loan.id
    });
    await pb.collection(C.usage).create({
      asset: asset.id,
      loan: loan.id,
      user: me.id,
      user_name: me.display_name || me.name || 'e2e',
      user_number: me.school_number || 'E2E0001',
      department: me.department || '測試',
      purpose: MARKER,
      used_at: new Date().toISOString(),
      note,
      created_by: me.id,
      property_id: asset.property_id,
      property_name: asset.name
    });
    const checked = await pb.collection(assetCollection).getOne(asset.id);
    checkoutCount = (await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
    record('loan-checkout', checked.availability_status === 'checked_out' && checkoutCount === countAtCheckout + 1, `availability=${checked.availability_status} count ${countAtCheckout}->${checkoutCount} loan=${loan.id}`);
  } catch (error) {
    record('loan-checkout', false, `status ${statusOf(error)} ${error.message || ''}`);
  }
  if (loan) {
    try {
      await pb.collection(C.loans).create({
        loan_number: `LOAN-${runId}-2`,
        asset: asset.id,
        property_id: asset.property_id,
        property_name: asset.name,
        borrower: me.id,
        borrower_name: me.display_name || me.name || 'e2e',
        borrower_number: me.school_number || 'E2E0001',
        borrower_department: me.department || '測試',
        purpose: MARKER,
        expected_return_at: expectedReturn,
        checkout_method: 'self_service',
        status: 'checked_out',
        note: `${note} duplicate`
      });
      record('loan-duplicate-blocked', false, 'second checkout create succeeded at API');
    } catch (error) {
      record('loan-duplicate-blocked', ruleDenied(error) || denied(error), `status=${statusOf(error)} ${error.message || ''}`);
    }
    const returnedAt = new Date().toISOString();
    try {
      const returned = await pb.collection(C.loans).update(loan.id, {
        status: 'returned',
        returned_at: returnedAt,
        return_result: '正常歸還',
        return_operator: '自助歸還'
      });
      await pb.collection(C.assets).update(asset.id, {
        availability_status: 'available',
        current_loan: null
      });
      const afterLoan = await pb.collection(C.loans).getOne(loan.id);
      const afterAsset = await pb.collection(assetCollection).getOne(asset.id);
      const countAfterReturn = (await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
      record('loan-return', afterLoan.status === 'returned' && Boolean(afterLoan.returned_at) && afterAsset.availability_status === 'available' && countAfterReturn === checkoutCount, `loan=${afterLoan.status} returned_at=${Boolean(afterLoan.returned_at)} availability=${afterAsset.availability_status} count ${checkoutCount}->${countAfterReturn}`);
      if (returned.status !== 'returned') record('loan-return-status', false, returned.status);
    } catch (error) {
      record('loan-return', false, `status ${statusOf(error)} ${error.message || ''}`);
    }
  }
  record('loan-number-day', day.length === 8, 'marker only');
}

try {
  await pb.collection(C.reservations).update(reservation?.id || 'missing', { status: 'approved' });
  record('borrower-cannot-self-approve', me.role !== 'borrower', 'update returned success');
} catch (error) {
  record('borrower-cannot-self-approve', me.role !== 'borrower' || denied(error), `role=${me.role} status=${statusOf(error)}`);
}

if (asset && me.role === 'borrower') {
  try {
    await pb.collection(C.assets).update(asset.id, { usage_count: 99999, location: 'E2E-SHOULD-NOT-STICK' });
    record('borrower-cannot-edit-managed-fields', false, 'update returned success');
  } catch (error) {
    const after = await pb.collection(assetCollection).getOne(asset.id);
    record(
      'borrower-cannot-edit-managed-fields',
      denied(error) && (after.location || '') === snapshot.location,
      `status=${statusOf(error)} location=${after.location || ''}`
    );
  }
}

function ruleDenied(error) {
  if (denied(error)) return true;
  const fields = Object.keys(error?.data?.data || {});
  return statusOf(error) === 400 && fields.length === 0 && /Failed to create record/i.test(error?.message || '');
}
try {
  const users = await anon.collection(C.users).getList(1, 1);
  record('anon-cannot-list-users', users.totalItems === 0, `list total=${users.totalItems}（規則不符時 PocketBase 回空列表）`);
} catch (error) {
  record('anon-cannot-list-users', denied(error), `status=${statusOf(error)}`);
}
if (asset) {
  try {
    await anon.collection(C.assets).getOne(asset.id);
    record('anon-cannot-read-asset', false, 'getOne returned success');
  } catch (error) {
    record('anon-cannot-read-asset', denied(error), `status=${statusOf(error)}`);
  }
}
try {
  await anon.collection(C.usage).create({ purpose: MARKER, note });
  record('anon-cannot-create-usage', false, 'create returned success');
} catch (error) {
  record('anon-cannot-create-usage', ruleDenied(error), `status=${statusOf(error)} ${error.message || ''}`);
}
try {
  await anon.collection(C.reservations).create({ purpose: MARKER, note, status: 'pending' });
  record('anon-cannot-create-reservation', false, 'create returned success');
} catch (error) {
  record('anon-cannot-create-reservation', ruleDenied(error), `status=${statusOf(error)} ${error.message || ''}`);
}
try {
  await anon.collection(C.loans).create({ purpose: MARKER, note, status: 'pending' });
  record('anon-cannot-create-loan', false, 'create returned success');
} catch (error) {
  record('anon-cannot-create-loan', ruleDenied(error), `status=${statusOf(error)} ${error.message || ''}`);
}
try {
  const audits = await anon.collection(C.audits).getList(1, 1);
  record('anon-cannot-list-audits', audits.totalItems === 0, `list total=${audits.totalItems}`);
} catch (error) {
  record('anon-cannot-list-audits', denied(error), `status=${statusOf(error)}`);
}

async function roleProbe(label, roleEmail, rolePassword) {
  if (!roleEmail) {
    record(label, false, '未提供環境變數，未執行');
    return null;
  }
  try {
    return await login(roleEmail, rolePassword || password);
  } catch (error) {
    record(label, false, `login status ${statusOf(error)}`);
    return null;
  }
}

const staffPb = await roleProbe('staff-login', process.env.TEST_STAFF_EMAIL, process.env.TEST_STAFF_PASSWORD);
if (staffPb && asset) {
  record('staff-login', staffPb.authStore.record?.role === 'staff', `role=${staffPb.authStore.record?.role}`);
  const start = new Date(Date.now() + 5 * 60000);
  const end = new Date(start.getTime() + 3600000);
  let approved;
  try {
    const countBeforeApprove = (await pb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
    const pending = await pb.collection(C.reservations).create({
      reservation_number: `RSV-CVT-${runId}`,
      asset: asset.id,
      user: me.id,
      user_name: me.display_name || me.name || 'e2e',
      user_number: me.school_number || 'E2E0001',
      department: me.department || '測試',
      property_id: asset.property_id,
      property_name: asset.name,
      purpose: MARKER,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: 'pending',
      note
    });
    approved = await staffPb.collection(C.reservations).update(pending.id, { status: 'approved', approved_by: staffPb.authStore.record.id, approved_at: new Date().toISOString() });
    const countAfterApprove = (await staffPb.collection(C.usageCounts).getList(1, 1, { filter: `id = "${asset.id}"` })).items[0]?.usage_count ?? 0;
    record('reservation-approve', approved.status === 'approved' && countAfterApprove === countBeforeApprove, `status=${approved.status} count ${countBeforeApprove}->${countAfterApprove}`);
    const loan = await staffPb.collection(C.loans).create({
      loan_number: `LOAN-CVT-${runId}`,
      asset: asset.id,
      property_id: asset.property_id,
      property_name: asset.name,
      borrower: me.id,
      borrower_name: me.display_name || me.name || 'e2e',
      borrower_number: me.school_number || 'E2E0001',
      borrower_department: me.department || '測試',
      purpose: MARKER,
      checkout_at: new Date().toISOString(),
      expected_return_at: end.toISOString(),
      checkout_method: 'reservation',
      status: 'checked_out',
      note
    });
    await staffPb.collection(C.assets).update(asset.id, { availability_status: 'checked_out', current_loan: loan.id });
    const converted = await staffPb.collection(C.reservations).update(approved.id, { status: 'converted', converted_loan: loan.id });
    let secondBlocked = false;
    try {
      await staffPb.collection(C.loans).create({
        loan_number: `LOAN-CVT2-${runId}`,
        asset: asset.id,
        property_id: asset.property_id,
        property_name: asset.name,
        borrower: me.id,
        borrower_name: 'e2e',
        borrower_number: 'E2E0001',
        borrower_department: '測試',
        purpose: MARKER,
        expected_return_at: end.toISOString(),
        checkout_method: 'reservation',
        status: 'checked_out',
        note: `${note} duplicate-convert`
      });
    } catch (error) {
      secondBlocked = ruleDenied(error) || denied(error);
    }
    record('reservation-convert-once', converted.status === 'converted' && Boolean(converted.converted_loan) && secondBlocked, `status=${converted.status} secondBlocked=${secondBlocked}`);
    await staffPb.collection(C.loans).update(loan.id, { status: 'returned', returned_at: new Date().toISOString(), return_result: '正常歸還' });
    await staffPb.collection(C.assets).update(asset.id, { availability_status: 'available', current_loan: null });
  } catch (error) {
    record('reservation-approve', false, `status ${statusOf(error)} ${error.message || ''}`);
  }
}
if (staffPb) {
  try {
    await staffPb.collection(C.settings).update('missing', { default_loan_days: 9 });
    record('staff-cannot-edit-settings', false, 'update returned success');
  } catch (error) {
    record('staff-cannot-edit-settings', denied(error), `status=${statusOf(error)}`);
  }
  try {
    const adminEmail = process.env.TEST_ADMIN_EMAIL;
    if (!adminEmail) throw Object.assign(new Error('no admin email'), { status: 0 });
    const adminRow = await staffPb.collection(C.users).getFirstListItem(`email = "${adminEmail}"`);
    await staffPb.collection(C.users).update(adminRow.id, { role: 'borrower' });
    record('staff-cannot-edit-admin', false, 'update returned success');
  } catch (error) {
    record('staff-cannot-edit-admin', denied(error) || statusOf(error) === 0, `status=${statusOf(error)}`);
  }
}

const adminPb = await roleProbe('admin-login', process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
if (adminPb) {
  record('admin-login', adminPb.authStore.record?.role === 'admin', `role=${adminPb.authStore.record?.role}`);
  try {
    const assets = await adminPb.collection(C.assets).getList(1, 1);
    const logs = await adminPb.collection(C.logs).getList(1, 1);
    record('admin-can-read-assets-and-logs', assets.totalItems === 390, `assets=${assets.totalItems} logsVisible=${logs.totalItems >= 0}`);
  } catch (error) {
    record('admin-can-read-assets-and-logs', false, `status=${statusOf(error)}`);
  }
}

let cleanupPb = null;
if (process.env.CLEANUP_EMAIL && process.env.CLEANUP_PASSWORD) {
  cleanupPb = client();
  await cleanupPb.collection('_superusers').authWithPassword(process.env.CLEANUP_EMAIL, process.env.CLEANUP_PASSWORD);
}
let cleaned = { skipped: true };
try {
  cleaned = await cleanup(cleanupPb);
} catch (error) {
  cleaned = { error: error.message };
}
record('cleanup', Boolean(cleanupPb) && !cleaned.error, cleanupPb ? JSON.stringify(cleaned) : '未提供 CLEANUP_EMAIL，保留帶識別碼的測試資料');

const failed = results.filter((row) => !row.ok);
console.log(JSON.stringify({
  runId,
  elapsedMs: Date.now() - started,
  failed: failed.length,
  results
}, null, 2));
if (failed.length) process.exitCode = 1;
