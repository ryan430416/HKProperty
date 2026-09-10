import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { PB } from '../pocketbase/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
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

const catalog = JSON.parse(readFileSync(join(root, 'data', 'inventory.json'), 'utf8'));
const items = Array.isArray(catalog.items) ? catalog.items : [];
if (items.length !== 390) {
  console.warn(`警告：inventory.json 筆數為 ${items.length}，預期 390`);
}

function mapItem(item) {
  const row = {
    property_id: String(item.propertyId),
    name: item.name,
    service_life: Number.isFinite(item.serviceLife) ? item.serviceLife : 0,
    specification: item.specification || '',
    unit: item.unit || '',
    price: item.price ?? 0,
    department: item.department || '',
    location: item.location || '',
    custodian: item.custodian || '',
    supplier: item.supplier || '',
    asset_status: item.status === '正常' ? 'normal' : (item.status || 'normal'),
    availability_status: 'available',
    usage_count: 0,
    note: item.note || '',
    brand: item.brand || '',
    model: item.model || '',
    is_borrowable: true,
    is_active: true,
    audit_status: '待盤點'
  };
  if (item.purchaseDate) row.purchase_date = item.purchaseDate;
  return row;
}

if (dryRun) {
  const ids = items.map((item) => String(item.propertyId));
  const unique = new Set(ids);
  console.log(JSON.stringify({
    dryRun: true,
    total: items.length,
    uniquePropertyIds: unique.size,
    duplicates: ids.length - unique.size
  }, null, 2));
  process.exit(ids.length === unique.size ? 0 : 1);
}

const url = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;
if (!url || !adminEmail || !adminPassword) {
  console.error('請在本機 .env 設定 VITE_POCKETBASE_URL（或 POCKETBASE_URL）、POCKETBASE_ADMIN_EMAIL、POCKETBASE_ADMIN_PASSWORD。');
  process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);
try {
  await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
} catch {
  if (!pb.admins?.authWithPassword) throw new Error('PocketBase 管理者登入失敗');
  await pb.admins.authWithPassword(adminEmail, adminPassword);
}

const existing = await pb.collection(PB.assets).getFullList({ fields: 'id,property_id,availability_status,usage_count,current_loan' });
const byPropertyId = new Map(existing.map((row) => [row.property_id, row]));

let inserted = 0;
let updated = 0;
let skipped = 0;
const errors = [];

for (const item of items) {
  const row = mapItem(item);
  const found = byPropertyId.get(row.property_id);
  try {
    if (!found) {
      await pb.collection(PB.assets).create(row);
      inserted += 1;
    } else {
      await pb.collection(PB.assets).update(found.id, {
        name: row.name,
        purchase_date: row.purchase_date,
        service_life: row.service_life,
        specification: row.specification,
        unit: row.unit,
        price: row.price,
        department: row.department,
        location: row.location,
        custodian: row.custodian,
        supplier: row.supplier,
        asset_status: row.asset_status,
        note: row.note,
        brand: row.brand,
        model: row.model
      });
      updated += 1;
    }
  } catch (error) {
    skipped += 1;
    errors.push({ propertyId: row.property_id, message: error.message });
  }
}

console.log(JSON.stringify({
  total: items.length,
  inserted,
  updated,
  skipped,
  unchangedExisting: existing.length,
  errors
}, null, 2));
if (errors.length) process.exit(1);
