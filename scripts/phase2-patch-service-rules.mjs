/**
 * Allow role=service to read assets + write reservations/logs (minimal).
 * Does not grant admin powers. Additive rule update only.
 */
import fs from 'node:fs';
import PocketBase from 'pocketbase';

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

const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const pb = new PocketBase(process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const SERVICE = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "service"';
const STAFF = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin")';
const STAFF_OR_SERVICE = `@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin" || @request.auth.role = "service")`;

const assets = await pb.collections.getOne('hkp_assets');
await pb.collections.update(assets.id, {
  listRule: `(${STAFF}) || (${SERVICE})`,
  viewRule: `(${STAFF}) || (${SERVICE})`,
  updateRule: `(${STAFF}) || (${SERVICE} && @request.body.property_id:isset = false && @request.body.name:isset = false && @request.body.price:isset = false && @request.body.custodian:isset = false && @request.body.note:isset = false)`
});

const logs = await pb.collections.getOne('hkp_operation_logs');
await pb.collections.update(logs.id, {
  createRule: `(${logs.createRule || 'null'}) || (${SERVICE})`.replace('(null) || ', '')
});

const usage = await pb.collections.getOne('hkp_usage_records');
await pb.collections.update(usage.id, {
  createRule: `(${STAFF}) || (${SERVICE})`,
  listRule: STAFF,
  viewRule: STAFF
});

const reservations = await pb.collections.getOne('hkp_reservations');
await pb.collections.update(reservations.id, {
  listRule: STAFF_OR_SERVICE,
  viewRule: STAFF_OR_SERVICE,
  createRule: STAFF_OR_SERVICE,
  updateRule: STAFF_OR_SERVICE,
  deleteRule: '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "admin"'
});

console.log(JSON.stringify({
  ok: true,
  patched: ['hkp_assets', 'hkp_operation_logs', 'hkp_usage_records', 'hkp_reservations']
}, null, 2));
