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
const usage = await pb.collection('hkp_usage_records').getFullList({ filter: 'note = "驗證後刪除" || purpose = "借出驗證"' });
for (const row of usage) await pb.collection('hkp_usage_records').delete(row.id);
const records = await pb.collection('hkp_borrow_records').getFullList({ filter: 'purpose = "借出驗證"' });
for (const row of records) await pb.collection('hkp_borrow_records').delete(row.id);
const borrows = await pb.collection('hkp_borrow_requests').getFullList({ filter: 'purpose = "借出驗證"' });
for (const row of borrows) await pb.collection('hkp_borrow_requests').delete(row.id);
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ usage: usage.length, records: records.length, borrows: borrows.length, assets: assets.totalItems }));
