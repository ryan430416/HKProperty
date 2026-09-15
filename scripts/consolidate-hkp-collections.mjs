/**
 * Safely remove empty legacy hkp_* collections that the new borrow flow replaced.
 * Never deletes hkp_assets records. Aborts if any target has data or assets != 390.
 */
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

const env = readEnv('.env');
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const KEEP = new Set([
  'hkp_assets',
  'hkp_assets_guest',
  'hkp_staff_users',
  'hkp_users',
  'hkp_borrow_requests',
  'hkp_borrow_records',
  'hkp_borrow_verify',
  'hkp_borrow_slots',
  'hkp_time_locks',
  'hkp_lock_public',
  'hkp_lock_verify',
  'hkp_usage_records',
  'hkp_usage_counts',
  'hkp_operation_logs',
  'hkp_system_settings',
  'hkp_inventory_audits',
  'hkp_location_history',
  'hkp_loan_records'
]);

// Empty legacy / duplicate targets only
const REMOVE = [
  'hkp_reservation_public',
  'hkp_reservation_slots',
  'hkp_reservations_v2',
  'hkp_asset_reservations',
  'hkp_return_requests',
  'hkp_assets_public'
];

const assets = await pb.collection('hkp_assets').getList(1, 1);
if (assets.totalItems !== 390) {
  console.error(JSON.stringify({ error: 'asset_count_changed', assets: assets.totalItems }));
  process.exit(1);
}

const report = { removed: [], skipped: [], assets: assets.totalItems };

for (const name of REMOVE) {
  if (KEEP.has(name)) {
    report.skipped.push({ name, reason: 'keep_list' });
    continue;
  }
  let col;
  try {
    col = await pb.collections.getOne(name);
  } catch {
    report.skipped.push({ name, reason: 'missing' });
    continue;
  }
  const rows = await pb.collection(name).getList(1, 1).catch(() => ({ totalItems: -1 }));
  const isView = String(col.type || '') === 'view';
  if (!isView && rows.totalItems !== 0) {
    report.skipped.push({ name, reason: `has_data:${rows.totalItems}` });
    continue;
  }
  await pb.collections.delete(col.id);
  report.removed.push(isView ? `${name} (view)` : name);
}

const afterAssets = await pb.collection('hkp_assets').getList(1, 1);
const left = (await pb.collections.getFullList())
  .filter((c) => String(c.name).startsWith('hkp_'))
  .map((c) => c.name)
  .sort();
report.assets_after = afterAssets.totalItems;
report.hkp_count = left.length;
report.hkp_names = left;
console.log(JSON.stringify(report, null, 2));
if (afterAssets.totalItems !== 390) process.exitCode = 1;
