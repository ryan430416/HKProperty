/**
 * Align shared db.keson.pro schema for HKProperty without modifying hkp_assets records.
 * Usage: node scripts/align-keson.mjs
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
const assetsId = byName.hkp_assets?.id;
const usersId = byName.hkp_users?.id;
const loansId = byName.hkp_loan_records?.id;
if (!assetsId || !usersId) throw new Error('缺少 hkp_assets 或 hkp_users');

const before = await pb.collection('hkp_assets').getList(1, 1);
console.log(`assets_before=${before.totalItems}`);

const usage = byName.hkp_usage_records;
const usageFields = usage.fields || [];
if (!usageFields.some((field) => field.name === 'user_number')) {
  usageFields.push({ name: 'user_number', type: 'text' });
  await pb.collections.update(usage.id, {
    fields: usageFields,
    createRule: AUTH,
    listRule: `${STAFF} || created_by = @request.auth.id`,
    viewRule: `${STAFF} || created_by = @request.auth.id`,
    updateRule: STAFF
  });
  console.log('added hkp_usage_records.user_number and opened createRule');
} else {
  await pb.collections.update(usage.id, {
    createRule: AUTH,
    listRule: `${STAFF} || created_by = @request.auth.id`,
    viewRule: `${STAFF} || created_by = @request.auth.id`,
    updateRule: STAFF
  });
  console.log('updated hkp_usage_records rules');
}

if (!byName.hkp_asset_reservations) {
  await pb.collections.create({
    name: 'hkp_asset_reservations',
    type: 'base',
    listRule: `${STAFF} || user = @request.auth.id`,
    viewRule: `${STAFF} || user = @request.auth.id`,
    createRule: AUTH,
    updateRule: `${STAFF} || user = @request.auth.id`,
    deleteRule: ADMIN,
    fields: [
      { name: 'reservation_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1 },
      { name: 'user', type: 'relation', required: true, collectionId: usersId, maxSelect: 1 },
      { name: 'user_name', type: 'text' },
      { name: 'purpose', type: 'text', required: true },
      { name: 'start_at', type: 'date', required: true },
      { name: 'end_at', type: 'date', required: true },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'approved', 'rejected', 'cancelled', 'converted', 'expired'] },
      { name: 'approved_by', type: 'relation', collectionId: usersId, maxSelect: 1 },
      { name: 'approved_at', type: 'date' },
      { name: 'rejection_reason', type: 'text' },
      ...(loansId ? [{ name: 'converted_loan', type: 'relation', collectionId: loansId, maxSelect: 1 }] : []),
      { name: 'contact', type: 'text' },
      { name: 'note', type: 'text' },
      { name: 'property_id', type: 'text' },
      { name: 'property_name', type: 'text' }
    ]
  });
  console.log('created hkp_asset_reservations');
} else {
  console.log('hkp_asset_reservations exists');
}

const refreshed = await pb.collections.getFullList();
if (!refreshed.some((item) => item.name === 'hkp_assets_public')) {
  await pb.collections.create({
    name: 'hkp_assets_public',
    type: 'view',
    listRule: AUTH,
    viewRule: AUTH,
    viewQuery: `SELECT id, property_id, name, location, specification, unit, availability_status, usage_count, is_borrowable, is_active, asset_status, brand, model, photo, audit_status FROM hkp_assets`
  });
  console.log('created hkp_assets_public');
}

if (!refreshed.some((item) => item.name === 'hkp_usage_counts')) {
  await pb.collections.create({
    name: 'hkp_usage_counts',
    type: 'view',
    listRule: AUTH,
    viewRule: AUTH,
    viewQuery: 'SELECT asset as id, COUNT(id) as usage_count FROM hkp_usage_records GROUP BY asset'
  });
  console.log('created hkp_usage_counts');
}

const after = await pb.collection('hkp_assets').getList(1, 1);
if (after.totalItems !== before.totalItems) {
  throw new Error(`hkp_assets count changed ${before.totalItems} -> ${after.totalItems}`);
}
console.log(JSON.stringify({ ok: true, assets: after.totalItems }, null, 2));
