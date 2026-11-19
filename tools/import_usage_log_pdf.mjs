/**
 * Import 114年度器材使用紀錄.pdf rows into hkp_loan_records (backfill).
 * Usage: node tools/import_usage_log_pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pdfPath = path.join(root, '114年度器材使用紀錄.pdf');
const jsonPath = path.join(root, 'docs', 'exports', 'usage-log', '114-from-pdf.json');
const parser = path.join(root, '.cursor', 'skills', 'pdf-read', 'scripts', 'parse_usage_log.py');

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function rocToIso(roc) {
  const m = String(roc || '').trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]) + 1911;
  const mo = String(Number(m[2])).padStart(2, '0');
  const d = String(Number(m[3])).padStart(2, '0');
  return `${y}-${mo}-${d}T12:00:00.000Z`;
}

function isComplete(row) {
  return Boolean(
    row.borrowedAt
    && row.returnedAt
    && row.purpose
    && row.unit
    && row.title
    && row.name
    && String(row.name).length >= 2
  );
}

const parsed = spawnSync('python', [parser, pdfPath, '--json', jsonPath, '--summary'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});
if (parsed.status !== 0) {
  console.error(parsed.stderr || parsed.stdout);
  process.exit(parsed.status || 1);
}
process.stderr.write(parsed.stderr || '');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const env = { ...readEnv(path.join(root, '.env')), ...readEnv(path.join(root, '.env.local')) };
const pb = new PocketBase(String(env.POCKETBASE_URL || '').replace(/\/$/, ''));
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const assets = await pb.collection('hkp_assets').getFullList({
  fields: 'id,property_id,name,location',
  requestKey: 'assets'
});
const assetByPid = new Map(assets.map((a) => [String(a.property_id), a]));

const users = await pb.collection('hkp_users').getList(1, 20, { requestKey: 'users' }).catch(() => ({ items: [] }));
const staff = await pb.collection('hkp_staff_users').getList(1, 20, { requestKey: 'staff' }).catch(() => ({ items: [] }));
const fallbackBorrower = users.items[0]?.id || staff.items[0]?.id || '';

const report = {
  assetsInPdf: data.assets.length,
  complete: 0,
  incomplete: 0,
  missingAsset: [],
  created: 0,
  skippedDup: 0,
  errors: []
};

for (const asset of data.assets) {
  const dbAsset = assetByPid.get(String(asset.propertyId));
  if (!dbAsset) {
    report.missingAsset.push(asset.propertyId);
    continue;
  }
  for (const row of asset.rows) {
    if (!isComplete(row)) {
      report.incomplete += 1;
      continue;
    }
    report.complete += 1;
    const checkoutAt = rocToIso(row.borrowedAt);
    const returnedAt = rocToIso(row.returnedAt);
    const note = `pdf:114年度器材使用紀錄|${asset.propertyId}|${row.seq}`;
    const existing = await pb.collection('hkp_loan_records').getList(1, 1, {
      filter: `note = "${note}"`,
      requestKey: `dup-${asset.propertyId}-${row.seq}`
    });
    if (existing.totalItems > 0) {
      report.skippedDup += 1;
      continue;
    }

    const day = checkoutAt.slice(0, 10).replace(/-/g, '');
    const sameDay = await pb.collection('hkp_loan_records').getList(1, 1, {
      filter: `loan_number ~ "LOAN-${day}-"`,
      requestKey: `cnt-${day}-${asset.propertyId}-${row.seq}`
    });
    // approximate unique number using created counter + seq
    const loanNumber = `LOAN-${day}-P${String(row.seq).padStart(4, '0')}`;

    const payload = {
      loan_number: loanNumber,
      asset: dbAsset.id,
      property_id: dbAsset.property_id,
      property_name: dbAsset.name,
      borrower: fallbackBorrower || undefined,
      borrower_name: row.name,
      borrower_number: 'PDF114',
      borrower_department: row.unit,
      borrower_title: row.title,
      entry_source: 'backfill',
      purpose: row.purpose.slice(0, 80),
      requested_at: checkoutAt,
      checkout_at: checkoutAt,
      expected_return_at: returnedAt,
      returned_at: returnedAt,
      checkout_method: 'backfill',
      checkout_operator: 'PDF匯入',
      return_operator: 'PDF匯入',
      return_result: '正常歸還',
      return_location: dbAsset.location || '',
      status: 'returned',
      note
    };
    if (!payload.borrower) delete payload.borrower;

    try {
      await pb.collection('hkp_loan_records').create(payload);
      report.created += 1;
    } catch (error) {
      // loan_number collision: retry with random suffix
      try {
        payload.loan_number = `LOAN-${day}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        if (!payload.borrower && fallbackBorrower) payload.borrower = fallbackBorrower;
        await pb.collection('hkp_loan_records').create(payload);
        report.created += 1;
      } catch (error2) {
        report.errors.push({
          propertyId: asset.propertyId,
          seq: row.seq,
          message: error2?.message || String(error2)
        });
        if (report.errors.length > 20) break;
      }
    }
    if (report.created && report.created % 50 === 0) {
      console.error(`progress created=${report.created}`);
    }
  }
  if (report.errors.length > 20) break;
}

const after = await pb.collection('hkp_loan_records').getList(1, 1, { requestKey: 'after' });
report.loansTotalAfter = after.totalItems;
console.log(JSON.stringify(report, null, 2));
