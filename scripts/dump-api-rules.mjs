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
const names = [
  'hkp_assets', 'hkp_assets_guest', 'hkp_staff_users', 'hkp_borrow_requests', 'hkp_borrow_verify',
  'hkp_borrow_records', 'hkp_borrow_slots', 'hkp_return_requests', 'hkp_reservations_v2',
  'hkp_reservation_public', 'hkp_time_locks', 'hkp_lock_public', 'hkp_lock_verify',
  'hkp_usage_records', 'hkp_operation_logs'
];
const rows = [];
for (const name of names) {
  try {
    const col = await pb.collections.getOne(name);
    rows.push({
      name,
      type: col.type,
      listRule: col.listRule,
      viewRule: col.viewRule,
      createRule: col.createRule,
      updateRule: col.updateRule,
      deleteRule: col.deleteRule,
      viewQuery: col.viewQuery || null
    });
  } catch (error) {
    rows.push({ name, error: error.message || String(error) });
  }
}
const assets = await pb.collection('hkp_assets').getList(1, 1);
const out = { assets: assets.totalItems, collections: rows };
fs.writeFileSync('docs/POCKETBASE_API_RULES.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ assets: assets.totalItems, collections: rows.length }));
