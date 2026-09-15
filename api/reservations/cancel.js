import { getServiceClient } from '../_lib/pb.js';
import { clientError, clientIp, json, methodNotAllowed, rateLimit, readJson, safeError } from '../_lib/http.js';
import { hashToken } from '../_lib/security.js';
import { assertTransition, RESERVATION_STATUS } from '../_lib/status.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    rateLimit(`reservations-cancel:${clientIp(req)}`, 20, 60_000);
    const body = await readJson(req);
    const requestNo = String(body.requestNo || '').trim();
    const verificationCode = String(body.verificationCode || '').trim();
    if (!requestNo || !verificationCode) return clientError(res, 400, 'lookup_required');

    const client = await getServiceClient();
    let row;
    try {
      row = await client.collection('hkp_reservations').getFirstListItem(`request_no = "${requestNo.replace(/"/g, '')}"`);
    } catch {
      return clientError(res, 404, 'not_found');
    }
    if (row.verification_hash !== hashToken(verificationCode)) return clientError(res, 404, 'not_found');
    try {
      assertTransition(row.status, RESERVATION_STATUS.CANCELLED);
    } catch {
      return clientError(res, 409, 'cannot_cancel');
    }

    await client.collection('hkp_reservations').update(row.id, { status: RESERVATION_STATUS.CANCELLED });
    if (row.asset) {
      await client.collection('hkp_assets').update(row.asset, { availability_status: 'available' }).catch(() => {});
    }
    return json(res, 200, { ok: true, status: RESERVATION_STATUS.CANCELLED });
  } catch (error) {
    if (String(error?.message || '').includes('service_credentials')) return clientError(res, 503, 'service_unavailable');
    return safeError(res, error);
  }
}
