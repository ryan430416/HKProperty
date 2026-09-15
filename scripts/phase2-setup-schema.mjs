/**
 * Phase 2 additive schema setup (create collections / fields only).
 * Never deletes collections or asset rows.
 * Usage: node scripts/phase2-setup-schema.mjs [--apply]
 * Default is dry-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';
import {
  RESERVATION_STATUSES,
  INVENTORY_RESULTS,
  INVENTORY_SESSION_STATUS
} from '../shared/reservationStatus.js';

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

const apply = process.argv.includes('--apply');
const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const url = process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro';
const pb = new PocketBase(url);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const STAFF = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin" || @request.auth.role = "service")';
const STAFF_ONLY = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && (@request.auth.role = "staff" || @request.auth.role = "admin")';
const ADMIN = '@request.auth.collectionName = "hkp_staff_users" && @request.auth.is_active = true && @request.auth.role = "admin"';
const SERVICE_OR_STAFF = STAFF;

const report = { apply, created: [], updated: [], skipped: [], errors: [] };

async function getCol(name) {
  try {
    return await pb.collections.getOne(name);
  } catch {
    return null;
  }
}

function hasField(col, name) {
  return (col.fields || []).some((f) => f.name === name);
}

async function ensureCollection(def) {
  const existing = await getCol(def.name);
  if (existing) {
    report.skipped.push({ name: def.name, reason: 'exists' });
    return existing;
  }
  if (!apply) {
    report.created.push({ name: def.name, dryRun: true });
    return null;
  }
  const created = await pb.collections.create(def);
  report.created.push({ name: def.name, id: created.id });
  return created;
}

async function ensureFields(name, fields) {
  const col = await getCol(name);
  if (!col) {
    report.skipped.push({ name, reason: 'missing_collection_for_fields' });
    return;
  }
  const nextFields = [...(col.fields || [])];
  let changed = false;
  for (const field of fields) {
    if (hasField(col, field.name)) continue;
    nextFields.push(field);
    changed = true;
    report.updated.push({ name, field: field.name, dryRun: !apply });
  }
  if (!changed) return;
  if (!apply) return;
  await pb.collections.update(col.id, { fields: nextFields });
}

async function ensureStaffRoleValues() {
  const col = await getCol('hkp_staff_users');
  if (!col) return;
  const role = (col.fields || []).find((f) => f.name === 'role');
  if (!role) return;
  const values = Array.isArray(role.values) ? [...role.values] : [];
  let changed = false;
  for (const v of ['staff', 'admin', 'service']) {
    if (!values.includes(v)) {
      values.push(v);
      changed = true;
    }
  }
  if (!changed) {
    report.skipped.push({ name: 'hkp_staff_users.role', reason: 'values_ok' });
    return;
  }
  report.updated.push({ name: 'hkp_staff_users.role', values, dryRun: !apply });
  if (!apply) return;
  role.values = values;
  await pb.collections.update(col.id, { fields: col.fields });
}

const assetsCol = await getCol('hkp_assets');
if (!assetsCol) throw new Error('hkp_assets missing — abort');
const assetsCount = (await pb.collection('hkp_assets').getList(1, 1)).totalItems;
if (assetsCount !== 390) {
  console.error(JSON.stringify({ error: 'asset_count_mismatch', assetsCount }));
  process.exit(1);
}

await ensureStaffRoleValues();

await ensureFields('hkp_assets', [
  { name: 'current_location', type: 'text', required: false },
  { name: 'deleted_at', type: 'date', required: false },
  { name: 'enabled', type: 'bool', required: false }
]);

const reservationsDef = {
  name: 'hkp_reservations',
  type: 'base',
  listRule: STAFF_ONLY,
  viewRule: STAFF_ONLY,
  createRule: null,
  updateRule: null,
  deleteRule: ADMIN,
  indexes: [
    'CREATE UNIQUE INDEX idx_hkp_reservations_request_no ON hkp_reservations (request_no)',
    'CREATE INDEX idx_hkp_reservations_asset_status ON hkp_reservations (asset, status)',
    'CREATE INDEX idx_hkp_reservations_group ON hkp_reservations (request_group_no)'
  ],
  fields: [
    { name: 'request_no', type: 'text', required: true },
    { name: 'request_group_no', type: 'text', required: false },
    { name: 'verification_hash', type: 'text', required: true },
    { name: 'borrower_unit', type: 'text', required: true },
    { name: 'borrower_name', type: 'text', required: true },
    { name: 'borrower_phone', type: 'text', required: true },
    { name: 'asset', type: 'relation', required: true, collectionId: assetsCol.id, maxSelect: 1, cascadeDelete: false },
    { name: 'purpose', type: 'text', required: true },
    { name: 'borrow_date', type: 'date', required: true },
    { name: 'expected_return_date', type: 'date', required: true },
    { name: 'actual_return_date', type: 'date', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: [...RESERVATION_STATUSES] },
    { name: 'approval_note', type: 'text', required: false },
    { name: 'handled_by', type: 'relation', required: false, collectionId: (await getCol('hkp_staff_users'))?.id, maxSelect: 1, cascadeDelete: false },
    { name: 'approved_at', type: 'date', required: false },
    { name: 'checked_out_at', type: 'date', required: false },
    { name: 'returned_at', type: 'date', required: false },
    { name: 'condition_out', type: 'text', required: false },
    { name: 'condition_return', type: 'text', required: false },
    { name: 'idempotency_key', type: 'text', required: false },
    { name: 'staff_note', type: 'text', required: false }
  ]
};

await ensureCollection(reservationsDef);

const sessionsDef = {
  name: 'hkp_inventory_sessions',
  type: 'base',
  listRule: STAFF_ONLY,
  viewRule: STAFF_ONLY,
  createRule: STAFF_ONLY,
  updateRule: STAFF_ONLY,
  deleteRule: ADMIN,
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'started_at', type: 'date', required: true },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: Object.values(INVENTORY_SESSION_STATUS) },
    { name: 'created_by', type: 'relation', required: false, collectionId: (await getCol('hkp_staff_users'))?.id, maxSelect: 1, cascadeDelete: false },
    { name: 'note', type: 'text', required: false }
  ]
};
const sessions = await ensureCollection(sessionsDef);
const sessionsId = sessions?.id || (await getCol('hkp_inventory_sessions'))?.id;

const recordsDef = {
  name: 'hkp_inventory_records',
  type: 'base',
  listRule: STAFF_ONLY,
  viewRule: STAFF_ONLY,
  createRule: STAFF_ONLY,
  updateRule: STAFF_ONLY,
  deleteRule: ADMIN,
  indexes: [
    'CREATE UNIQUE INDEX idx_hkp_inventory_session_asset ON hkp_inventory_records (session, asset)'
  ],
  fields: [
    { name: 'session', type: 'relation', required: true, collectionId: sessionsId, maxSelect: 1, cascadeDelete: true },
    { name: 'asset', type: 'relation', required: true, collectionId: assetsCol.id, maxSelect: 1, cascadeDelete: false },
    { name: 'recorded_location', type: 'text', required: true },
    { name: 'result', type: 'select', required: true, maxSelect: 1, values: [...INVENTORY_RESULTS] },
    { name: 'note', type: 'text', required: false },
    { name: 'checked_by', type: 'relation', required: false, collectionId: (await getCol('hkp_staff_users'))?.id, maxSelect: 1, cascadeDelete: false },
    { name: 'checked_at', type: 'date', required: true }
  ]
};
await ensureCollection(recordsDef);

// Tighten: anonymous cannot write new reservations; only service/staff via rules later.
// Keep createRule null so only superuser / API with admin token or explicit auth can write.
const resCol = await getCol('hkp_reservations');
if (resCol && apply) {
  await pb.collections.update(resCol.id, {
    listRule: STAFF_ONLY,
    viewRule: STAFF_ONLY,
    createRule: SERVICE_OR_STAFF,
    updateRule: SERVICE_OR_STAFF,
    deleteRule: ADMIN
  });
  report.updated.push({ name: 'hkp_reservations.rules', ok: true });
}

const outDir = path.join('docs', 'exports', 'phase2');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'schema-setup-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!apply) console.error('Dry-run only. Re-run with --apply to create collections.');
