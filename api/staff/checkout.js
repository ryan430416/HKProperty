import { getStaffClient } from '../../server/pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../../server/http.js';
import { assertTransition, RESERVATION_STATUS } from '../../server/status.js';

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
    const idem = String(body.idempotencyKey || body.id || '').trim();
    const row = await loadReservation(client, body.id || body.requestNo);

    if (row.status === RESERVATION_STATUS.CHECKED_OUT || row.status === RESERVATION_STATUS.RETURN_REQUESTED || row.status === RESERVATION_STATUS.OVERDUE) {
      return json(res, 200, { ok: true, id: row.id, status: row.status, idempotent: true });
    }
    assertTransition(row.status, RESERVATION_STATUS.CHECKED_OUT);

    if (idem) {
      const existing = await client.collection('hkp_usage_records').getList(1, 1, {
        filter: `note ~ "idem:${idem.replace(/"/g, '')}"`
      }).catch(() => ({ totalItems: 0, items: [] }));
      if (existing.totalItems > 0) {
        return json(res, 200, { ok: true, id: row.id, status: RESERVATION_STATUS.CHECKED_OUT, idempotent: true });
      }
    }

    const now = new Date().toISOString();
    const updated = await client.collection('hkp_reservations').update(row.id, {
      status: RESERVATION_STATUS.CHECKED_OUT,
      checked_out_at: now,
      handled_by: user.id,
      condition_out: String(body.condition || '').trim(),
      idempotency_key: idem || row.idempotency_key || ''
    });

    await client.collection('hkp_usage_records').create({
      asset: row.asset,
      user_name: row.borrower_name,
      department: row.borrower_unit,
      purpose: row.purpose,
      used_at: now,
      property_id: '',
      property_name: '',
      note: idem ? `idem:${idem};reservation:${row.id}` : `reservation:${row.id}`
    });

    const asset = await client.collection('hkp_assets').getOne(row.asset, { fields: 'id,usage_count' });
    await client.collection('hkp_assets').update(row.asset, {
      availability_status: 'checked_out',
      usage_count: Number(asset.usage_count || 0) + 1
    });

    return json(res, 200, { ok: true, id: updated.id, status: updated.status });
  } catch (error) {
    if (error?.message?.includes('不允許')) return clientError(res, 409, 'invalid_transition');
    return safeError(res, error);
  }
}
