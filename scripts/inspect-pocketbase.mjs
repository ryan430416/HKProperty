import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  console.error('缺少 URL 或管理者帳密');
  process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

async function authAdmin() {
  try {
    await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
    return '_superusers';
  } catch (error) {
    if (pb.admins?.authWithPassword) {
      await pb.admins.authWithPassword(adminEmail, adminPassword);
      return 'admins';
    }
    throw error;
  }
}

try {
  const method = await authAdmin();
  const cols = await pb.collections.getFullList();
  console.log(JSON.stringify({
    ok: true,
    url,
    auth: method,
    count: cols.length,
    collections: cols.map((item) => ({
      name: item.name,
      type: item.type,
      system: item.system === true,
      fields: (item.fields || item.schema || []).map((field) => field.name)
    }))
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    url,
    status: error?.status || null,
    message: error?.message || String(error),
    data: error?.data || null
  }, null, 2));
  process.exit(1);
}
