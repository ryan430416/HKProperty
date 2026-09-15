import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';

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

const env = { ...readEnv('.env.local'), ...readEnv('.env') };
const pb = new PocketBase(process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro');
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const rows = await pb.collection('hkp_assets').getFullList({
  fields: 'id,property_id,name,location,availability_status,is_active,usage_count',
  sort: 'property_id'
});
const ids = rows.map((r) => r.property_id || '').join('\n');
const hash = crypto.createHash('sha256').update(ids).digest('hex');
const outDir = path.join('docs', 'exports', 'phase1-audit');
fs.mkdirSync(outDir, { recursive: true });
const out = {
  exportedAt: new Date().toISOString(),
  count: rows.length,
  propertyIdSha256: hash,
  sampleFirst5: rows.slice(0, 5).map((r) => ({
    id: r.id,
    property_id: r.property_id,
    availability_status: r.availability_status,
    is_active: r.is_active,
    usage_count: r.usage_count
  })),
  sampleLast5: rows.slice(-5).map((r) => ({ id: r.id, property_id: r.property_id }))
};
fs.writeFileSync(path.join(outDir, 'assets-fingerprint-latest.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(outDir, 'assets-property-ids-latest.txt'), `${ids}\n`);
console.log(JSON.stringify({ count: out.count, propertyIdSha256: hash }));
