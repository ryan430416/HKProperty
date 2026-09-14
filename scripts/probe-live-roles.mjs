const URL = 'https://db.keson.pro';

async function probe(path) {
  const response = await fetch(`${URL}${path}`);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  const items = Array.isArray(body?.items) ? body.items.length : null;
  const total = body?.totalItems ?? null;
  const keys = Array.isArray(body?.items) && body.items[0] ? Object.keys(body.items[0]).filter((key) => !['id', 'collectionId', 'collectionName'].includes(key)).sort() : [];
  return {
    path,
    status: response.status,
    total,
    items,
    keys,
    message: body?.message || ''
  };
}

const paths = [
  '/api/collections/hkp_assets_guest/records?perPage=1',
  '/api/collections/hkp_assets/records?perPage=1',
  '/api/collections/hkp_borrow_requests/records?perPage=1',
  '/api/collections/hkp_reservations_v2/records?perPage=1',
  '/api/collections/hkp_borrow_records/records?perPage=1',
  '/api/collections/hkp_return_requests/records?perPage=1',
  '/api/collections/hkp_staff_users/records?perPage=1',
  '/api/collections/hkp_operation_logs/records?perPage=1',
  '/api/collections/hkp_assets_public/records?perPage=1',
  '/api/collections/borrow_requests/records?perPage=1',
  '/api/collections/reservations/records?perPage=1',
  '/api/collections/staff_users/records?perPage=1'
];

const rows = [];
for (const path of paths) rows.push(await probe(path));
const route = await fetch(`${URL}/api/hkp/public/borrow`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}'
});
rows.push({ path: 'POST /api/hkp/public/borrow', status: route.status });
console.log(JSON.stringify(rows, null, 2));
