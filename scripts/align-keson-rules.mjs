import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}
const pb = new PocketBase('https://db.keson.pro');
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const STAFF = '@request.auth.id != "" && @request.auth.collectionName = "hkp_users" && (@request.auth.role = "staff" || @request.auth.role = "admin")';
const col = (await pb.collections.getFullList()).find((item) => item.name === 'hkp_assets');
await pb.collections.update(col.id, { listRule: STAFF, viewRule: STAFF });
const total = (await pb.collection('hkp_assets').getList(1, 1)).totalItems;
const pub = (await pb.collection('hkp_assets_public').getList(1, 1)).totalItems;
console.log(JSON.stringify({ ok: true, assets: total, publicView: pub }, null, 2));
