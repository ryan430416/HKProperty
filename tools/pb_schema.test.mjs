import { COLLECTIONS, PB, USER_FIELDS } from '../pocketbase/schema.mjs';

const names = COLLECTIONS.map((item) => item.name);
const required = [
  PB.users, PB.assets, PB.loans, PB.reservations, PB.usage,
  PB.audits, PB.locations, PB.logs, PB.settings
];
for (const name of required) {
  if (!names.includes(name)) throw new Error(`schema 缺少集合：${name}`);
}
const userFields = USER_FIELDS.map((field) => field.name);
for (const name of ['name', 'school_number', 'department', 'role', 'active']) {
  if (!userFields.includes(name)) throw new Error(`${PB.users} 缺少欄位：${name}`);
}
const asset = COLLECTIONS.find((item) => item.name === PB.assets);
if (!asset.fields.some((field) => field.name === 'property_id' && field.required)) {
  throw new Error(`${PB.assets}.property_id 必須必填`);
}
if (!asset.fields.some((field) => field.name === 'image')) {
  throw new Error(`${PB.assets} 需有 image 檔案欄位`);
}
const loans = COLLECTIONS.find((item) => item.name === PB.loans);
if (loans.createRule != null) throw new Error('loan_records 應只允許後端 hooks 建立');
const reservations = COLLECTIONS.find((item) => item.name === PB.reservations);
if (!reservations) throw new Error('缺少 asset_reservations');

console.log(JSON.stringify({ ok: true, collections: names }, null, 2));
