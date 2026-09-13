import fs from 'node:fs';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnvFile('.env');
if (!process.env.POCKETBASE_ADMIN_EMAIL || !process.env.POCKETBASE_ADMIN_PASSWORD) loadEnvFile('.env.local');

const URL = 'https://db.keson.pro';
const ADMIN = '@request.auth.role = "admin" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users"';
const STAFF = '@request.auth.role != "" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users"';
const tokenMatch = 'public_token_hash != "" && public_token_hash = @request.headers.x_hkp_token';

async function main() {
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('缺少本機管理者登入設定');
  const PocketBase = (await import('pocketbase')).default;
  const pb = new PocketBase(URL);
  await pb.collection('_superusers').authWithPassword(email, password);

  async function collection(name) {
    try { return await pb.collections.getOne(name); } catch { return null; }
  }
  async function save(body) {
    const existing = await collection(body.name);
    if (existing) return pb.collections.update(existing.id, body);
    return pb.collections.create(body);
  }

  if (!(await collection('hkp_staff_users'))) {
    await pb.collections.create({
      name: 'hkp_staff_users',
      type: 'auth',
      fields: [
        { name: 'name', type: 'text', required: true, min: 2, max: 40 },
        { name: 'employee_number', type: 'text', required: true },
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['admin', 'staff'] },
        { name: 'department', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'active', type: 'bool' },
        { name: 'is_active', type: 'bool' },
        { name: 'last_login_at', type: 'date' }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_hkp_staff_employee ON hkp_staff_users (employee_number)'],
      passwordAuth: { enabled: true, identityFields: ['email'] },
      listRule: STAFF,
      viewRule: STAFF,
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: null
    });
    console.log('created hkp_staff_users');
  } else {
    console.log('hkp_staff_users exists');
  }

  const requestFields = [
    { name: 'request_number', type: 'text', required: true },
    { name: 'borrower_unit', type: 'text', required: true },
    { name: 'borrower_name', type: 'text', required: true },
    { name: 'borrower_phone', type: 'text', required: true },
    { name: 'asset', type: 'relation', required: true, collectionId: (await collection('hkp_assets')).id, maxSelect: 1 },
    { name: 'purpose', type: 'text' },
    { name: 'requested_at', type: 'date' },
    { name: 'expected_return_at', type: 'date' },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'borrowed', 'rejected', 'cancelled', 'return_pending', 'returned'] },
    { name: 'public_token_hash', type: 'text', required: true },
    { name: 'notes', type: 'text' },
    { name: 'checkout_condition', type: 'text' },
    { name: 'privacy_ack', type: 'bool' }
  ];

  await save({
    name: 'hkp_borrow_requests',
    type: 'base',
    fields: requestFields,
    indexes: ['CREATE UNIQUE INDEX idx_hkp_borrow_request_number ON hkp_borrow_requests (request_number)'],
    listRule: STAFF,
    viewRule: STAFF,
    createRule: '@request.body.status = "pending" && @request.body.public_token_hash != "" && @request.body.privacy_ack = true',
    updateRule: `${STAFF} || (${tokenMatch} && status = "pending" && @request.body.status = "cancelled")`,
    deleteRule: ADMIN
  });
  console.log('hkp_borrow_requests ready');

  await save({
    name: 'hkp_reservations_v2',
    type: 'base',
    fields: [
      { name: 'reservation_number', type: 'text', required: true },
      { name: 'borrower_unit', type: 'text', required: true },
      { name: 'borrower_name', type: 'text', required: true },
      { name: 'borrower_phone', type: 'text', required: true },
      { name: 'asset', type: 'relation', required: true, collectionId: (await collection('hkp_assets')).id, maxSelect: 1 },
      { name: 'start_at', type: 'date', required: true },
      { name: 'end_at', type: 'date', required: true },
      { name: 'purpose', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'approved', 'rejected', 'cancelled', 'converted', 'expired'] },
      { name: 'public_token_hash', type: 'text', required: true },
      { name: 'notes', type: 'text' },
      { name: 'privacy_ack', type: 'bool' },
      { name: 'rejection_reason', type: 'text' },
      { name: 'reviewed_at', type: 'date' }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_hkp_reservation_v2_number ON hkp_reservations_v2 (reservation_number)'],
    listRule: STAFF,
    viewRule: STAFF,
    createRule: '@request.body.status = "pending" && @request.body.public_token_hash != "" && @request.body.privacy_ack = true',
    updateRule: `${STAFF} || (${tokenMatch} && status = "pending" && @request.body.status = "cancelled")`,
    deleteRule: ADMIN
  });
  console.log('hkp_reservations_v2 ready');

  await save({
    name: 'hkp_return_requests',
    type: 'base',
    fields: [
      { name: 'borrow_request', type: 'relation', required: true, collectionId: (await collection('hkp_borrow_requests')).id, maxSelect: 1 },
      { name: 'request_number', type: 'text', required: true },
      { name: 'asset', type: 'relation', collectionId: (await collection('hkp_assets')).id, maxSelect: 1 },
      { name: 'borrower_name', type: 'text', required: true },
      { name: 'borrower_phone', type: 'text', required: true },
      { name: 'condition', type: 'text' },
      { name: 'notes', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'confirmed', 'rejected'] },
      { name: 'requested_at', type: 'date' }
    ],
    listRule: STAFF,
    viewRule: STAFF,
    createRule: '@request.body.status = "pending"',
    updateRule: STAFF,
    deleteRule: ADMIN
  });
  console.log('hkp_return_requests ready');

  if (!(await collection('hkp_assets_guest'))) {
    await pb.collections.create({
      name: 'hkp_assets_guest',
      type: 'view',
      listRule: '',
      viewRule: '',
      viewQuery: `SELECT id, property_id, name, location, availability_status, is_borrowable, is_active, photo FROM hkp_assets WHERE is_active = true`
    });
    console.log('created hkp_assets_guest');
  }

  const staffUsers = await collection('hkp_staff_users');
  await pb.collections.update(staffUsers.id, {
    listRule: `${ADMIN} || id = @request.auth.id`,
    viewRule: `${ADMIN} || id = @request.auth.id`,
    createRule: `${ADMIN} && @request.body.role = "staff"`,
    updateRule: `${ADMIN} && (@request.body.role:isset = false || @request.body.role = role) && (id != @request.auth.id || @request.body.active:isset = false)`,
    deleteRule: null
  });
  console.log('staff_users rules tightened');

  const reservations = await collection('hkp_reservations_v2');
  const extraReservation = ['rejection_reason', 'reviewed_by', 'reviewed_at'].filter((name) => !(reservations.fields || []).some((field) => field.name === name));
  if (extraReservation.length) {
    await pb.collections.update(reservations.id, {
      fields: [
        ...(reservations.fields || []),
        ...(extraReservation.includes('rejection_reason') ? [{ name: 'rejection_reason', type: 'text' }] : []),
        ...(extraReservation.includes('reviewed_at') ? [{ name: 'reviewed_at', type: 'date' }] : [])
      ]
    });
    console.log('reservation extra fields', extraReservation.join(','));
  }

  await save({
    name: 'hkp_borrow_records',
    type: 'base',
    fields: [
      { name: 'borrow_request', type: 'relation', collectionId: (await collection('hkp_borrow_requests')).id, maxSelect: 1 },
      { name: 'asset', type: 'relation', required: true, collectionId: (await collection('hkp_assets')).id, maxSelect: 1 },
      { name: 'borrower_unit', type: 'text' },
      { name: 'borrower_name', type: 'text' },
      { name: 'borrower_phone', type: 'text' },
      { name: 'purpose', type: 'text' },
      { name: 'borrowed_at', type: 'date' },
      { name: 'expected_return_at', type: 'date' },
      { name: 'returned_at', type: 'date' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['borrowed', 'return_pending', 'returned'] },
      { name: 'checkout_condition', type: 'text' },
      { name: 'return_condition', type: 'text' },
      { name: 'processed_by', type: 'relation', collectionId: (await collection('hkp_staff_users')).id, maxSelect: 1 },
      { name: 'returned_by', type: 'relation', collectionId: (await collection('hkp_staff_users')).id, maxSelect: 1 }
    ],
    listRule: STAFF,
    viewRule: STAFF,
    createRule: STAFF,
    updateRule: STAFF,
    deleteRule: ADMIN
  });
  console.log('hkp_borrow_records ready');

  if (!(await collection('hkp_reservation_public'))) {
    await pb.collections.create({
      name: 'hkp_reservation_public',
      type: 'view',
      listRule: '',
      viewRule: '',
      viewQuery: `SELECT id, asset, start_at, end_at, status FROM hkp_reservations_v2 WHERE status = 'pending' OR status = 'approved'`
    });
    console.log('created hkp_reservation_public');
  }
  if (!(await collection('hkp_borrow_slots'))) {
    await pb.collections.create({
      name: 'hkp_borrow_slots',
      type: 'view',
      listRule: '',
      viewRule: '',
      viewQuery: `SELECT id, asset, status, expected_return_at FROM hkp_borrow_requests WHERE status = 'pending' OR status = 'borrowed' OR status = 'return_pending'`
    });
    console.log('created hkp_borrow_slots');
  }

  const assets = await collection('hkp_assets');
  await pb.collections.update(assets.id, {
    createRule: ADMIN,
    deleteRule: ADMIN
  });
  const count = await pb.collection('hkp_assets').getList(1, 1);
  console.log('assets_untouched', count.totalItems);
  if (count.totalItems !== 390) throw new Error(`財產筆數異常：${count.totalItems}`);
  console.log('assets_id', assets.id);
}

main().catch((error) => {
  console.error(error?.response || error.message || error);
  process.exit(1);
});
