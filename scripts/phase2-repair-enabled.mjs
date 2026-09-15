/**
 * One-time additive repair: Phase-2 bool field `enabled` defaulted to false for all assets.
 * Sets enabled=true for active, non-deleted assets. Does not delete or change property_id.
 */
import PocketBase from 'pocketbase';
import fs from 'node:fs';

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = { ...readEnv('.env'), ...readEnv('.env.service.local') };
const pb = new PocketBase(env.POCKETBASE_URL || env.VITE_POCKETBASE_URL);
await pb.collection('hkp_staff_users').authWithPassword(env.POCKETBASE_SERVICE_EMAIL, env.POCKETBASE_SERVICE_PASSWORD);

let updated = 0;
for (;;) {
  const list = await pb.collection('hkp_assets').getList(1, 100, {
    filter: 'enabled = false && is_active = true && (deleted_at = "" || deleted_at = null)',
    fields: 'id,enabled,property_id'
  });
  if (!list.items.length) break;
  for (const row of list.items) {
    await pb.collection('hkp_assets').update(row.id, { enabled: true });
    updated += 1;
  }
}

const check = await pb.collection('hkp_assets').getList(1, 1, {
  filter: 'enabled = true && is_active = true && availability_status = "available" && is_borrowable = true && (deleted_at = "" || deleted_at = null)'
});
console.log(JSON.stringify({ updated, availableNow: check.totalItems }, null, 2));
