/**
 * Tighten write rules and add usage identity fields.
 * Does not update or delete hkp_assets records.
 */
import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}

const pb = new PocketBase('https://db.keson.pro');
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const AUTH = '@request.auth.id != "" && @request.auth.collectionName = "hkp_users"';
const STAFF = `${AUTH} && (@request.auth.role = "staff" || @request.auth.role = "admin")`;
const ADMIN = `${AUTH} && @request.auth.role = "admin"`;

const cols = await pb.collections.getFullList();
const byName = Object.fromEntries(cols.map((item) => [item.name, item]));
const before = await pb.collection('hkp_assets').getList(1, 1);
console.log(`assets_before=${before.totalItems}`);

const usage = byName.hkp_usage_records;
const usersId = byName.hkp_users.id;
const fields = [...(usage.fields || [])];
function ensureField(field) {
  if (!fields.some((item) => item.name === field.name)) fields.push(field);
}
ensureField({ name: 'property_id', type: 'text' });
ensureField({ name: 'property_name', type: 'text' });
ensureField({ name: 'user', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false });
await pb.collections.update(usage.id, {
  fields,
  createRule: `${AUTH} && @request.body.created_by = @request.auth.id`,
  updateRule: STAFF,
  deleteRule: ADMIN
});
console.log('updated hkp_usage_records fields and create rule');

const reservations = byName.hkp_asset_reservations;
const borrowerCancel = [
  'user = @request.auth.id',
  'status = "pending"',
  '@request.body.status = "cancelled"',
  '@request.body.user:isset = false',
  '@request.body.asset:isset = false',
  '@request.body.purpose:isset = false',
  '@request.body.start_at:isset = false',
  '@request.body.end_at:isset = false',
  '@request.body.approved_by:isset = false',
  '@request.body.approved_at:isset = false',
  '@request.body.reservation_number:isset = false',
  '@request.body.property_id:isset = false',
  '@request.body.property_name:isset = false',
  '@request.body.user_name:isset = false',
  '@request.body.converted_loan:isset = false'
].join(' && ');
await pb.collections.update(reservations.id, {
  createRule: `${AUTH} && @request.body.user = @request.auth.id && @request.body.status = "pending"`,
  updateRule: `${STAFF} || (${AUTH} && ${borrowerCancel})`,
  deleteRule: ADMIN
});
console.log('tightened hkp_asset_reservations rules');

const loans = byName.hkp_loan_records;
const borrowerReturn = [
  'borrower = @request.auth.id',
  '(status = "checked_out" || status = "overdue")',
  '@request.body.status = "returned"',
  '@request.body.borrower:isset = false',
  '@request.body.asset:isset = false',
  '@request.body.loan_number:isset = false',
  '@request.body.approved_by:isset = false',
  '@request.body.approved_at:isset = false',
  '@request.body.purpose:isset = false',
  '@request.body.expected_return_at:isset = false',
  '@request.body.checkout_at:isset = false',
  '@request.body.property_id:isset = false',
  '@request.body.property_name:isset = false',
  '@request.body.borrower_name:isset = false',
  '@request.body.borrower_number:isset = false',
  '@request.body.borrower_department:isset = false'
].join(' && ');
await pb.collections.update(loans.id, {
  createRule: `${STAFF} || (${AUTH} && @request.body.borrower = @request.auth.id)`,
  updateRule: `${STAFF} || (${AUTH} && ${borrowerReturn})`,
  deleteRule: ADMIN
});
console.log('tightened hkp_loan_records rules');

const users = byName.hkp_users;
await pb.collections.update(users.id, {
  createRule: `@request.body.role = "borrower" || (${ADMIN})`,
  updateRule: `${ADMIN} || (@request.auth.id = id && @request.body.role:isset = false && @request.body.is_active:isset = false && @request.body.email:isset = false && @request.body.verified:isset = false)`,
  deleteRule: ADMIN
});
console.log('tightened hkp_users create/update rules');

if (!byName.hkp_reservation_slots) {
  await pb.collections.create({
    name: 'hkp_reservation_slots',
    type: 'view',
    listRule: AUTH,
    viewRule: AUTH,
    viewQuery: 'SELECT id, asset, start_at, end_at, status FROM hkp_asset_reservations'
  });
  console.log('created hkp_reservation_slots');
} else {
  console.log('hkp_reservation_slots exists');
}

const after = await pb.collection('hkp_assets').getList(1, 1);
if (after.totalItems !== before.totalItems) {
  throw new Error(`hkp_assets count changed ${before.totalItems} -> ${after.totalItems}`);
}
console.log(JSON.stringify({ ok: true, assets: after.totalItems }, null, 2));
