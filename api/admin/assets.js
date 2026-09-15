import { requireAdmin } from '../../server/pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../../server/http.js';

export default async function handler(req, res) {
  try {
    const { client, user } = await requireAdmin(req.headers.authorization);
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('perPage') || 50)));
      const q = String(url.searchParams.get('q') || '').trim().replace(/"/g, '');
      const filter = q ? `(property_id ~ "${q}" || name ~ "${q}")` : '';
      const list = await client.collection('hkp_assets').getList(page, perPage, {
        filter,
        sort: 'property_id'
      });
      return json(res, 200, list);
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!body.propertyId || !body.name) return clientError(res, 400, 'fields_required');
      const row = await client.collection('hkp_assets').create({
        property_id: String(body.propertyId).trim(),
        name: String(body.name).trim(),
        location: String(body.location || '').trim(),
        current_location: String(body.currentLocation || body.location || '').trim(),
        availability_status: 'available',
        is_active: true,
        is_borrowable: body.borrowable !== false,
        enabled: true,
        usage_count: 0
      });
      await client.collection('hkp_operation_logs').create({
        action: '新增財產',
        entity_type: 'hkp_assets',
        entity_id: row.id,
        asset: row.id,
        actor: user.id,
        actor_name: user.name || user.email,
        detail: { event: 'asset_create' }
      }).catch(() => {});
      return json(res, 200, { item: row });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      if (!body.id) return clientError(res, 400, 'id_required');
      if (body.action === 'soft_delete') {
        if (!String(body.reason || '').trim()) return clientError(res, 400, 'reason_required');
        const updated = await client.collection('hkp_assets').update(body.id, {
          deleted_at: new Date().toISOString(),
          is_active: false,
          enabled: false,
          is_borrowable: false
        });
        await client.collection('hkp_operation_logs').create({
          action: '軟刪財產',
          entity_type: 'hkp_assets',
          entity_id: body.id,
          asset: body.id,
          actor: user.id,
          actor_name: user.name || user.email,
          detail: { event: 'asset_soft_delete', reason: String(body.reason).trim() }
        }).catch(() => {});
        return json(res, 200, { item: updated });
      }
      const patch = {};
      for (const [key, field] of Object.entries({
        name: 'name',
        location: 'location',
        currentLocation: 'current_location',
        note: 'note',
        enabled: 'enabled',
        is_borrowable: 'is_borrowable',
        is_active: 'is_active',
        availability_status: 'availability_status'
      })) {
        if (body[key] !== undefined) patch[field] = body[key];
      }
      const updated = await client.collection('hkp_assets').update(body.id, patch);
      return json(res, 200, { item: updated });
    }
    return methodNotAllowed(res);
  } catch (error) {
    return safeError(res, error);
  }
}
