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
const names = [
  'hkp_usage_records',
  'hkp_asset_reservations',
  'hkp_assets_public',
  'hkp_usage_counts',
  'hkp_inventory_audits',
  'hkp_location_history',
  'hkp_operation_logs'
];
const cols = await pb.collections.getFullList();
for (const name of names) {
  const col = cols.find((item) => item.name === name);
  if (!col) {
    console.log(JSON.stringify({ name, missing: true }));
    continue;
  }
  console.log(JSON.stringify({
    name,
    type: col.type,
    fields: (col.fields || []).map((field) => field.name),
    listRule: col.listRule,
    viewRule: col.viewRule,
    createRule: col.createRule,
    updateRule: col.updateRule,
    deleteRule: col.deleteRule
  }));
}
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ assets: assets.totalItems }));
