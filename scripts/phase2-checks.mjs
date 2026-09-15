/**
 * Phase-2 read-only checks: current_loan + hkp_users vs hkp_staff_users.
 * Never logs passwords/tokens. Never mutates data.
 */
import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const i = trimmed.indexOf('=');
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at < 1) return '***';
  const user = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}***@${domain}`;
}

const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const url = process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro';
const pb = new PocketBase(url);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const outDir = path.join('docs', 'exports', 'phase2');
fs.mkdirSync(outDir, { recursive: true });

const assets = await pb.collection('hkp_assets').getFullList({
  fields: 'id,property_id,availability_status,current_loan',
  sort: 'property_id'
});
const loans = await pb.collection('hkp_loan_records').getFullList({ fields: 'id' }).catch(() => []);
const loanIds = new Set(loans.map((r) => r.id));

let currentLoanNonEmpty = 0;
let currentLoanValid = 0;
let currentLoanOrphan = 0;
const checkedOutish = [];
for (const row of assets) {
  const loan = row.current_loan ? String(row.current_loan) : '';
  if (loan) {
    currentLoanNonEmpty += 1;
    if (loanIds.has(loan)) currentLoanValid += 1;
    else currentLoanOrphan += 1;
  }
  if (['checked_out', 'overdue', 'reserved', 'pending'].includes(String(row.availability_status || ''))) {
    checkedOutish.push({ id: row.id, property_id: row.property_id, availability_status: row.availability_status, current_loan: loan || null });
  }
}

const currentLoanReport = {
  exportedAt: new Date().toISOString(),
  assetsTotal: assets.length,
  loanRecordsTotal: loans.length,
  currentLoanNonEmpty,
  currentLoanValid,
  currentLoanOrphan,
  assetsWithBusyAvailability: checkedOutish.length,
  busySample: checkedOutish.slice(0, 20),
  safeToClearCurrentLoanLater:
    loans.length === 0 && currentLoanValid === 0 && checkedOutish.length === 0
};

const users = await pb.collection('hkp_users').getFullList({
  fields: 'id,email,display_name,name,role,is_active,active,created,updated,last_login_at'
}).catch(() => []);
const staff = await pb.collection('hkp_staff_users').getFullList({
  fields: 'id,email,name,role,active,is_active,last_login_at,created,updated'
});

const staffByEmail = new Map(staff.map((s) => [String(s.email || '').toLowerCase(), s]));

const accountMap = users.map((u) => {
  const email = String(u.email || '').toLowerCase();
  const dup = staffByEmail.get(email) || null;
  const active = u.active !== false && u.is_active !== false;
  let recommendation = 'retain_in_hkp_users_stop_using';
  if (dup) recommendation = 'do_not_migrate_duplicate_exists_in_staff';
  else if (u.role === 'admin' || u.role === 'staff') recommendation = 'review_manual_migrate_if_still_needed';
  else if (u.role === 'borrower') recommendation = 'retain_unused_public_no_login';
  return {
    recordId: u.id,
    displayName: u.display_name || u.name || '',
    emailMasked: maskEmail(u.email),
    role: u.role || '',
    active,
    duplicateInStaffUsers: !!dup,
    staffRecordId: dup?.id || null,
    staffRole: dup?.role || null,
    lastLoginAt: u.last_login_at || null,
    updated: u.updated || null,
    recommendation
  };
});

const usersReport = {
  exportedAt: new Date().toISOString(),
  hkpUsersCount: users.length,
  hkpStaffUsersCount: staff.length,
  staffSummary: staff.map((s) => ({
    recordId: s.id,
    displayName: s.name || '',
    emailMasked: maskEmail(s.email),
    role: s.role,
    active: s.active !== false && s.is_active !== false,
    lastLoginAt: s.last_login_at || null
  })),
  hkpUsers: accountMap,
  notes: [
    'Passwords and tokens are never exported.',
    'New system login uses only hkp_staff_users.',
    'Do not delete hkp_users until phase 3 confirmation.'
  ]
};

fs.writeFileSync(path.join(outDir, 'current-loan-check.json'), JSON.stringify(currentLoanReport, null, 2));
fs.writeFileSync(path.join(outDir, 'hkp-users-staff-map.json'), JSON.stringify(usersReport, null, 2));

const md = [];
md.push('# hkp_users ↔ hkp_staff_users 對照（第二階段）');
md.push('');
md.push(`匯出時間：${usersReport.exportedAt}`);
md.push('');
md.push('## hkp_staff_users（現行登入）');
md.push('');
md.push('| ID | 名稱 | Email | role | active | last_login |');
md.push('|---|---|---|---|---|---|');
for (const s of usersReport.staffSummary) {
  md.push(`| ${s.recordId} | ${s.displayName || '—'} | ${s.emailMasked} | ${s.role} | ${s.active} | ${s.lastLoginAt || '—'} |`);
}
md.push('');
md.push('## hkp_users（舊帳號，不刪）');
md.push('');
md.push('| ID | 名稱 | Email | role | active | 與 staff 重複 | 建議 |');
md.push('|---|---|---|---|---|---|---|');
for (const u of accountMap) {
  md.push(`| ${u.recordId} | ${u.displayName || '—'} | ${u.emailMasked} | ${u.role} | ${u.active} | ${u.duplicateInStaffUsers ? '是' : '否'} | ${u.recommendation} |`);
}
md.push('');
md.push('密碼／token 未匯出。新系統僅使用 `hkp_staff_users`。');
fs.writeFileSync(path.join(outDir, 'HKP_USERS_STAFF_MAP.md'), md.join('\n'));

console.log(JSON.stringify({
  currentLoan: currentLoanReport,
  usersMapped: accountMap.length,
  staff: staff.length,
  outDir
}, null, 2));
