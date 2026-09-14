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
const borrows = await pb.collection('hkp_borrow_requests').getFullList({ filter: 'purpose = "缺口驗證" || purpose = "不該直接借出"' });
let removedReturns = 0;
let removedBorrows = 0;
for (const row of borrows) {
  const returns = await pb.collection('hkp_return_requests').getFullList({ filter: `borrow_request = "${row.id}"` });
  for (const item of returns) {
    await pb.collection('hkp_return_requests').delete(item.id);
    removedReturns += 1;
  }
  await pb.collection('hkp_borrow_requests').delete(row.id);
  removedBorrows += 1;
}
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ removedReturns, removedBorrows, assets: assets.totalItems }));
