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
const root = new PocketBase('https://db.keson.pro');
const anon = new PocketBase('https://db.keson.pro');
await root.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const guest = await anon.collection('hkp_assets_guest').getList(1, 1, { filter: 'is_borrowable = true' });
const start = new Date(Date.now() + 86400000).toISOString();
const end = new Date(Date.now() + 2 * 86400000).toISOString();
const payload = {
  borrower_unit: '驗證單位',
  borrower_name: '驗證姓名',
  borrower_phone: '0912000111',
  asset: guest.items[0].id,
  start_at: start,
  end_at: end,
  purpose: '重疊驗證',
  status: 'pending',
  public_token_hash: '1'.repeat(64),
  privacy_ack: true
};
const first = await anon.collection('hkp_reservations_v2').create({ ...payload, reservation_number: `RV-A-${Date.now().toString(36)}` });
const slots = await anon.collection('hkp_reservation_public').getFullList({ filter: `asset = "${guest.items[0].id}"` });
const second = await anon.collection('hkp_reservations_v2').create({ ...payload, reservation_number: `RV-B-${Date.now().toString(36)}` }).then(() => 'created').catch((error) => error.status);
await root.collection('hkp_reservations_v2').delete(first.id);
if (second === 'created') {
  const rows = await root.collection('hkp_reservations_v2').getFullList({ filter: 'purpose = "重疊驗證"' });
  for (const row of rows) await root.collection('hkp_reservations_v2').delete(row.id);
}
const assets = await root.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ slots: slots.length, second, assets: assets.totalItems }));
