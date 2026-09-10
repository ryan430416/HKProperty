import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_rls_policies.sql',
  'supabase/migrations/003_database_functions.sql',
  'supabase/migrations/004_seed_settings.sql'
];

const required = [
  'create table public.profiles',
  'create table public.assets',
  'create table public.loan_records',
  'create table public.usage_records',
  'create table public.inventory_audits',
  'create table public.location_history',
  'create table public.asset_images',
  'create table public.operation_logs',
  'create table public.system_settings',
  'enable row level security',
  'create_loan_request',
  'approve_loan_request',
  'reject_loan_request',
  'checkout_asset',
  'request_asset_return',
  'complete_asset_return',
  'record_asset_usage',
  'record_inventory_audit',
  'update_asset_location',
  'loan_records_one_active_per_asset',
  'handle_new_user',
  'asset-images'
];

const sql = files.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
for (const token of required) {
  if (!sql.includes(token)) throw new Error(`migration 缺少：${token}`);
}
if (sql.includes('with check (true)') && sql.includes('using (true)')) {
  const dangerous = /create policy[\s\S]{0,200}using\s*\(\s*true\s*\)[\s\S]{0,80}with check\s*\(\s*true\s*\)/gi;
  if (dangerous.test(sql)) throw new Error('偵測到過度寬鬆的 RLS 政策');
}

const catalog = JSON.parse(readFileSync(join(root, 'data/inventory.json'), 'utf8'));
if (catalog.count !== 390 && catalog.items.length !== 390) {
  throw new Error('inventory.json 應為 390 筆');
}

console.log(JSON.stringify({ ok: true, migrations: files.length, catalog: catalog.items.length }, null, 2));
