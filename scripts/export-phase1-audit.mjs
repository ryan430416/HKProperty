/**
 * Phase-1 read-only export: schema, rules, field list, record counts.
 * Never mutates PocketBase data or collections.
 */
import fs from 'node:fs';
import path from 'node:path';
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

const root = process.cwd();
// Prefer committed ops .env over .env.local (often points at localhost).
const env = { ...readEnv(path.join(root, '.env.local')), ...readEnv(path.join(root, '.env')) };
const url = process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'https://db.keson.pro';
const email = process.env.POCKETBASE_ADMIN_EMAIL || env.POCKETBASE_ADMIN_EMAIL;
const password = process.env.POCKETBASE_ADMIN_PASSWORD || env.POCKETBASE_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Missing POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD in .env');
  process.exit(1);
}
console.error(JSON.stringify({ pocketbaseUrl: url, mode: 'read-only-export' }));

const outDir = path.join(root, 'docs', 'exports', 'phase1-audit');
fs.mkdirSync(outDir, { recursive: true });

const pb = new PocketBase(url);
await pb.collection('_superusers').authWithPassword(email, password);

const collections = await pb.collections.getFullList();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const slim = [];
const counts = {};
for (const col of collections) {
  const name = col.name;
  let totalItems = null;
  let countError = null;
  try {
    const page = await pb.collection(name).getList(1, 1);
    totalItems = page.totalItems;
  } catch (error) {
    countError = error?.message || String(error);
  }
  counts[name] = { totalItems, countError, type: col.type };
  slim.push({
    id: col.id,
    name,
    type: col.type,
    system: !!col.system,
    listRule: col.listRule ?? null,
    viewRule: col.viewRule ?? null,
    createRule: col.createRule ?? null,
    updateRule: col.updateRule ?? null,
    deleteRule: col.deleteRule ?? null,
    indexes: col.indexes || [],
    viewQuery: col.viewQuery || null,
    fields: (col.fields || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      required: !!f.required,
      unique: !!f.unique,
      collectionId: f.collectionId || null,
      maxSelect: f.maxSelect ?? null,
      values: f.values || null,
      hidden: !!f.hidden,
      presentable: !!f.presentable
    })),
    totalItems,
    countError
  });
}

const hkp = slim.filter((c) => String(c.name).startsWith('hkp_'));
const assets = counts['hkp_assets']?.totalItems;

const summary = {
  exportedAt: new Date().toISOString(),
  pocketbaseUrl: url,
  totalCollections: collections.length,
  hkpCollectionCount: hkp.length,
  hkpAssetsCount: assets,
  warning: assets === 390 ? null : `EXPECTED_ASSETS_390_GOT_${assets}`,
  counts,
  hkpNames: hkp.map((c) => c.name).sort()
};

fs.writeFileSync(path.join(outDir, `collections-full-${stamp}.json`), JSON.stringify(slim, null, 2));
fs.writeFileSync(path.join(outDir, `collections-full-latest.json`), JSON.stringify(slim, null, 2));
fs.writeFileSync(path.join(outDir, `counts-${stamp}.json`), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, `counts-latest.json`), JSON.stringify(summary, null, 2));

// Human-readable CSV of hkp_* only
const lines = ['name,type,totalItems,listRule,viewRule,createRule,updateRule,deleteRule,fieldCount'];
for (const c of hkp.sort((a, b) => a.name.localeCompare(b.name))) {
  const esc = (v) => JSON.stringify(v == null ? '' : String(v));
  lines.push([
    c.name,
    c.type,
    c.totalItems ?? '',
    esc(c.listRule),
    esc(c.viewRule),
    esc(c.createRule),
    esc(c.updateRule),
    esc(c.deleteRule),
    c.fields.length
  ].join(','));
}
fs.writeFileSync(path.join(outDir, `hkp-summary-latest.csv`), lines.join('\n'));

console.log(JSON.stringify({
  outDir: path.relative(root, outDir),
  hkp: hkp.length,
  assets,
  files: [
    'collections-full-latest.json',
    'counts-latest.json',
    'hkp-summary-latest.csv'
  ]
}, null, 2));
