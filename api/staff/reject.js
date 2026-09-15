import { getStaffClient } from '../_lib/pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../_lib/http.js';
import { assertTransition, RESERVATION_STATUS } from '../_lib/status.js';

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
    assertTransition(row.status, RESERVATION_STATUS.REJECTED);
    const updated = await client.collection('hkp_reservations').update(row.id, {
      status: RESERVATION_STATUS.REJECTED,
      handled_by: user.id,
      approval_note: String(body.reason || body.note || '').trim() || '已拒絕'
    });
    if (row.asset) {
      await client.collection('hkp_assets').update(row.asset, { availability_status: 'available' }).catch(() => {});
    }
    return json(res, 200, { ok: true, id: updated.id, status: updated.status });
  } catch (error) {
    if (error?.message?.includes('不允許')) return clientError(res, 409, 'invalid_transition');
    return safeError(res, error);
  }
}
