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
const cols = await pb.collections.getFullList();
for (const name of ['hkp_users', 'hkp_assets', 'hkp_loan_records', 'hkp_usage_records', 'hkp_system_settings']) {
  const col = cols.find((item) => item.name === name);
  console.log(JSON.stringify({
    name,
    listRule: col?.listRule,
    viewRule: col?.viewRule,
    createRule: col?.createRule,
    updateRule: col?.updateRule,
    deleteRule: col?.deleteRule
  }));
}
