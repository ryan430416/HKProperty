/**
 * Create minimal service account in hkp_staff_users (role=service).
 * Writes credentials ONLY to .env.service.local (gitignored). Never prints password.
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

const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const pb = new PocketBase(process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const email = process.env.HKP_SERVICE_EMAIL || 'hkp-service@hkproperty.local';
const password = crypto.randomBytes(24).toString('base64url');
const existing = await pb.collection('hkp_staff_users').getFullList({
  filter: `email = "${email}"`
});

let id;
if (existing.length) {
  id = existing[0].id;
  await pb.collection('hkp_staff_users').update(id, {
    role: 'service',
    active: true,
    is_active: true,
    name: 'HKProperty Service',
    password,
    passwordConfirm: password
  });
} else {
  const row = await pb.collection('hkp_staff_users').create({
    email,
    password,
    passwordConfirm: password,
    emailVisibility: false,
    name: 'HKProperty Service',
    role: 'service',
    active: true,
    is_active: true,
    employee_number: 'SVC-001',
    department: 'system'
  });
  id = row.id;
}

const local = [
  '# Generated locally — DO NOT COMMIT',
  `POCKETBASE_URL=${process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro'}`,
  `POCKETBASE_SERVICE_EMAIL=${email}`,
  `POCKETBASE_SERVICE_PASSWORD=${password}`
].join('\n');
fs.writeFileSync('.env.service.local', `${local}\n`);

console.log(JSON.stringify({
  ok: true,
  serviceUserId: id,
  email,
  wrote: '.env.service.local',
  vercelEnvNames: ['POCKETBASE_URL', 'POCKETBASE_SERVICE_EMAIL', 'POCKETBASE_SERVICE_PASSWORD'],
  note: 'Password written only to .env.service.local (gitignored). Copy into Vercel runtime env manually.'
}, null, 2));
