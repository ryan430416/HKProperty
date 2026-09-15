import { getServiceClient, publicAssetFields } from '../pb.js';
import { clientError, clientIp, json, methodNotAllowed, rateLimit, readJson, safeError } from '../http.js';
import { hashToken, maskPhone } from '../security.js';
import { RESERVATION_STATUS_LABEL } from '../status.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    rateLimit(`reservations-lookup:${clientIp(req)}`, 30, 60_000);
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

    let asset = null;
    try {
      const full = await client.collection('hkp_assets').getOne(row.asset, {
        fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active,enabled,deleted_at'
      });
      asset = publicAssetFields(full);
    } catch {
      asset = null;
    }

    return json(res, 200, {
      requestNo: row.request_no,
      status: row.status,
      statusLabel: RESERVATION_STATUS_LABEL[row.status] || row.status,
      purpose: row.purpose || '',
      borrowDate: row.borrow_date,
      expectedReturnDate: row.expected_return_date,
      phoneMasked: maskPhone(row.borrower_phone),
      canCancel: row.status === 'pending',
      asset
    });
  } catch (error) {
    if (String(error?.message || '').includes('service_credentials')) return clientError(res, 503, 'service_unavailable');
    return safeError(res, error);
  }
}
