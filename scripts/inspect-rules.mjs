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
const names = ['hkp_assets', 'hkp_assets_guest', 'hkp_borrow_requests', 'hkp_staff_users', 'hkp_usage_records'];
for (const name of names) {
  const col = await pb.collections.getOne(name);
  console.log(JSON.stringify({
    name,
    listRule: col.listRule,
    viewRule: col.viewRule,
    createRule: col.createRule,
    updateRule: col.updateRule,
    deleteRule: col.deleteRule
  }));
}
const count = await pb.collection('hkp_assets').getList(1, 1);
console.log('assets', count.totalItems);
