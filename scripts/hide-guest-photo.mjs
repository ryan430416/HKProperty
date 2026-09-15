/**
 * Stop exposing photo in the public guest view.
 * Does not delete the hkp_assets.photo field or uploaded files.
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
const guest = await pb.collections.getOne('hkp_assets_guest');
await pb.collections.update(guest.id, {
  viewQuery: `SELECT id, property_id, name, location, availability_status, is_borrowable, is_active FROM hkp_assets WHERE is_active = true`
});
const assets = await pb.collection('hkp_assets').getList(1, 1);
const sample = await pb.collection('hkp_assets_guest').getList(1, 1);
console.log(JSON.stringify({
  assets: assets.totalItems,
  guest_keys: Object.keys(sample.items[0] || {}).sort(),
  has_photo: Object.prototype.hasOwnProperty.call(sample.items[0] || {}, 'photo')
}));
if (assets.totalItems !== 390) process.exitCode = 1;
