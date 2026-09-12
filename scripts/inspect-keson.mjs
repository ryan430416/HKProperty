import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}

const pb = new PocketBase('https://db.keson.pro');
pb.autoCancellation(false);

try {
  await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
  console.log(`auth=ok domain=${String(env.POCKETBASE_ADMIN_EMAIL || '').split('@')[1] || 'unknown'}`);
} catch (error) {
  console.log(JSON.stringify({ auth: false, status: error?.status, message: error?.message }));
  process.exit(1);
}

const cols = await pb.collections.getFullList();
const names = cols.map((item) => item.name).filter((name) => !name.startsWith('_'));
console.log(`collections=${names.join(',')}`);

for (const name of names) {
  if (!/asset|loan|usage|reserv|user|hkp/i.test(name)) continue;
  try {
    const list = await pb.collection(name).getList(1, 1);
    const fields = (cols.find((item) => item.name === name).fields || []).map((field) => field.name).join('|');
    console.log(`${name} total=${list.totalItems} fields=${fields}`);
  } catch (error) {
    console.log(`${name} count_fail status=${error?.status} message=${error?.message}`);
  }
}
