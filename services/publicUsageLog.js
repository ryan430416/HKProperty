/**
 * 公開「器材使用紀錄填報」——免登入，欄位對齊年度 PDF。
 * 寫入路徑：Vercel gateway → PB hook → 直寫 hkp_loan_records（公開 createRule）。
 */
import { PB } from '../pocketbase/schema.mjs';
import { requireClient } from './pocketbaseClient.js';
import { collapse, validateName, validateUnit } from './privacy.js';
import { listGuestAssets, mapGuestAsset } from './publicBorrow.js';

export const USAGE_FILL_PRIVACY =
  '所填資料僅供年度器材使用紀錄填報與社團財產管理使用，不作其他用途。';

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** date / datetime-local → ISO（中午，對齊年度表僅記日期） */
export function fillDateToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

export function validateUsageFill(payload) {
  const propertyId = collapse(payload.propertyId);
  const unit = collapse(payload.unit || payload.borrowerDepartment);
  const title = collapse(payload.title || payload.borrowerTitle);
  const name = collapse(payload.name || payload.borrowerName);
  const purpose = collapse(payload.purpose);
  const borrowedAt = fillDateToIso(payload.borrowedAt || payload.checkoutAt);
  const returnedAt = fillDateToIso(payload.returnedAt);
  const borrowerNumber = collapse(payload.borrowerNumber || payload.borrowerId);

  if (!propertyId && !payload.assetId) return '請先選擇財產';
  const unitErr = validateUnit(unit);
  if (unitErr) return unitErr;
  if (!title || title.length > 40) return '請填寫職稱（40 字以內）';
  const nameErr = validateName(name);
  if (nameErr) return nameErr;
  if (!purpose || purpose.length > 80) return '請填寫借用用途（80 字以內）';
  if (!borrowedAt) return '請填寫借用日期';
  if (!returnedAt) return '請填寫歸還日期';
  if (new Date(returnedAt) < new Date(borrowedAt)) return '歸還日期不得早於借用日期';
  if (borrowerNumber && borrowerNumber.length < 4) return '學號或教職員編號至少 4 個字元';
  if (!payload.privacyAck) return '請先勾選個資使用告知';
  return '';
}

function publicNumber() {
  const stamp = dayKey(new Date()).replace(/-/g, '');
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `PUBLIC-${stamp}-${hex}`;
}

function loanNumberFor(checkoutAt) {
  const day = dayKey(checkoutAt).replace(/-/g, '') || '00000000';
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `LOAN-${day}-F${hex}`;
}

