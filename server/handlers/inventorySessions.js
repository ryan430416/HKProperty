import { getStaffClient, requireAdmin } from '../pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../http.js';
import { INVENTORY_RESULTS, INVENTORY_SESSION_STATUS } from '../status.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { client } = await getStaffClient(req.headers.authorization);
      const rows = await client.collection('hkp_inventory_sessions').getFullList({ sort: '-started_at' });
      return json(res, 200, { items: rows });
    }
    if (req.method === 'POST') {
      const { client, user } = await getStaffClient(req.headers.authorization);
      const body = await readJson(req);
      const title = String(body.title || '').trim();
      if (!title) return clientError(res, 400, 'title_required');
      const row = await client.collection('hkp_inventory_sessions').create({
        title,
        started_at: new Date().toISOString(),
        status: INVENTORY_SESSION_STATUS.OPEN,
        created_by: user.id,
        note: String(body.note || '').trim()
      });
      return json(res, 200, { item: row });
    }
    if (req.method === 'PATCH') {
      const { client, user } = await getStaffClient(req.headers.authorization);
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return clientError(res, 400, 'id_required');
      if (body.action === 'void') {
        if (user.role !== 'admin') return clientError(res, 403, 'forbidden');
        const updated = await client.collection('hkp_inventory_sessions').update(id, {
          status: INVENTORY_SESSION_STATUS.VOID,
          completed_at: new Date().toISOString()
        });
        return json(res, 200, { item: updated });
      }
      if (body.action === 'complete') {
        const updated = await client.collection('hkp_inventory_sessions').update(id, {
          status: INVENTORY_SESSION_STATUS.COMPLETED,
          completed_at: new Date().toISOString()
        });
        return json(res, 200, { item: updated });
      }
      return clientError(res, 400, 'action_required');
    }
    if (req.method === 'DELETE') {
      const { client } = await requireAdmin(req.headers.authorization);
      const body = await readJson(req);
      if (!body.id) return clientError(res, 400, 'id_required');
      await client.collection('hkp_inventory_sessions').update(body.id, {
        status: INVENTORY_SESSION_STATUS.VOID,
        completed_at: new Date().toISOString()
      });
      return json(res, 200, { ok: true });
    }
    return methodNotAllowed(res);
  } catch (error) {
    return safeError(res, error);
  }
}

export const inventoryResults = INVENTORY_RESULTS;
