import PocketBase from 'pocketbase';
import { isOperationalAsset, isSoftDeletedRow } from '../shared/assetLifecycle.js';

let cached = { token: '', expiresAt: 0, client: null };

export function publicAssetFields(row) {
  const status = String(row.availability_status || '');
  const operational = isOperationalAsset(row);
  const borrowable = operational && row.is_borrowable !== false && status === 'available';
  return {
    id: row.id,
    propertyId: row.property_id || '',
    name: row.name || '',
    location: row.location || '',
    available: borrowable,
    availabilityLabel: borrowable ? '可預借' : '目前不可預借'
  };
}

export { isOperationalAsset, isSoftDeletedRow };

export function getPbUrl() {
  return process.env.POCKETBASE_URL || '';
}

export function createPb() {
  const url = getPbUrl();
  if (!url) throw new Error('POCKETBASE_URL_missing');
  return new PocketBase(url);
}

/** Service account for public write/read whitelist only. Never a superuser. */
export async function getServiceClient() {
  const email = process.env.POCKETBASE_SERVICE_EMAIL;
  const password = process.env.POCKETBASE_SERVICE_PASSWORD;
  if (!email || !password) throw new Error('service_credentials_missing');
  const now = Date.now();
  if (cached.client && cached.token && cached.expiresAt > now + 30_000) {
    cached.client.authStore.save(cached.token, cached.client.authStore.record);
    return cached.client;
  }
  const client = createPb();
  const auth = await client.collection('hkp_staff_users').authWithPassword(email, password);
  if (auth?.record?.role !== 'service' || auth?.record?.is_active === false || auth?.record?.active === false) {
    client.authStore.clear();
    throw new Error('service_role_invalid');
  }
  cached = {
    client,
    token: client.authStore.token,
    expiresAt: now + 10 * 60 * 1000
  };
  return client;
}

/** Staff/admin operations: trust the caller's PocketBase token, never frontend role. */
export async function getStaffClient(authHeader) {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  const client = createPb();
  client.authStore.save(token, null);
  const refreshed = await client.collection('hkp_staff_users').authRefresh();
  const record = refreshed.record;
  const active = record.active !== false && record.is_active !== false;
  if (!active || !['staff', 'admin'].includes(record.role)) {
    const err = new Error('forbidden');
    err.status = 403;
    throw err;
  }
  return { client, user: record };
}

export async function requireAdmin(authHeader) {
  const ctx = await getStaffClient(authHeader);
  if (ctx.user.role !== 'admin') {
    const err = new Error('forbidden');
    err.status = 403;
    throw err;
  }
  return ctx;
}
