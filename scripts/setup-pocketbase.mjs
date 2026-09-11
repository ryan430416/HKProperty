import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { COLLECTIONS, PB } from '../pocketbase/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNED = new Set(COLLECTIONS.map((item) => item.name));

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
    // older PocketBase
  }
  if (pb.admins?.authWithPassword) {
    await pb.admins.authWithPassword(adminEmail, adminPassword);
    return;
  }
  throw new Error('管理者登入失敗');
}

function withRelationIds(fields, byName) {
  return (fields || []).map((field) => {
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
  for (const field of desiredFields || []) {
    if (names.has(field.name) || ['id', 'created', 'updated', 'password', 'tokenKey', 'email', 'emailVisibility', 'verified'].includes(field.name)) {
      continue;
    }
    current.push(field);
    added.push(field.name);
  }
  return { fields: current, added };
}

async function ensureCollection(payload) {
  if (!OWNED.has(payload.name)) throw new Error(`拒絕修改非本系統集合：${payload.name}`);
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
  const patch = {
    listRule: payload.listRule,
    viewRule: payload.viewRule,
    createRule: payload.createRule,
    updateRule: payload.updateRule,
    deleteRule: payload.deleteRule,
    indexes: payload.indexes || found.indexes || [],
    fields
  };
  try {
    await pb.collections.update(found.id, patch);
  } catch (error) {
    // Older rule syntax fallback for users.updateRule
    if (payload.name === PB.users) {
      patch.updateRule = `(@request.auth.id = id) || (@request.auth.role = "admin")`;
      await pb.collections.update(found.id, patch);
    } else {
      throw error;
    }
  }
  console.log(`updated ${payload.name}${added.length ? ` +fields ${added.join(',')}` : ''}`);
  return { action: 'updated', name: payload.name, added };
}

await authAdmin();

// Guard: refuse to mutate a shared "users" collection from another app
{
  const all = await pb.collections.getFullList();
  const users = all.find((item) => item.name === 'users');
  if (users) {
    const fieldNames = new Set((users.fields || users.schema || []).map((f) => f.name));
    const roleField = (users.fields || users.schema || []).find((f) => f.name === 'role');
    const foreign = fieldNames.has('gender') || fieldNames.has('program') || fieldNames.has('nickname')
      || (roleField?.values || []).some((v) => v === 'volunteer' || v === 'teacher');
    if (foreign) {
      console.error(JSON.stringify({
        ok: false,
        error: '偵測到共用的 users 集合（含其他專案欄位）。請改用獨立 PocketBase 實例後再執行 setup，以免破壞其他系統。',
        hint: '本機可用 .\\pocketbase.exe serve 建立新的 pb_data'
      }, null, 2));
      process.exit(1);
    }
  }
}

const created = [];

for (const collection of COLLECTIONS) {
  const all = await pb.collections.getFullList();
  const byName = Object.fromEntries(all.map((item) => [item.name, item.id]));
  // users auth collection may already exist — ensure it is in byName before relations
  if (collection.name === PB.users && !byName[PB.users]) {
    // will create below
  }
  const fields = withRelationIds(collection.fields, {
    ...byName,
    ...(collection.name === PB.users ? {} : {})
  });
  // For first pass, skip relation fields that target collections not yet created
  const safeFields = fields.filter((field) => field.type !== 'relation' || field.collectionId);
  const payload = {
    name: collection.name,
    type: collection.type,
    listRule: collection.listRule,
    viewRule: collection.viewRule,
    createRule: collection.createRule,
    updateRule: collection.updateRule,
    deleteRule: collection.deleteRule,
    indexes: collection.indexes || [],
    fields: safeFields
  };
  created.push(await ensureCollection(payload));
}

// Second pass: add relations now that all collections exist
const afterPass1 = await pb.collections.getFullList();
const byName = Object.fromEntries(afterPass1.map((item) => [item.name, item.id]));
for (const collection of COLLECTIONS) {
  const found = afterPass1.find((item) => item.name === collection.name);
  if (!found) continue;
  const desired = withRelationIds(collection.fields, byName);
  const { fields, added } = mergeFields(found.fields || [], desired);
  if (!added.length && !(desired.some((f) => f.type === 'relation'))) continue;
  await pb.collections.update(found.id, { fields });
  if (added.length) console.log(`relations ${collection.name}: ${added.join(',')}`);
}

const after = await pb.collections.getFullList();
const ids = Object.fromEntries(after.map((item) => [item.name, item.id]));
const assets = after.find((item) => item.name === PB.assets);
if (assets && !(assets.fields || []).some((field) => field.name === 'current_loan')) {
  await pb.collections.update(assets.id, {
    fields: [
      ...(assets.fields || []),
      {
        name: 'current_loan',
        type: 'relation',
        collectionId: ids[PB.loans],
        maxSelect: 1,
        cascadeDelete: false
      }
    ]
  });
  console.log('added assets.current_loan');
}

const settings = await pb.collection(PB.settings).getFullList();
if (!settings.length) {
  await pb.collection(PB.settings).create({
    require_loan_approval: false,
    allow_self_checkout: true,
    default_loan_days: 1
  });
  console.log('seeded system_settings');
}

console.log(JSON.stringify({
  ok: true,
  url,
  owned: [...OWNED],
  result: created,
  collections: (await pb.collections.getFullList()).map((item) => item.name)
}, null, 2));
