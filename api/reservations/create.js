import { getServiceClient, publicAssetFields } from '../../server/pb.js';
import { clientError, clientIp, json, methodNotAllowed, rateLimit, readJson, safeError } from '../../server/http.js';
import { assertPerson, createRequestNo, createVerificationCode, hashToken } from '../../server/security.js';
import { RESERVATION_STATUS } from '../../server/status.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    rateLimit(`reservations-create:${clientIp(req)}`, 20, 60_000);
    const body = await readJson(req);
    const person = assertPerson(body);
    if (!body.assetId) return clientError(res, 400, 'asset_required');
    if (!String(body.purpose || '').trim()) return clientError(res, 400, 'purpose_required');
    if (!body.borrowDate || !body.expectedReturnDate) return clientError(res, 400, 'dates_required');
    const borrowDate = new Date(body.borrowDate);
    const expectedReturnDate = new Date(body.expectedReturnDate);
    if (!(borrowDate.getTime() > 0) || !(expectedReturnDate.getTime() > 0)) return clientError(res, 400, 'dates_invalid');
    if (expectedReturnDate <= borrowDate) return clientError(res, 400, 'return_before_borrow');
    if (!body.privacyAck) return clientError(res, 400, 'privacy_required');

    const client = await getServiceClient();
    const asset = await client.collection('hkp_assets').getOne(body.assetId, {
      fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active,enabled,deleted_at'
    });
    const pub = publicAssetFields(asset);
    if (!pub.available) return clientError(res, 409, 'asset_unavailable');

    const blocking = await client.collection('hkp_reservations').getList(1, 1, {
      filter: `asset = "${asset.id}" && (status = "pending" || status = "approved" || status = "checked_out" || status = "return_requested" || status = "overdue")`
    });
    if (blocking.totalItems > 0) return clientError(res, 409, 'asset_already_reserved');

    const requestNo = createRequestNo();
    const verificationCode = createVerificationCode();
    const row = await client.collection('hkp_reservations').create({
      request_no: requestNo,
      request_group_no: body.requestGroupNo || requestNo,
      verification_hash: hashToken(verificationCode),
      borrower_unit: person.unit,
      borrower_name: person.name,
      borrower_phone: person.phone,
      asset: asset.id,
      purpose: String(body.purpose).trim(),
      borrow_date: borrowDate.toISOString(),
      expected_return_date: expectedReturnDate.toISOString(),
      status: RESERVATION_STATUS.PENDING,
      staff_note: ''
    });

    await client.collection('hkp_assets').update(asset.id, {
      availability_status: 'reserved'
    }).catch(() => {});

    try {
      await client.collection('hkp_operation_logs').create({
        action: '公開預借建立',
        entity_type: 'hkp_reservations',
        entity_id: row.id,
        asset: asset.id,
        actor_name: 'public',
        detail: { event: 'reservation_create', requestNo }
      });
    } catch {
      // ignore log failure
    }

    return json(res, 200, {
      requestNo,
      verificationCode,
      status: RESERVATION_STATUS.PENDING,
      asset: pub
    });
  } catch (error) {
    if (error?.code) return clientError(res, error.status || 400, error.code);
    if (String(error?.message || '').includes('service_credentials')) return clientError(res, 503, 'service_unavailable');
    return safeError(res, error);
  }
}
