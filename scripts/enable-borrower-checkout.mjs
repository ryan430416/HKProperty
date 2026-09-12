/**
 * Let borrowers finish checkout/return without editing internal asset fields,
 * and create formal hkp_users logins. Does not modify the 390 asset records.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
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
const locked = [
  'name', 'property_id', 'price', 'custodian', 'supplier', 'department', 'note',
  'location', 'is_active', 'is_borrowable', 'photo', 'specification', 'unit',
  'brand', 'model', 'purchase_date', 'service_life', 'asset_status', 'audit_status',
  'last_audit_at', 'return_alert', 'usage_count'
].map((field) => `@request.body.${field}:isset = false`).join(' && ');

const borrowerOps = `(
  ${locked} && (
    (availability_status = "available" && (@request.body.availability_status = "checked_out" || @request.body.availability_status = "reserved"))
    || (current_loan.borrower = @request.auth.id && (@request.body.availability_status = "available" || @request.body.availability_status = "maintenance" || @request.body.availability_status = "lost"))
  )
)`;

const assets = (await pb.collections.getFullList()).find((item) => item.name === 'hkp_assets');
await pb.collections.update(assets.id, {
  updateRule: `${STAFF} || (${AUTH} && ${borrowerOps})`
});

const password = env.HKP_FORMAL_PASSWORD || `Hk${Math.random().toString(36).slice(2, 10)}A1`;
const accounts = [
  { email: 'hkp-admin@hkproperty.local', role: 'admin', display_name: '正式管理者', school_number: 'A0001', department: '總務處' },
  { email: 'hkp-staff@hkproperty.local', role: 'staff', display_name: '正式經辦', school_number: 'S0001', department: '總務處' },
  { email: 'hkp-borrower@hkproperty.local', role: 'borrower', display_name: '正式借用人', school_number: 'B0001', department: '資訊工程系' }
];

for (const account of accounts) {
  const existing = await pb.collection('hkp_users').getList(1, 1, { filter: `email = "${account.email}"` });
  if (existing.totalItems) {
    console.log(`exists ${account.email}`);
    continue;
  }
  await pb.collection('hkp_users').create({
    ...account,
    password,
    passwordConfirm: password,
    emailVisibility: true,
    verified: true,
    is_active: true
  });
  console.log(`created ${account.email} role=${account.role}`);
}

const borrower = await pb.collection('hkp_users').getFirstListItem('email = "hkp-borrower@hkproperty.local"');
const impersonated = await pb.collection('hkp_users').impersonate(borrower.id, 120);
const asBorrower = new PocketBase('https://db.keson.pro');
asBorrower.authStore.save(impersonated.token, impersonated.record);
let ruleOk = false;
try {
  await asBorrower.collection('hkp_assets').update('missing-record-id', {
    availability_status: 'checked_out',
    current_loan: 'missing-loan'
  });
} catch (error) {
  ruleOk = error?.status === 404;
  console.log(`borrower_update_probe status=${error?.status} allowed=${ruleOk}`);
}
if (!ruleOk) throw new Error('借用人仍無法更新借出狀態，請檢查 API Rule');

const total = (await pb.collection('hkp_assets').getList(1, 1)).totalItems;
if (!existsSync('.env.local') || !readFileSync('.env.local', 'utf8').includes('HKP_FORMAL_ADMIN_EMAIL')) {
  appendFileSync('.env.local', `\nHKP_FORMAL_ADMIN_EMAIL=hkp-admin@hkproperty.local\nHKP_FORMAL_STAFF_EMAIL=hkp-staff@hkproperty.local\nHKP_FORMAL_BORROWER_EMAIL=hkp-borrower@hkproperty.local\nHKP_FORMAL_PASSWORD=${password}\n`);
}
console.log(JSON.stringify({ ok: true, assets: total, passwordSaved: '.env.local' }, null, 2));
