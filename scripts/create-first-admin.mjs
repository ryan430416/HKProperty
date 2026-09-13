import fs from 'node:fs';

function load(file, overwrite) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    if (!overwrite && process.env[key]) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
load('.env', true);
const formal = {};
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    formal[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
}

const URL = 'https://db.keson.pro';

async function ensureUser(pb, { email, password, role, name, employeeNumber }) {
  const existing = await pb.collection('hkp_staff_users').getList(1, 1, { filter: `email = "${email}"` });
  if (existing.totalItems) return 'exists';
  await pb.collection('hkp_staff_users').create({
    email,
    password,
    passwordConfirm: password,
    emailVisibility: false,
    name,
    employee_number: employeeNumber,
    role,
    department: '財產管理',
    active: true,
    is_active: true
  });
  return 'created';
}

async function main() {
  const PocketBase = (await import('pocketbase')).default;
  const pb = new PocketBase(URL);
  await pb.collection('_superusers').authWithPassword(process.env.POCKETBASE_ADMIN_EMAIL, process.env.POCKETBASE_ADMIN_PASSWORD);
  const admin = await ensureUser(pb, {
    email: formal.HKP_FORMAL_ADMIN_EMAIL,
    password: formal.HKP_FORMAL_PASSWORD,
    role: 'admin',
    name: '系統管理員',
    employeeNumber: 'ADMIN-001'
  });
  const staff = await ensureUser(pb, {
    email: formal.HKP_FORMAL_STAFF_EMAIL,
    password: formal.HKP_FORMAL_PASSWORD,
    role: 'staff',
    name: '經辦人員',
    employeeNumber: 'STAFF-001'
  });
  const count = await pb.collection('hkp_assets').getList(1, 1);
  console.log(JSON.stringify({ admin, staff, assets: count.totalItems }));
}

main().catch((error) => {
  console.error(error?.message || 'setup failed');
  process.exit(1);
});
