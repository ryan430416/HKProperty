/**
 * Soft-deleted TMP asset audit for Phase 3A.1 (read-only).
 * Never prints secrets.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';

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

const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...readEnv('.env.service.local') };
const pb = new PocketBase(env.POCKETBASE_URL || env.VITE_POCKETBASE_URL);
await pb.collection('hkp_staff_users').authWithPassword(
  env.HKP_FORMAL_ADMIN_EMAIL || env.POCKETBASE_SERVICE_EMAIL,
  env.HKP_FORMAL_PASSWORD || env.POCKETBASE_SERVICE_PASSWORD
);

const EXPECTED = '421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132';
const allAssets = [];
let page = 1;
for (;;) {
  const list = await pb.collection('hkp_assets').getList(page, 200, {
    fields: 'id,property_id,name,enabled,is_active,is_borrowable,deleted_at,availability_status',
    sort: 'property_id'
  });
  allAssets.push(...list.items);
  if (page >= list.totalPages) break;
  page += 1;
}

function isDeleted(row) {
  return row.deleted_at != null && String(row.deleted_at).trim() !== '';
}

const active = allAssets.filter((r) => !isDeleted(r));
const softDeleted = allAssets.filter((r) => isDeleted(r));
const tmp = allAssets.filter((r) => /^(PROD-SMOKE-TMP-|PREVIEW-TMP-)/i.test(String(r.property_id || '')));

const details = [];
for (const row of tmp) {
  const assetId = row.id;
  const reservations = await pb.collection('hkp_reservations').getList(1, 5, {
    filter: `asset = "${assetId}"`
  }).catch(() => ({ totalItems: -1, items: [] }));
  const usages = await pb.collection('hkp_usage_records').getList(1, 5, {
    filter: `asset = "${assetId}"`
  }).catch(() => ({ totalItems: -1, items: [] }));
  let usageByNote = { totalItems: 0 };
  try {
    usageByNote = await pb.collection('hkp_usage_records').getList(1, 5, {
      filter: `note ~ "${assetId}"`
    });
  } catch {
    usageByNote = { totalItems: -1 };
  }
  const logs = await pb.collection('hkp_operation_logs').getList(1, 5, {
    filter: `asset = "${assetId}" || entity_id = "${assetId}"`
  }).catch(() => ({ totalItems: -1, items: [] }));

  details.push({
    property_id: row.property_id,
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    is_active: row.is_active,
    is_borrowable: row.is_borrowable,
    deleted_at: row.deleted_at || null,
    availability_status: row.availability_status,
    relations: {
      reservations: reservations.totalItems,
      usage_by_asset: usages.totalItems,
      usage_by_note: usageByNote.totalItems,
      operation_logs: logs.totalItems
    }
  });
}

const activeIds = active.map((r) => String(r.property_id || '')).sort();
const fp = crypto.createHash('sha256').update(activeIds.join('\n'), 'utf8').digest('hex');

// Public API presence check for TMP ids
let publicHits = [];
try {
  const res = await fetch('https://hk-property.vercel.app/api/public/assets?q=TMP&perPage=50');
  const body = await res.json();
  publicHits = (body.items || [])
    .map((i) => i.propertyId)
    .filter((pid) => /TMP/i.test(String(pid || '')));
} catch {
  publicHits = ['public_api_check_failed'];
}

const out = {
  totals: {
    physical_records: allAssets.length,
    active_not_soft_deleted: active.length,
    soft_deleted: softDeleted.length,
    tmp_records: tmp.length
  },
  fingerprint: {
    algorithm: 'sha256 of active property_id sorted ascending, joined by \\n',
    filter: 'deleted_at empty or null only',
    value: fp,
    match_expected: fp === EXPECTED
  },
  tmp_details: details,
  public_api_tmp_hits: publicHits,
  notes: [
    'Fingerprint excludes soft-deleted rows',
    'TMP soft-deleted records may remain due to relation constraints; must not be borrowable'
  ]
};

fs.mkdirSync('docs/exports/phase3a1', { recursive: true });
fs.writeFileSync('docs/exports/phase3a1/soft-delete-audit.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
