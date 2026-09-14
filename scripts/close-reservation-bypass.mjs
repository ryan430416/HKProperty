/**
 * Close anonymous writes to hkp_reservations_v2.
 * Do not run until the lock-based frontend is deployed.
 * Running this earlier makes the current live “我要預借” button fail.
 */
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
const STAFF = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin")';
const reservations = await pb.collections.getOne('hkp_reservations_v2');
await pb.collections.update(reservations.id, { createRule: STAFF });
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ closed: true, assets: assets.totalItems }));
if (assets.totalItems !== 390) process.exitCode = 1;
