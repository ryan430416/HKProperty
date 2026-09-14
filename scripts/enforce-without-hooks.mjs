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
const ADMIN = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "admin"';
const assets = await pb.collections.getOne('hkp_assets');

const borrows = await pb.collections.getOne('hkp_borrow_requests');
const available = '@request.body.asset.availability_status = "available"';
if (!String(borrows.createRule || '').includes('availability_status')) {
  await pb.collections.update(borrows.id, {
    createRule: `${borrows.createRule} && ${available}`
  });
}

let locks = null;
try { locks = await pb.collections.getOne('hkp_time_locks'); } catch { locks = null; }
if (!locks) {
  locks = await pb.collections.create({
    name: 'hkp_time_locks',
    type: 'base',
    fields: [
      { name: 'reservation_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionId: assets.id, maxSelect: 1 },
      { name: 'slot_start', type: 'text', required: true },
      { name: 'start_at', type: 'date', required: true },
      { name: 'end_at', type: 'date', required: true },
      { name: 'borrower_unit', type: 'text', required: true },
      { name: 'borrower_name', type: 'text', required: true },
      { name: 'borrower_name_hash', type: 'text', required: true },
      { name: 'borrower_phone', type: 'text', required: true },
      { name: 'purpose', type: 'text' },
      { name: 'notes', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'approved', 'rejected', 'cancelled'] },
      { name: 'public_token_hash', type: 'text', required: true },
      { name: 'privacy_ack', type: 'bool' }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_hkp_time_lock_slot ON hkp_time_locks (asset, slot_start)'],
    listRule: STAFF,
    viewRule: STAFF,
    createRule: '@request.body.status = "pending" && @request.body.public_token_hash != "" && @request.body.privacy_ack = true && @request.body.borrower_name_hash != ""',
    updateRule: `${STAFF} || (public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone && status = "pending" && @request.body.status = "cancelled")`,
    deleteRule: ADMIN
  });
}

const locksNow = await pb.collections.getOne('hkp_time_locks');
const cancelMatch = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone && status = "pending" && @request.body.status = "cancelled"';
const nextUpdate = `${STAFF} || (${cancelMatch})`;
if (locksNow.updateRule !== nextUpdate) {
  await pb.collections.update(locksNow.id, { updateRule: nextUpdate });
}

let lockVerify = null;
try { lockVerify = await pb.collections.getOne('hkp_lock_verify'); } catch { lockVerify = null; }
if (!lockVerify) {
  await pb.collections.create({
    name: 'hkp_lock_verify',
    type: 'view',
    listRule: 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone',
    viewRule: 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token && borrower_name_hash = @request.headers.x_hkp_name && borrower_phone = @request.headers.x_hkp_phone',
    viewQuery: `SELECT id, reservation_number, status, public_token_hash, borrower_name_hash, borrower_phone FROM hkp_time_locks WHERE status = 'pending' OR status = 'approved'`
  });
}

let lockPublic = null;
try { lockPublic = await pb.collections.getOne('hkp_lock_public'); } catch { lockPublic = null; }
if (!lockPublic) {
  await pb.collections.create({
    name: 'hkp_lock_public',
    type: 'view',
    listRule: '',
    viewRule: '',
    viewQuery: `SELECT id, asset, slot_start, status FROM hkp_time_locks WHERE status = 'pending' OR status = 'approved'`
  });
}

const count = await pb.collection('hkp_assets').getList(1, 1);
console.log(JSON.stringify({ assets: count.totalItems, locks: Boolean(locks.id) }));
if (count.totalItems !== 390) process.exitCode = 1;
