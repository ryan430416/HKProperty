import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const index = trimmed.indexOf('=');
  env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const col = await pb.collections.getOne('hkp_usage_records');
const admin = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "admin"';
if (!String(col.deleteRule || '').includes('hkp_staff_users')) {
  await pb.collections.update(col.id, { deleteRule: col.deleteRule ? `(${col.deleteRule}) || (${admin})` : admin });
}
const total = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ assets: total.totalItems, delete_extended: true }));
