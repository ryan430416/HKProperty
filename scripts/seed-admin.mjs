import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { PB } from '../pocketbase/schema.mjs';

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

const pb = new PocketBase(process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(
  process.env.POCKETBASE_ADMIN_EMAIL,
  process.env.POCKETBASE_ADMIN_PASSWORD
);

const email = process.env.POCKETBASE_ADMIN_EMAIL;
const password = process.env.POCKETBASE_ADMIN_PASSWORD;
const existing = await pb.collection(PB.users).getFullList({ filter: `email = "${email}"` });
if (existing.length) {
  console.log(JSON.stringify({ ok: true, skipped: true, id: existing[0].id, email }));
  process.exit(0);
}

const user = await pb.collection(PB.users).create({
  email,
  password,
  passwordConfirm: password,
  emailVisibility: true,
  verified: true,
  display_name: '測試管理者',
  role: 'admin',
  is_active: true,
  department: '總務處'
});
console.log(JSON.stringify({ ok: true, created: true, id: user.id, email: user.email, role: user.role }));
