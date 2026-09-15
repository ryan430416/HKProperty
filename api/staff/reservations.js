import { getStaffClient } from '../../server/pb.js';
import { json, methodNotAllowed, safeError } from '../../server/http.js';
import { RESERVATION_STATUS_LABEL } from '../../server/status.js';
import { maskPhone } from '../../server/security.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  try {
    const { client } = await getStaffClient(req.headers.authorization);
    const url = new URL(req.url, 'http://localhost');
    const status = String(url.searchParams.get('status') || '').trim();
    const filter = status ? `status = "${status.replace(/"/g, '')}"` : '';
    const rows = await client.collection('hkp_reservations').getFullList({
      filter,
      sort: '-created',
      expand: 'asset'
    });
    return json(res, 200, {
      items: rows.map((row) => ({
        id: row.id,
        requestNo: row.request_no,
        status: row.status,
        statusLabel: RESERVATION_STATUS_LABEL[row.status] || row.status,
        borrowerUnit: row.borrower_unit,
        borrowerName: row.borrower_name,
        phoneMasked: maskPhone(row.borrower_phone),
        phone: row.borrower_phone,
        purpose: row.purpose,
        borrowDate: row.borrow_date,
        expectedReturnDate: row.expected_return_date,
        assetId: row.asset,
        propertyId: row.expand?.asset?.property_id || '',
        assetName: row.expand?.asset?.name || '',
        location: row.expand?.asset?.location || ''
      }))
    });
  } catch (error) {
    return safeError(res, error);
  }
}
