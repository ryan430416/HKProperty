import { COLLECTIONS, PB, USER_EXTRA_FIELDS } from '../pocketbase/schema.mjs';

const names = COLLECTIONS.map((item) => item.name);
const required = [PB.users, PB.assets, PB.loans, PB.usage, PB.audits, PB.locations, PB.logs, PB.settings];
for (const name of required) {
  if (!names.includes(name)) throw new Error(`schema 缺少集合：${name}`);
}
if (names.includes('users')) throw new Error('不可改用共用 users 集合');
const userFields = USER_EXTRA_FIELDS.map((field) => field.name);
for (const name of ['display_name', 'school_number', 'department', 'role', 'is_active']) {
  if (!userFields.includes(name)) throw new Error(`${PB.users} 缺少欄位：${name}`);
}
const asset = COLLECTIONS.find((item) => item.name === PB.assets);
if (!asset.fields.some((field) => field.name === 'property_id' && field.required)) {
  throw new Error(`${PB.assets}.property_id 必須必填`);
}
const users = COLLECTIONS.find((item) => item.name === PB.users);
if (users.type !== 'auth') throw new Error(`${PB.users} 必須是 auth 集合`);

console.log(JSON.stringify({ ok: true, collections: names }, null, 2));