export async function listUsageFillAssets(options = {}) {
  return listGuestAssets({
    query: options.q || options.query || '',
    location: options.location || '',
    availability: '',
    page: options.page || 1,
    perPage: options.perPage || 12
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function resolveAsset(payload) {
  const client = requireClient();
  if (payload.assetId) {
    try {
      const row = await client.collection(PB.assetsGuest).getOne(payload.assetId, {
        fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active'
      });
      return mapGuestAsset(row);
    } catch {
      /* fall through */
    }
  }
  const propertyId = collapse(payload.propertyId);
  if (!propertyId) return null;
  const rows = await client.collection(PB.assetsGuest).getList(1, 1, {
    filter: 'property_id = {:pid} && is_active != false',
    fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active',
    pid: propertyId
  });
  return rows.items?.[0] ? mapGuestAsset(rows.items[0]) : null;
}

async function createDirect(payload, asset) {
  const client = requireClient();
  const checkoutAt = fillDateToIso(payload.borrowedAt || payload.checkoutAt);
  const returnedAt = fillDateToIso(payload.returnedAt);
  const body = {
    loan_number: loanNumberFor(checkoutAt),
    asset: asset.id,
    property_id: asset.propertyId,
    property_name: asset.name,
    borrower_name: collapse(payload.name || payload.borrowerName),
    borrower_number: collapse(payload.borrowerNumber || payload.borrowerId) || publicNumber(),
    borrower_department: collapse(payload.unit || payload.borrowerDepartment),
    borrower_title: collapse(payload.title || payload.borrowerTitle),
    entry_source: 'backfill',
    purpose: collapse(payload.purpose).slice(0, 80),
    requested_at: checkoutAt,
    checkout_at: checkoutAt,
    expected_return_at: returnedAt,
    returned_at: returnedAt,
    checkout_method: 'backfill',
    checkout_operator: '公開填報',
    return_operator: '公開填報',
    return_result: '正常歸還',
    return_location: asset.location || '',
    status: 'returned',
    note: collapse(payload.note) || '公開器材使用紀錄填報'
  };
  // 不帶 Authorization，避免殘留登入 token 擋住公開 createRule
  const response = await fetch(`${client.baseUrl}/api/collections/${PB.loans}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let rec = null;
  try {
    rec = await response.json();
  } catch {
    rec = null;
  }
  if (!response.ok) {
    const err = new Error(rec?.message || '無法寫入使用紀錄');
    err.status = response.status;
    err.data = rec;
    throw err;
  }
  return {
    id: rec.id,
    loanNumber: rec.loan_number,
    propertyId: rec.property_id,
    propertyName: rec.property_name
  };
}

/**
 * @param {object} payload
 * @returns {Promise<{loanNumber:string,propertyId:string,propertyName:string,via:string}>}
 */
export async function submitPublicUsageFill(payload) {
  const error = validateUsageFill(payload);
  if (error) {
    const err = new Error(error);
    err.code = 'validation';
    throw err;
  }

  const asset = await resolveAsset(payload);
  if (!asset?.id) {
    const err = new Error('找不到財產，請確認財產編號');
    err.code = 'asset_not_found';
    throw err;
  }

  const apiBody = {
    assetId: asset.id,
    propertyId: asset.propertyId,
    unit: collapse(payload.unit || payload.borrowerDepartment),
    title: collapse(payload.title || payload.borrowerTitle),
    name: collapse(payload.name || payload.borrowerName),
    purpose: collapse(payload.purpose).slice(0, 80),
    borrowedAt: fillDateToIso(payload.borrowedAt || payload.checkoutAt),
    returnedAt: fillDateToIso(payload.returnedAt),
    borrowerNumber: collapse(payload.borrowerNumber || payload.borrowerId) || '',
    note: collapse(payload.note),
    privacyAck: true
  };

  const gateway = await postJson('/api/public/usage-log', apiBody);
  if (gateway.status >= 200 && gateway.status < 300 && gateway.data?.loanNumber) {
    return { ...gateway.data, via: 'gateway' };
  }
  // 503／404／403（service 規則未開）都改走 hook／直寫，避免正式站卡死
  const gatewaySoft = new Set([403, 404, 503]);
  const gatewayCode = String(gateway.data?.error || '');
  if (
    gateway.status
    && !gatewaySoft.has(gateway.status)
    && gatewayCode !== 'service_unavailable'
    && gatewayCode !== 'forbidden'
  ) {
    const err = new Error(gateway.data?.message || gateway.data?.error || '送出失敗');
    err.code = gateway.data?.error || 'request_failed';
    err.status = gateway.status;
    if (gateway.status < 500) throw err;
  }

  const client = requireClient();
  const hooked = await postJson(`${client.baseUrl}/api/hkp/public/usage-log`, apiBody);
  if (hooked.status >= 200 && hooked.status < 300 && hooked.data?.loanNumber) {
    return { ...hooked.data, via: 'hook' };
  }
  if (hooked.status && hooked.status !== 404) {
    const msg = hooked.data?.message || hooked.data?.data?.message || hooked.data?.error || '';
    if (hooked.status < 500 && msg) {
      const err = new Error(String(msg).replace(/^.*?:\s*/, '') || '送出失敗');
      err.code = 'hook_failed';
      err.status = hooked.status;
      throw err;
    }
  }

  try {
    const direct = await createDirect(apiBody, asset);
    return { ...direct, via: 'direct' };
  } catch (error) {
    const message = error?.message || String(error);
    if (/403|401|only superusers|failed to create/i.test(message)) {
      const err = new Error('公開填報服務尚未就緒，請稍後再試或洽經辦人員');
      err.code = 'service_unavailable';
      throw err;
    }
    throw error;
  }
}
