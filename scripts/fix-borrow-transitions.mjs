/**
 * Restrict staff borrow_request status transitions so returned records cannot reopen.
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
const cancelAnon = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && status = "pending" && @request.body.status = "cancelled"';
const returnAnon = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone && status = "borrowed" && @request.body.status = "return_pending"';
const staffTransition = `${STAFF} && (
  @request.body.status:isset = false
  || (status = "pending" && (@request.body.status = "borrowed" || @request.body.status = "rejected" || @request.body.status = "cancelled"))
  || (status = "borrowed" && @request.body.status = "return_pending")
  || (status = "return_pending" && @request.body.status = "returned")
)`;

const borrows = await pb.collections.getOne('hkp_borrow_requests');
await pb.collections.update(borrows.id, {
  updateRule: `(${staffTransition}) || (${cancelAnon}) || (${returnAnon})`
});

const assets = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ updated: true, assets: assets.totalItems }));
if (assets.totalItems !== 390) process.exitCode = 1;
