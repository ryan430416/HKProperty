import fs from 'node:fs';
function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}
const env = readEnv('.env');
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const assets = await pb.collection('hkp_assets').getList(1, 1);
const used = await pb.collection('hkp_assets').getList(1, 1, { filter: 'usage_count > 0' });
const loans = await pb.collection('hkp_loan_records').getList(1, 1).catch((error) => ({ totalItems: `fail:${error.status}` }));
const usage = await pb.collection('hkp_usage_records').getList(1, 1);
console.log(JSON.stringify({
  assets: assets.totalItems,
  assets_with_usage_count: used.totalItems,
  loan_records: loans.totalItems,
  usage_records: usage.totalItems
}));
