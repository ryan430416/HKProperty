import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

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
  return {
    property_id: String(item.propertyId),
    name: item.name,
    purchase_date: item.purchaseDate || null,
    service_life: Number.isFinite(item.serviceLife) ? item.serviceLife : null,
    specification: item.specification || null,
    unit: item.unit || null,
    price: item.price ?? null,
    department: item.department || null,
    location: item.location || null,
    custodian: item.custodian || null,
    supplier: item.supplier || null,
    asset_status: item.status === '正常' ? 'normal' : (item.status || 'normal'),
    note: item.note || null,
    brand: item.brand || null,
    model: item.model || null,
    is_borrowable: true,
    is_active: true
  };
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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('請在本機 .env 設定 SUPABASE_URL（或 VITE_SUPABASE_URL）與 SUPABASE_SERVICE_ROLE_KEY。此腳本不可在前端執行。');
  process.exit(1);
}
if (!serviceKey.includes('service_role') && serviceKey.length < 20) {
  console.error('SUPABASE_SERVICE_ROLE_KEY 看起來不正確');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: existing, error: existingError } = await supabase
  .from('assets')
  .select('id, property_id, availability_status, usage_count, current_loan_id');
if (existingError) {
  console.error(existingError.message);
  process.exit(1);
}
const byPropertyId = new Map((existing || []).map((row) => [row.property_id, row]));

let inserted = 0;
let updated = 0;
let skipped = 0;
const errors = [];

for (const item of items) {
  const row = mapItem(item);
  const found = byPropertyId.get(row.property_id);
  try {
    if (!found) {
      const { error } = await supabase.from('assets').insert(row);
      if (error) throw error;
      inserted += 1;
    } else {
      const { error } = await supabase.from('assets').update({
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
      }).eq('property_id', row.property_id);
      if (error) throw error;
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
  unchangedExisting: (existing || []).length,
  errors
}, null, 2));
if (errors.length) process.exit(1);
