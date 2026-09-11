import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const pb = new PocketBase(env.POCKETBASE_URL);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

const origins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://hk-property.vercel.app'
];

try {
  await pb.settings.update({ trustedOrigins: origins });
  console.log('cors=trustedOrigins');
} catch (error) {
  console.log(`cors_skip=${error.message}`);
}

const cols = ['assets', 'loan_records', 'asset_reservations', 'usage_records'];
const checks = {};
for (const name of cols) {
  const list = await pb.collection(name).getList(1, 1);
  checks[name] = list.totalItems;
}

console.log(JSON.stringify({
  ok: true,
  url: env.POCKETBASE_URL,
  totals: checks,
  adminUser: env.POCKETBASE_ADMIN_EMAIL
}, null, 2));
