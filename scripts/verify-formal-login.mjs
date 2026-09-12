import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

const env = {};
for (const file of ['.env.local']) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}
const pb = new PocketBase('https://db.keson.pro');
pb.autoCancellation(false);
const auth = await pb.collection('hkp_users').authWithPassword(env.HKP_FORMAL_ADMIN_EMAIL, env.HKP_FORMAL_PASSWORD);
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({
  ok: true,
  email: auth.record.email,
  role: auth.record.role,
  assets: assets.totalItems
}, null, 2));
