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
const hit = await pb.collection('hkp_assets').getList(1, 5, { filter: 'name = "不應寫入"' });
const total = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ renamed: hit.totalItems, assets: total.totalItems }));
