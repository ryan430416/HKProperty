import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const index = trimmed.indexOf('=');
  env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const STAFF = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin")';
const ADMIN = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "admin"';
const staffAssetUpdate = `${STAFF} && @request.body.name:isset = false && @request.body.property_id:isset = false && @request.body.price:isset = false && @request.body.custodian:isset = false && @request.body.supplier:isset = false && @request.body.department:isset = false && @request.body.note:isset = false && @request.body.location:isset = false && @request.body.is_active:isset = false && @request.body.is_borrowable:isset = false && @request.body.photo:isset = false && @request.body.specification:isset = false && @request.body.unit:isset = false && @request.body.brand:isset = false && @request.body.model:isset = false && @request.body.purchase_date:isset = false && @request.body.service_life:isset = false && @request.body.asset_status:isset = false && @request.body.audit_status:isset = false && @request.body.last_audit_at:isset = false && @request.body.return_alert:isset = false && @request.body.usage_count:isset = false`;

async function extend(name, patch) {
  const col = await pb.collections.getOne(name);
  const next = {};
  for (const key of Object.keys(patch)) {
    next[key] = col[key] ? `(${col[key]}) || (${patch[key]})` : patch[key];
  }
  await pb.collections.update(col.id, next);
}

await extend('hkp_assets', {
  listRule: STAFF,
  viewRule: STAFF,
  updateRule: `${ADMIN} || (${staffAssetUpdate})`
});
await extend('hkp_usage_records', {
  listRule: STAFF,
  viewRule: STAFF,
  createRule: `${STAFF} && @request.body.created_by:isset = false && @request.body.user:isset = false`
});
await extend('hkp_operation_logs', {
  listRule: ADMIN,
  viewRule: ADMIN,
  createRule: STAFF
});

const count = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ assets: count.totalItems }));
if (count.totalItems !== 390) throw new Error('asset count changed');
