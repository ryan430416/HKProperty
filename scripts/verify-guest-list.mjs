import PocketBase from 'pocketbase';
const pb = new PocketBase('https://db.keson.pro');
const result = {};
const page1 = await pb.collection('hkp_assets_guest').getList(1, 12, {
  filter: 'is_active != false',
  sort: 'property_id',
  fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active'
});
result.page1 = page1.items.length;
result.total = page1.totalItems;
result.totalPages = page1.totalPages;
result.has_photo = page1.items.some((row) => Object.prototype.hasOwnProperty.call(row, 'photo'));
result.has_price = page1.items.some((row) => Object.prototype.hasOwnProperty.call(row, 'price'));
const available = await pb.collection('hkp_assets_guest').getList(1, 5, {
  filter: 'is_active != false && availability_status = "available" && is_borrowable != false',
  fields: 'id,property_id,availability_status,is_borrowable'
});
result.available_sample = available.items.length;
const locs = await pb.collection('hkp_assets_guest').getFullList({
  fields: 'location',
  filter: 'is_active != false && location != ""'
});
result.location_count = new Set(locs.map((row) => String(row.location || '').trim()).filter(Boolean)).size;
const assets = await pb.collection('hkp_assets').getList(1, 1).catch(() => ({ totalItems: -1 }));
result.assets_anon = assets.totalItems;
console.log(JSON.stringify(result));
if (result.total !== 390 || result.has_photo || result.has_price || result.page1 === 0) process.exitCode = 1;
