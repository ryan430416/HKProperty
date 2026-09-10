import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { COLLECTIONS, PB } from '../pocketbase/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNED = new Set(COLLECTIONS.map((item) => item.name));
const FORBIDDEN = new Set(['users', 'HKProperty']);

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const url = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;

if (!url || !adminEmail || !adminPassword) {
  console.error('請在 .env 設定 VITE_POCKETBASE_URL（或 POCKETBASE_URL）、POCKETBASE_ADMIN_EMAIL、POCKETBASE_ADMIN_PASSWORD');
  process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

async function authAdmin() {
  try {
    await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
    return;
  } catch {
    // PocketBase 0.22 以前
  }
  if (pb.admins?.authWithPassword) {
    await pb.admins.authWithPassword(adminEmail, adminPassword);
    return;
  }
  throw new Error('管理者登入失敗，請確認 PocketBase 網址與帳密正確');
}

function withRelationIds(fields, byName) {
  return fields.map((field) => {
    if (field.type !== 'relation') return { ...field };
    const { collectionName, ...rest } = field;
    const collectionId = byName[collectionName];
    if (!collectionId) throw new Error(`找不到關聯集合：${collectionName}`);
    return { ...rest, collectionId };
  });
}

function mergeFields(existingFields, desiredFields) {
  const current = (existingFields || []).slice();
  const names = new Set(current.map((field) => field.name));
  const added = [];
  for (const field of desiredFields) {
    if (names.has(field.name) || field.name === 'id' || field.name === 'created' || field.name === 'updated') continue;
    current.push(field);
    added.push(field.name);
  }
  return { fields: current, added };
}

async function ensureCollection(payload) {
  if (FORBIDDEN.has(payload.name) || !OWNED.has(payload.name)) {
    throw new Error(`拒絕修改非本系統集合：${payload.name}`);
  }
  const existing = await pb.collections.getFullList();
  const found = existing.find((item) => item.name === payload.name);
  if (!found) {
    try {
      await pb.collections.create(payload);
    } catch (error) {
      console.error(`create failed: ${payload.name}`, JSON.stringify(error?.data || error?.response || error.message, null, 2));
      throw error;
    }
    console.log(`created ${payload.name}`);
    return { action: 'created', name: payload.name };
  }
  const { fields, added } = mergeFields(found.fields || found.schema || [], payload.fields || []);
  await pb.collections.update(found.id, {
    listRule: payload.listRule,
    viewRule: payload.viewRule,
    createRule: payload.createRule,
    updateRule: payload.updateRule,
    deleteRule: payload.deleteRule,
    indexes: payload.indexes || found.indexes || [],
    fields
  });
  console.log(`updated ${payload.name}${added.length ? ` +fields ${added.join(',')}` : ''}`);
  return { action: 'updated', name: payload.name, added };
}

await authAdmin();

const created = [];
const skippedForeign = (await pb.collections.getFullList())
  .map((item) => item.name)
  .filter((name) => !OWNED.has(name));

for (const collection of COLLECTIONS) {
  const all = await pb.collections.getFullList();
  const byName = Object.fromEntries(all.map((item) => [item.name, item.id]));
  const payload = {
    name: collection.name,
    type: collection.type,
    listRule: collection.listRule,
    viewRule: collection.viewRule,
    createRule: collection.createRule,
    updateRule: collection.updateRule,
    deleteRule: collection.deleteRule,
    indexes: collection.indexes || [],
    fields: withRelationIds(collection.fields, byName)
  };
  created.push(await ensureCollection(payload));
}

const after = await pb.collections.getFullList();
const byName = Object.fromEntries(after.map((item) => [item.name, item.id]));
const assets = after.find((item) => item.name === PB.assets);
const hasCurrentLoan = (assets.fields || []).some((field) => field.name === 'current_loan');
if (!hasCurrentLoan) {
  await pb.collections.update(assets.id, {
    fields: [
      ...(assets.fields || []),
      {
        name: 'current_loan',
        type: 'relation',
        collectionId: byName[PB.loans],
        maxSelect: 1,
        cascadeDelete: false
      }
    ]
  });
  console.log(`added ${PB.assets}.current_loan`);
}

const settings = await pb.collection(PB.settings).getFullList();
if (!settings.length) {
  await pb.collection(PB.settings).create({
    require_loan_approval: false,
    allow_self_checkout: true,
    default_loan_days: 1
  });
  console.log(`seeded ${PB.settings}`);
}

console.log(JSON.stringify({
  ok: true,
  url,
  owned: [...OWNED],
  skippedForeign,
  result: created,
  collections: (await pb.collections.getFullList()).map((item) => item.name)
}, null, 2));
