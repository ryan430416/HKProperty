/**
 * Dry-run migration helper: maps old rows into hkp_reservations shape.
 * Default --dry-run. Use --apply only after explicit confirmation.
 */
import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';
import { mapLegacyStatus, RESERVATION_STATUS } from '../shared/reservationStatus.js';
import crypto from 'node:crypto';

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const apply = process.argv.includes('--apply') && process.env.HKP_ALLOW_APPLY === 'YES';
const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const pb = new PocketBase(process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const assetsBefore = (await pb.collection('hkp_assets').getList(1, 1)).totalItems;
if (assetsBefore !== 390) {
  console.error(JSON.stringify({ error: 'asset_count_mismatch', assetsBefore }));
  process.exit(1);
}

const borrows = await pb.collection('hkp_borrow_requests').getFullList().catch(() => []);
const locks = await pb.collection('hkp_time_locks').getFullList().catch(() => []);
const lockGroups = new Map();
for (const row of locks) {
  const key = row.reservation_number || row.id;
  if (!lockGroups.has(key)) lockGroups.set(key, row);
}

const planned = [];
for (const row of borrows) {
  planned.push({
    source: 'hkp_borrow_requests',
    sourceId: row.id,
    request_no: row.request_number,
    verification_hash: row.public_token_hash || crypto.randomBytes(16).toString('hex'),
    borrower_unit: row.borrower_unit,
    borrower_name: row.borrower_name,
    borrower_phone: row.borrower_phone,
    asset: row.asset,
    purpose: row.purpose,
    borrow_date: row.requested_at,
    expected_return_date: row.expected_return_at,
    status: mapLegacyStatus(row.status) || RESERVATION_STATUS.PENDING
  });
}
for (const row of lockGroups.values()) {
  planned.push({
    source: 'hkp_time_locks',
    sourceId: row.id,
    request_no: row.reservation_number,
    verification_hash: row.public_token_hash || crypto.randomBytes(16).toString('hex'),
    borrower_unit: row.borrower_unit,
    borrower_name: row.borrower_name,
    borrower_phone: row.borrower_phone,
    asset: row.asset,
    purpose: row.purpose,
    borrow_date: row.start_at,
    expected_return_date: row.end_at,
    status: mapLegacyStatus(row.status) || RESERVATION_STATUS.PENDING
  });
}

const created = [];
if (apply) {
  for (const row of planned) {
    const exists = await pb.collection('hkp_reservations').getList(1, 1, {
      filter: `request_no = "${String(row.request_no || '').replace(/"/g, '')}"`
    });
    if (exists.totalItems) continue;
    const rec = await pb.collection('hkp_reservations').create({
      request_no: row.request_no,
      request_group_no: row.request_no,
      verification_hash: row.verification_hash,
      borrower_unit: row.borrower_unit || '未填',
      borrower_name: row.borrower_name || '未填',
      borrower_phone: row.borrower_phone || '00000000',
      asset: row.asset,
      purpose: row.purpose || '遷移匯入',
      borrow_date: row.borrow_date || new Date().toISOString(),
      expected_return_date: row.expected_return_date || new Date().toISOString(),
      status: row.status
    });
    created.push(rec.id);
  }
}

const assetsAfter = (await pb.collection('hkp_assets').getList(1, 1)).totalItems;
const out = {
  apply,
  assetsBefore,
  assetsAfter,
  plannedFromBorrowRequests: borrows.length,
  plannedFromTimeLockGroups: lockGroups.size,
  plannedTotal: planned.length,
  created: created.length,
  note: apply ? 'applied' : 'dry-run only (set HKP_ALLOW_APPLY=YES and --apply to write)'
};
fs.mkdirSync(path.join('docs', 'exports', 'phase2'), { recursive: true });
fs.writeFileSync(path.join('docs', 'exports', 'phase2', 'migration-dry-run.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (assetsAfter !== 390) process.exit(1);
