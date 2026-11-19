import { getServiceClient } from '../pb.js';
import { clientError, clientIp, json, methodNotAllowed, rateLimit, readJson, safeError } from '../http.js';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toIsoDate(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function publicNumber(day) {
  const stamp = (day || dayKey(new Date())).replace(/-/g, '');
  return `PUBLIC-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function loanNumber(day) {
  const stamp = (day || dayKey(new Date())).replace(/-/g, '');
  return `LOAN-${stamp}-F${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  try {
    rateLimit(`public-usage-log:${clientIp(req)}`, 20, 60_000);
    const body = await readJson(req);
    if (!body.privacyAck) return clientError(res, 400, 'privacy_required');

    const unit = clean(body.unit);
    const title = clean(body.title);
    const name = clean(body.name);
    const purpose = clean(body.purpose).slice(0, 80);
    const borrowedAt = toIsoDate(body.borrowedAt);
    const returnedAt = toIsoDate(body.returnedAt);
    let borrowerNumber = clean(body.borrowerNumber);
    const note = clean(body.note);

    if (unit.length < 2 || unit.length > 50) return clientError(res, 400, 'unit_required');
    if (!title || title.length > 40) return clientError(res, 400, 'title_required');
    if (name.length < 2 || name.length > 30) return clientError(res, 400, 'name_required');
    if (!purpose) return clientError(res, 400, 'purpose_required');
    if (!borrowedAt || !returnedAt) return clientError(res, 400, 'dates_required');
    if (new Date(returnedAt) < new Date(borrowedAt)) return clientError(res, 400, 'return_before_borrow');
    if (borrowerNumber && borrowerNumber.length < 4) return clientError(res, 400, 'borrower_number_short');

    const client = await getServiceClient();
    let asset = null;
    if (body.assetId) {
      asset = await client.collection('hkp_assets').getOne(body.assetId, {
        fields: 'id,property_id,name,location,is_active,deleted_at'
      });
    } else if (body.propertyId) {
      const rows = await client.collection('hkp_assets').getList(1, 1, {
        filter: `property_id = "${clean(body.propertyId).replace(/"/g, '')}" && is_active != false`,
        fields: 'id,property_id,name,location,is_active,deleted_at'
      });
      asset = rows.items?.[0] || null;
    }
    if (!asset || asset.is_active === false || asset.deleted_at) {
      return clientError(res, 404, 'asset_not_found');
    }

    const day = dayKey(borrowedAt);
    const dup = await client.collection('hkp_loan_records').getList(1, 1, {
      filter: `property_id = "${String(asset.property_id).replace(/"/g, '')}" && borrower_name = "${name.replace(/"/g, '')}" && checkout_at >= "${day} 00:00:00.000Z" && checkout_at <= "${day} 23:59:59.999Z" && status = "returned"`
    }).catch(() => ({ totalItems: 0 }));
    if (dup.totalItems > 0) return clientError(res, 409, 'duplicate_entry');

    if (!borrowerNumber) borrowerNumber = publicNumber(day);
    const number = loanNumber(day);
    const payload = {
      loan_number: number,
      asset: asset.id,
      property_id: asset.property_id,
      property_name: asset.name,
      borrower_name: name,
      borrower_number: borrowerNumber,
      borrower_department: unit,
      borrower_title: title,
      entry_source: 'backfill',
      purpose,
      requested_at: borrowedAt,
      checkout_at: borrowedAt,
      expected_return_at: returnedAt,
      returned_at: returnedAt,
      checkout_method: 'backfill',
      checkout_operator: '公開填報',
      return_operator: '公開填報',
      return_result: '正常歸還',
      return_location: asset.location || '',
      status: 'returned',
      note: note || '公開器材使用紀錄填報'
    };

    let rec;
    try {
      rec = await client.collection('hkp_loan_records').create(payload);
    } catch {
      delete payload.borrower_title;
      delete payload.entry_source;
      payload.checkout_method = 'admin';
      payload.note = `${payload.note}｜職稱:${title}｜來源:backfill`;
      rec = await client.collection('hkp_loan_records').create(payload);
    }

    try {
      await client.collection('hkp_operation_logs').create({
        action: '公開使用紀錄填報',
        entity_type: 'hkp_loan_records',
        entity_id: rec.id,
        asset: asset.id,
        actor_name: 'public',
        detail: { event: 'public_usage_fill', loanNumber: number }
      });
    } catch {
      /* ignore */
    }

    return json(res, 200, {
      loanNumber: number,
      propertyId: asset.property_id,
      propertyName: asset.name
    });
  } catch (error) {
    if (error?.code) return clientError(res, error.status || 400, error.code);
    if (String(error?.message || '').includes('service_credentials')) {
      return clientError(res, 503, 'service_unavailable');
    }
    return safeError(res, error);
  }
}
