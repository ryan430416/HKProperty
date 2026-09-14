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
const match = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone';

const staff = await pb.collections.getOne('hkp_staff_users');
if (!(staff.fields || []).some((field) => field.name === 'created_by')) {
  await pb.collections.update(staff.id, {
    fields: [
      ...(staff.fields || []),
      { name: 'created_by', type: 'relation', collectionId: staff.id, maxSelect: 1 }
    ]
  });
}

const returns = await pb.collections.getOne('hkp_return_requests');
await pb.collections.update(returns.id, { createRule: STAFF });

const borrows = await pb.collections.getOne('hkp_borrow_requests');
const returnTransition = `(${match} && status = "borrowed" && @request.body.status = "return_pending")`;
if (!String(borrows.updateRule || '').includes('return_pending')) {
  await pb.collections.update(borrows.id, {
    updateRule: borrows.updateRule ? `(${borrows.updateRule}) || ${returnTransition}` : returnTransition
  });
}

let verify = null;
try { verify = await pb.collections.getOne('hkp_borrow_verify'); } catch { verify = null; }
if (!verify) {
  verify = await pb.collections.create({
    name: 'hkp_borrow_verify',
    type: 'view',
    listRule: match,
    viewRule: match,
    viewQuery: `SELECT id, request_number, status, asset, public_token_hash, borrower_name, borrower_phone FROM hkp_borrow_requests WHERE status = 'borrowed' OR status = 'return_pending'`
  });
}

const assets = await pb.collection('hkp_assets').getList(1, 1);
const staffAfter = await pb.collections.getOne('hkp_staff_users');
console.log(JSON.stringify({
  assets: assets.totalItems,
  created_by: (staffAfter.fields || []).some((field) => field.name === 'created_by'),
  return_create_staff_only: true,
  verify: verify.name
}));
if (assets.totalItems !== 390) process.exitCode = 1;
