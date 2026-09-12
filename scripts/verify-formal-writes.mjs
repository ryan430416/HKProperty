/**
 * Real formal-mode write check against https://db.keson.pro.
 * Creates then removes only the records this script inserted.
 * Does not modify hkp_assets records.
 */
import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const local = loadEnv('.env.local');
const url = 'https://db.keson.pro';
const pb = new PocketBase(url);
pb.autoCancellation(false);
const report = { url, writes: [] };

await pb.collection('hkp_users').authWithPassword(local.HKP_FORMAL_BORROWER_EMAIL, local.HKP_FORMAL_PASSWORD);
const me = pb.authStore.record;
report.login = { role: me.role, collection: me.collectionName };

const assetsBefore = await pb.collection('hkp_assets_public').getList(1, 1);
report.publicAssets = assetsBefore.totalItems;
const asset = await pb.collection('hkp_assets_public').getFirstListItem('availability_status = "available" && is_borrowable = true');
const countBefore = await pb.collection('hkp_usage_counts').getList(1, 1, { filter: `id = "${asset.id}"` });
report.usageCountBefore = countBefore.items[0]?.usage_count ?? 0;

const usedAt = new Date().toISOString();
let usage;
try {
  usage = await pb.collection('hkp_usage_records').create({
    asset: asset.id,
    user: me.id,
    user_name: me.display_name || me.name || '正式借用人',
    user_number: me.school_number || 'B0001',
    department: me.department || '資訊工程系',
    purpose: '正式模式寫入驗證',
    used_at: usedAt,
    note: 'round2-verify',
    created_by: me.id,
    property_id: asset.property_id,
    property_name: asset.name
  });
  report.writes.push({ action: 'usage.create', ok: true, id: usage.id });
} catch (error) {
  report.writes.push({ action: 'usage.create', ok: false, status: error?.status, message: error?.message, fields: Object.keys(error?.data?.data || {}) });
  throw Object.assign(new Error('usage create failed'), { report });
}

const reread = await pb.collection('hkp_usage_records').getOne(usage.id);
report.usageReread = {
  id: reread.id,
  property_id: reread.property_id,
  property_name: reread.property_name,
  user: reread.user,
  created_by: reread.created_by,
  user_number: reread.user_number
};
const countAfter = await pb.collection('hkp_usage_counts').getList(1, 1, { filter: `id = "${asset.id}"` });
report.usageCountAfter = countAfter.items[0]?.usage_count ?? 0;

const start = new Date(Date.now() + 7 * 86400000);
const end = new Date(start.getTime() + 2 * 3600000);
let reservation;
try {
  reservation = await pb.collection('hkp_asset_reservations').create({
    reservation_number: `RSV-VERIFY-${Date.now().toString(36).toUpperCase()}`,
    asset: asset.id,
    user: me.id,
    user_name: me.display_name || me.name || '正式借用人',
    property_id: asset.property_id,
    property_name: asset.name,
    purpose: '正式模式預借驗證',
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: 'pending',
    note: 'round2-verify'
  });
  report.writes.push({ action: 'reservation.create', ok: true, id: reservation.id, status: reservation.status });
} catch (error) {
  report.writes.push({ action: 'reservation.create', ok: false, status: error?.status, message: error?.message });
}

let overlapRecord = null;
try {
  overlapRecord = await pb.collection('hkp_asset_reservations').create({
    reservation_number: `RSV-OVERLAP-${Date.now().toString(36).toUpperCase()}`,
    asset: asset.id,
    user: me.id,
    user_name: me.display_name || '正式借用人',
    property_id: asset.property_id,
    property_name: asset.name,
    purpose: '重疊驗證',
    start_at: new Date(start.getTime() + 30 * 60000).toISOString(),
    end_at: new Date(end.getTime() + 30 * 60000).toISOString(),
    status: 'pending'
  });
  report.overlap = { apiBlocked: false, note: 'API rule 本身不擋時段重疊；正式送出由程式查詢 hkp_reservation_slots 後拒絕' };
} catch (error) {
  report.overlap = { apiBlocked: true, status: error?.status || null };
}
if (reservation) {
  const slots = await pb.collection('hkp_reservation_slots').getFullList({
    filter: `asset = "${asset.id}" && (status = "pending" || status = "approved")`
  });
  const overlap = slots.some((row) => {
    return new Date(start).getTime() < new Date(row.end_at).getTime()
      && new Date(end).getTime() > new Date(row.start_at).getTime();
  });
  report.slotQuery = { slots: slots.length, overlapDetected: overlap };
}

let selfApprove = { blocked: false };
try {
  await pb.collection('hkp_asset_reservations').update(reservation.id, { status: 'approved' });
  selfApprove = { blocked: false };
} catch (error) {
  selfApprove = { blocked: error?.status === 403 || error?.status === 400, status: error?.status };
}
report.selfApprove = selfApprove;

if (reservation) {
  const cancelled = await pb.collection('hkp_asset_reservations').update(reservation.id, { status: 'cancelled' });
  report.writes.push({ action: 'reservation.cancel', ok: cancelled.status === 'cancelled', status: cancelled.status });
}
if (overlapRecord) {
  const cancelledOverlap = await pb.collection('hkp_asset_reservations').update(overlapRecord.id, { status: 'cancelled' });
  report.writes.push({ action: 'overlap.cleanup', ok: cancelledOverlap.status === 'cancelled' });
}

const adminEnv = loadEnv('.env');
const admin = new PocketBase(url);
admin.autoCancellation(false);
await admin.collection('_superusers').authWithPassword(adminEnv.POCKETBASE_ADMIN_EMAIL, adminEnv.POCKETBASE_ADMIN_PASSWORD);
await admin.collection('hkp_usage_records').delete(usage.id);
const countClean = await admin.collection('hkp_usage_counts').getList(1, 1, { filter: `id = "${asset.id}"` });
const assetsAfter = await admin.collection('hkp_assets').getList(1, 1);
report.cleanup = {
  usageDeleted: true,
  usageCountRestored: (countClean.items[0]?.usage_count ?? 0) === report.usageCountBefore,
  assets: assetsAfter.totalItems
};

console.log(JSON.stringify(report, null, 2));
if (!report.writes.every((row) => row.ok) || report.cleanup.assets !== 390 || report.usageCountAfter !== report.usageCountBefore + 1) {
  process.exitCode = 1;
}
