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

const borrows = await pb.collections.getOne('hkp_borrow_requests');
if (!(borrows.fields || []).some((field) => field.name === 'borrower_name_hash')) {
  await pb.collections.update(borrows.id, {
    fields: [...(borrows.fields || []), { name: 'borrower_name_hash', type: 'text' }]
  });
}
const fresh = await pb.collections.getOne('hkp_borrow_requests');
const match = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone';
const kept = String(fresh.updateRule || '')
  .replace(/\s*\|\|\s*\(public_token_hash != "" && public_token_hash = @request\.headers\.x_hkp_token && borrower_name = @request\.headers\.x_hkp_name && borrower_phone = @request\.headers\.x_hkp_phone && status = "borrowed" && @request\.body\.status = "return_pending"\)/, '');
await pb.collections.update(fresh.id, {
  updateRule: `${kept} || (${match} && status = "borrowed" && @request.body.status = "return_pending")`
});

const view = await pb.collections.getOne('hkp_borrow_verify');
await pb.collections.update(view.id, {
  listRule: match,
  viewRule: match,
  viewQuery: `SELECT id, request_number, status, asset, public_token_hash, borrower_name_hash, borrower_phone FROM hkp_borrow_requests WHERE status = 'borrowed' OR status = 'return_pending'`
});

const leftovers = await pb.collection('hkp_borrow_requests').getFullList({ filter: 'purpose = "歸還驗證"' });
for (const row of leftovers) {
  const returns = await pb.collection('hkp_return_requests').getFullList({ filter: `borrow_request = "${row.id}"` });
  for (const item of returns) await pb.collection('hkp_return_requests').delete(item.id);
  await pb.collection('hkp_borrow_requests').delete(row.id);
}
const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ assets: assets.totalItems, leftovers: leftovers.length, name_hash: true }));
if (assets.totalItems !== 390) process.exitCode = 1;
