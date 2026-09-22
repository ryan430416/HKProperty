import { getServiceClient, publicAssetFields } from '../pb.js';
import { clientError, clientIp, json, methodNotAllowed, rateLimit, safeError } from '../http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  try {
    rateLimit(`public-assets:${clientIp(req)}`, 60, 60_000);
    const url = new URL(req.url, 'http://localhost');
    const q = String(url.searchParams.get('q') || '').trim();
    const location = String(url.searchParams.get('location') || '').trim();
    const availableOnly = url.searchParams.get('available') === '1';
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('perPage') || 20)));

    const client = await getServiceClient();
    const filters = [
      '(deleted_at = "" || deleted_at = null)',
      'is_active = true',
      '(enabled = true || enabled = null)',
      // Exclude smoke / preview temporary property ids from public catalog.
      'property_id !~ "PROD-SMOKE-TMP-" && property_id !~ "PREVIEW-TMP-"'
    ];
    if (availableOnly) {
      filters.push('availability_status = "available"');
      filters.push('is_borrowable = true');
    }
    if (location) filters.push(`location = "${location.replace(/"/g, '')}"`);
    if (q) {
      const safe = q.replace(/"/g, '');
      filters.push(`(property_id ~ "${safe}" || name ~ "${safe}")`);
    }

    const list = await client.collection('hkp_assets').getList(page, perPage, {
      filter: filters.join(' && '),
      sort: 'property_id',
      fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active,enabled,deleted_at'
    });

    const items = list.items
      .map(publicAssetFields)
      .filter((item) => item.propertyId && !/^(PROD-SMOKE-TMP-|PREVIEW-TMP-)/i.test(item.propertyId));

    return json(res, 200, {
      page: list.page,
      perPage: list.perPage,
      totalItems: list.totalItems,
      totalPages: list.totalPages,
      items
    });
  } catch (error) {
    if (String(error?.message || '').includes('service_credentials')) return clientError(res, 503, 'service_unavailable');
    return safeError(res, error);
  }
}
