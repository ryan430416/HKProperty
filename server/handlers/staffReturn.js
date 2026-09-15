import { getStaffClient } from '../pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../http.js';
import { assertTransition, canTransition, RESERVATION_STATUS } from '../status.js';

async function loadReservation(client, idOrNo) {
  const key = String(idOrNo || '').trim();
  try {
    return await client.collection('hkp_reservations').getOne(key);
  } catch {
    return client.collection('hkp_reservations').getFirstListItem(`request_no = "${key.replace(/"/g, '')}"`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    const { client, user } = await getStaffClient(req.headers.authorization);
    const body = await readJson(req);
    const row = await loadReservation(client, body.id || body.requestNo);
    const action = body.action === 'request' ? RESERVATION_STATUS.RETURN_REQUESTED : RESERVATION_STATUS.RETURNED;

    if (row.status === RESERVATION_STATUS.RETURNED) {
      return json(res, 200, { ok: true, id: row.id, status: row.status, idempotent: true });
    }

    if (action === RESERVATION_STATUS.RETURN_REQUESTED) {
      assertTransition(row.status, RESERVATION_STATUS.RETURN_REQUESTED);
      const updated = await client.collection('hkp_reservations').update(row.id, {
        status: RESERVATION_STATUS.RETURN_REQUESTED,
        handled_by: user.id
      });
      return json(res, 200, { ok: true, id: updated.id, status: updated.status });
    }

    if (!canTransition(row.status, RESERVATION_STATUS.RETURNED)) {
      return clientError(res, 409, 'invalid_transition');
    }
    if (!String(body.condition || '').trim()) return clientError(res, 400, 'condition_required');

    const now = new Date().toISOString();
    const updated = await client.collection('hkp_reservations').update(row.id, {
      status: RESERVATION_STATUS.RETURNED,
      returned_at: now,
      actual_return_date: now,
      condition_return: String(body.condition || '').trim(),
      handled_by: user.id,
      staff_note: String(body.note || '').trim()
    });
    if (row.asset) {
      await client.collection('hkp_assets').update(row.asset, { availability_status: 'available' });
    }
    return json(res, 200, { ok: true, id: updated.id, status: updated.status });
  } catch (error) {
    if (error?.message?.includes('不允許')) return clientError(res, 409, 'invalid_transition');
    return safeError(res, error);
  }
}
