import { PB } from '../pocketbase/schema.mjs';
import { getProfile, isStaff } from './authService.js';
import { pbMessage, requireClient } from './pocketbaseClient.js';
import {
  VERIFY_FAIL,
  collapse,
  createPublicToken,
  createRequestNumber,
  hashToken,
  maskPhone,
  normalizePhone,
  phonesMatch,
  validateName,
  validatePhone,
  validateUnit
} from './privacy.js';

const HOOK_MISSING = '借用服務尚未完成伺服器驗證設定，請改洽經辦人員辦理。';

export function mapGuestAsset(row) {
  const status = row.availability_status || 'available';
  const borrowable = row.is_borrowable !== false;
  const available = borrowable && status === 'available';
  return {
    id: row.id,
    propertyId: String(row.property_id || ''),
    name: row.name || '',
    location: row.location || '',
    specification: '',
    availabilityStatus: status,
    available
  };
}

export async function listGuestAssets(options = {}) {
  const client = requireClient();
  const query = collapse(typeof options === 'string' ? options : options.query);
  const location = collapse(options.location || '');
  const availability = collapse(options.availability || '');
  const page = Math.max(1, Number(options.page) || 1);
  const perPage = Math.min(48, Math.max(1, Number(options.perPage) || 12));
  const parts = ['is_active != false'];
  const params = {};
  if (query) {
    parts.push('(property_id ~ {:q} || name ~ {:q})');
    params.q = query;
  }
  if (location) {
    parts.push('location = {:loc}');
    params.loc = location;
  }
  if (availability === 'available') {
    parts.push('availability_status = "available" && is_borrowable != false');
  } else if (availability === 'unavailable') {
    parts.push('(availability_status != "available" || is_borrowable = false)');
  }
  const rows = await client.collection(PB.assetsGuest).getList(page, perPage, {
    filter: parts.join(' && '),
    sort: 'property_id',
    fields: 'id,property_id,name,location,availability_status,is_borrowable,is_active',
    ...params
  });
  return {
    items: (rows.items || []).map(mapGuestAsset),
    totalItems: rows.totalItems || 0,
    page: rows.page || page,
    perPage: rows.perPage || perPage,
    totalPages: rows.totalPages || 1
  };
}

export async function listGuestLocations() {
  const client = requireClient();
  const rows = await client.collection(PB.assetsGuest).getFullList({
    fields: 'location',
    filter: 'is_active != false && location != ""'
  });
  return [...new Set((rows || []).map((row) => collapse(row.location)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

async function postPublic(path, body) {
  const client = requireClient();
  const response = await fetch(`${client.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}

function identityError() {
  const error = new Error(VERIFY_FAIL);
  error.code = 'verify_failed';
  return error;
}

function assertPerson({ unit, name, phone, requireUnit = true }) {
  if (requireUnit) {
    const unitError = validateUnit(unit);
    if (unitError) throw new Error(unitError);
  }
  const nameError = validateName(name);
  if (nameError) throw new Error(nameError);
  const phoneError = validatePhone(phone);
  if (phoneError) throw new Error(phoneError);
}

async function activeLoanExists(assetId) {
  const client = requireClient();
  const rows = await client.collection(PB.borrowSlots).getList(1, 1, {
    filter: `asset = "${assetId}" && (status = "borrowed" || status = "return_pending")`
  });
  return rows.totalItems > 0;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_RESERVATION_MS = 7 * 24 * HOUR_MS;

function hourSlots(startAt, endAt) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!start || !end || end <= start) throw new Error('結束時間必須晚於開始時間');
  if (end - start > MAX_RESERVATION_MS) throw new Error('預借最長 7 天');
  const slots = [];
  for (let cursor = Math.floor(start / HOUR_MS) * HOUR_MS; cursor < end; cursor += HOUR_MS) {
    slots.push(new Date(cursor).toISOString());
    if (slots.length > 168) throw new Error('預借時段過長');
  }
  if (!slots.length) throw new Error('請選擇預借時段');
  return slots;
}

function isUniqueError(error) {
  const fields = error?.data?.data || error?.response?.data || {};
  return Object.values(fields).some((item) => item?.code === 'validation_not_unique');
}

async function reservationConflict(assetId, startAt, endAt) {
  const client = requireClient();
  const slots = new Set(hourSlots(startAt, endAt));
  const locks = await client.collection(PB.lockPublic).getFullList({
    filter: `asset = "${assetId}" && (status = "pending" || status = "approved")`,
    fields: 'id,slot_start,status'
  }).catch(() => []);
  return (locks || []).some((row) => slots.has(row.slot_start));
}

export async function submitBorrow(input) {
  assertPerson(input);
  if (!input.assetId) throw new Error('請先選擇財產');
  if (!collapse(input.purpose)) throw new Error('請填寫用途');
  if (!input.expectedReturnAt) throw new Error('請填寫預計歸還時間');
  if (new Date(input.expectedReturnAt).getTime() <= Date.now()) throw new Error('預計歸還時間必須晚於現在');
  if (!input.privacyAck) throw new Error('請先勾選個資使用告知');
  if (await activeLoanExists(input.assetId)) throw new Error('此財產目前已借出或待歸還，無法再送出借用');

  const token = createPublicToken();
  const payload = {
    assetId: input.assetId,
    unit: collapse(input.unit),
    name: collapse(input.name),
    phone: normalizePhone(input.phone),
    purpose: collapse(input.purpose),
    expectedReturnAt: new Date(input.expectedReturnAt).toISOString(),
    condition: collapse(input.condition),
    notes: collapse(input.notes),
    token,
    privacyAck: true
  };
  const routed = await postPublic('/api/hkp/public/borrow', payload);
  if (routed.status === 200 && routed.data?.requestNumber) {
    return { requestNumber: routed.data.requestNumber, token, via: 'route' };
  }
  if (routed.status && routed.status !== 404) throw new Error(routed.data?.message || HOOK_MISSING);

  const client = requireClient();
  try {
    const record = await client.collection(PB.borrowRequests).create({
      request_number: createRequestNumber('BR'),
      borrower_unit: payload.unit,
      borrower_name: payload.name,
      borrower_phone: payload.phone,
      asset: payload.assetId,
      purpose: payload.purpose,
      requested_at: new Date().toISOString(),
      expected_return_at: payload.expectedReturnAt,
      status: 'pending',
      public_token_hash: await hashToken(token),
      borrower_name_hash: await hashToken(payload.name),
      notes: payload.notes,
      checkout_condition: payload.condition,
      privacy_ack: true
    });
    return { requestNumber: record.request_number, token, via: 'rule' };
  } catch (error) {
    const guest = await client.collection(PB.assetsGuest).getOne(payload.assetId, { fields: 'id,availability_status' }).catch(() => null);
    if (guest?.availability_status && guest.availability_status !== 'available') {
      throw new Error('此財產目前已借出或待歸還，無法再送出借用');
    }
    throw new Error(pbMessage(error, '借用送出失敗'));
  }
}

export async function submitReservation(input) {
  assertPerson(input);
  if (!input.assetId) throw new Error('請先選擇財產');
  if (!input.startAt || !input.endAt) throw new Error('請選擇預借時段');
  if (new Date(input.endAt) <= new Date(input.startAt)) throw new Error('結束時間必須晚於開始時間');
  if (new Date(input.startAt) <= new Date()) throw new Error('不可預借過去時間');
  if (!collapse(input.purpose)) throw new Error('請填寫用途');
  if (!input.privacyAck) throw new Error('請先勾選個資使用告知');
  if (await reservationConflict(input.assetId, input.startAt, input.endAt)) throw new Error('此時段與其他有效預借重疊');

  const slots = hourSlots(input.startAt, input.endAt);
  const token = createPublicToken();
  const payload = {
    assetId: input.assetId,
    unit: collapse(input.unit),
    name: collapse(input.name),
    phone: normalizePhone(input.phone),
    purpose: collapse(input.purpose),
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
    notes: collapse(input.notes),
    token,
    privacyAck: true
  };
  const client = requireClient();
  const number = createRequestNumber('RV');
  const tokenHash = await hashToken(token);
  const nameHash = await hashToken(payload.name);
  const created = [];
  try {
    for (const slot of slots) {
      const row = await client.collection(PB.timeLocks).create({
        reservation_number: number,
        asset: payload.assetId,
        slot_start: slot,
        start_at: payload.startAt,
        end_at: payload.endAt,
        borrower_unit: payload.unit,
        borrower_name: payload.name,
        borrower_name_hash: nameHash,
        borrower_phone: payload.phone,
        purpose: payload.purpose,
        notes: payload.notes,
        status: 'pending',
        public_token_hash: tokenHash,
        privacy_ack: true
      });
      created.push(row);
    }
  } catch (error) {
    if (created.length) {
      await Promise.all(created.map((row) => client.collection(PB.timeLocks).update(row.id, {
        status: 'cancelled',
        slot_start: `released:${row.id}`
      }, {
        headers: {
          'x-hkp-token': tokenHash,
          'x-hkp-name': nameHash,
          'x-hkp-phone': payload.phone
        }
      }).catch(() => {})));
    }
    if (isUniqueError(error)) throw new Error('此時段與其他有效預借重疊');
    throw new Error(pbMessage(error, '預借送出失敗'));
  }
  return { requestNumber: number, token, via: 'lock' };
}

function verifyHeaders(input) {
  return Promise.all([hashToken(input.token), hashToken(collapse(input.name))]).then(([tokenHash, nameHash]) => ({
    headers: {
      'x-hkp-token': tokenHash,
      'x-hkp-name': nameHash,
      'x-hkp-phone': normalizePhone(input.phone)
    }
  }));
}

async function findVerifiedBorrow(input) {
  const client = requireClient();
  const { headers } = await verifyHeaders(input);
  const rows = await client.collection(PB.borrowVerify).getList(1, 1, {
    filter: `request_number = "${collapse(input.requestNumber)}"`,
    fields: 'id,request_number,status,asset',
    headers
  });
  const row = rows.items?.[0];
  if (!row) throw identityError();
  if (collapse(input.propertyId)) {
    const asset = await client.collection(PB.assetsGuest).getOne(row.asset, { fields: 'id,property_id' }).catch(() => null);
    if (!asset || String(asset.property_id) !== collapse(input.propertyId)) throw identityError();
  }
  return { row, headers };
}

async function findVerifiedLocks(input) {
  const client = requireClient();
  const { headers } = await verifyHeaders(input);
  const rows = await client.collection(PB.lockVerify).getList(1, 1, {
    filter: `reservation_number = "${collapse(input.requestNumber)}"`,
    fields: 'id,reservation_number,status',
    headers
  });
  const row = rows.items?.[0];
  if (!row) throw identityError();
  return { row, headers };
}

export async function lookupBorrow(input) {
  if (!collapse(input.requestNumber) || !collapse(input.token)) throw identityError();
  assertPerson({ ...input, requireUnit: false });
  const routed = await postPublic('/api/hkp/public/lookup', {
    requestNumber: collapse(input.requestNumber),
    token: collapse(input.token),
    name: collapse(input.name),
    phone: normalizePhone(input.phone)
  });
  if (routed.status === 200 && routed.data?.requestNumber) return routed.data;
  if (routed.status && routed.status !== 404) throw identityError();
  try {
    const { row } = await findVerifiedBorrow(input);
    return {
      requestNumber: row.request_number,
      status: row.status,
      phoneMasked: maskPhone(input.phone)
    };
  } catch (error) {
    try {
      const { row } = await findVerifiedLocks(input);
      return {
        requestNumber: row.reservation_number,
        status: row.status,
        phoneMasked: maskPhone(input.phone)
      };
    } catch (lockError) {
      if (error?.code === 'verify_failed' || lockError?.code === 'verify_failed') throw identityError();
      throw identityError();
    }
  }
}

export async function submitReturn(input) {
  if (!collapse(input.requestNumber) || !collapse(input.token) || !collapse(input.propertyId)) throw identityError();
  assertPerson(input);
  if (!collapse(input.condition)) throw new Error('請填寫物品歸還狀況');
  const routed = await postPublic('/api/hkp/public/return', {
    requestNumber: collapse(input.requestNumber),
    token: collapse(input.token),
    name: collapse(input.name),
    phone: normalizePhone(input.phone),
    propertyId: collapse(input.propertyId),
    condition: collapse(input.condition),
    notes: collapse(input.notes)
  });
  if (routed.status === 200) return routed.data || { ok: true };
  if (routed.status && routed.status !== 404) throw identityError();
  try {
    const { row, headers } = await findVerifiedBorrow(input);
    if (row.status !== 'borrowed') throw identityError();
    await requireClient().collection(PB.borrowRequests).update(row.id, { status: 'return_pending' }, { headers });
    return { ok: true };
  } catch (error) {
    if (error?.code === 'verify_failed') throw error;
    throw identityError();
  }
}

export async function cancelReservation(input) {
  if (!collapse(input.requestNumber) || !collapse(input.token)) throw identityError();
  assertPerson({ ...input, requireUnit: false });
  const routed = await postPublic('/api/hkp/public/cancel', {
    requestNumber: collapse(input.requestNumber),
    token: collapse(input.token),
    name: collapse(input.name),
    phone: normalizePhone(input.phone)
  });
  if (routed.status === 200) return { ok: true };
  if (routed.status && routed.status !== 404) throw identityError();
  try {
    const client = requireClient();
    const { headers } = await verifyHeaders(input);
    const rows = await client.collection(PB.lockVerify).getFullList({
      filter: `reservation_number = "${collapse(input.requestNumber)}" && status = "pending"`,
      fields: 'id,reservation_number,status',
      headers
    });
    if (!rows.length) throw identityError();
    for (const row of rows) {
      await client.collection(PB.timeLocks).update(row.id, {
        status: 'cancelled',
        slot_start: `released:${row.id}`
      }, { headers });
    }
    return { ok: true };
  } catch (error) {
    if (error?.code === 'verify_failed') throw error;
    throw identityError();
  }
}

function requireDesk() {
  if (!isStaff()) throw new Error('請先以經辦或管理者登入');
}

function maskRow(row) {
  return {
    id: row.id,
    number: row.request_number || row.reservation_number || '',
    unit: row.borrower_unit || '',
    name: row.borrower_name || '',
    phoneMasked: maskPhone(row.borrower_phone),
    phone: row.borrower_phone || '',
    asset: row.asset,
    purpose: row.purpose || '',
    status: row.status,
    startAt: row.start_at || row.requested_at || row.borrowed_at || '',
    endAt: row.end_at || row.expected_return_at || '',
    notes: row.notes || '',
    condition: row.checkout_condition || row.condition || ''
  };
}

function deskOptions(status) {
  const options = { sort: '-created', expand: 'asset' };
  if (status) options.filter = `status = "${status}"`;
  return options;
}

async function listReservationDesk(status) {
  const client = requireClient();
  const locks = await client.collection(PB.timeLocks).getFullList(deskOptions(status));
  const groups = new Map();
  for (const row of locks) {
    if (groups.has(row.reservation_number)) continue;
    groups.set(row.reservation_number, {
      ...maskRow(row),
      id: row.reservation_number,
      revealId: row.id,
      collectionName: PB.timeLocks,
      assetName: row.expand?.asset?.name || '',
      propertyId: row.expand?.asset?.property_id || ''
    });
  }
  return [...groups.values()];
}

export async function listDesk(kind, status) {
  requireDesk();
  if (kind === 'reservation') return listReservationDesk(status);
  const client = requireClient();
  const options = deskOptions(status);
  if (kind === 'return') {
    // 歸還佇列併入 borrow_requests；櫃台「待處理」對應 return_pending
    if (!status || status === 'pending') options.filter = 'status = "return_pending"';
    else if (status === 'confirmed' || status === 'returned') options.filter = 'status = "returned"';
  }
  const rows = await client.collection(PB.borrowRequests).getFullList(options);
  return rows.map((row) => ({
    ...maskRow(row),
    revealId: row.id,
    collectionName: PB.borrowRequests,
    assetName: row.expand?.asset?.name || '',
    propertyId: row.expand?.asset?.property_id || ''
  }));
}

export async function revealPhone(collectionName, id) {
  requireDesk();
  const client = requireClient();
  const row = await client.collection(collectionName).getOne(id, { fields: 'id,borrower_phone' });
  try {
    await client.collection(PB.logs).create({
      action: '查看電話',
      entity_type: collectionName,
      entity_id: id,
      actor_name: getProfile()?.display_name || '經辦',
      detail: { event: 'reveal_phone', recordId: id }
    });
  } catch {
    // 紀錄失敗不顯示電話以外的錯誤，也不把電話寫進 log
  }
  return row.borrower_phone || '';
}

async function writeUsage(asset, extra) {
  const client = requireClient();
  const payload = {
    asset: asset.id,
    user_name: extra.userName,
    user_number: 'PUBLIC',
    department: extra.department,
    used_at: extra.usedAt,
    purpose: extra.purpose,
    note: extra.note,
    property_id: asset.property_id || '',
    property_name: asset.name || ''
  };
  return client.collection(PB.usage).create(payload);
}

const deskBusy = new Set();

function lockDesk(id) {
  if (deskBusy.has(id)) throw new Error('處理中，請勿重複送出');
  deskBusy.add(id);
}

export async function confirmCheckout(id) {
  requireDesk();
  lockDesk(id);
  const client = requireClient();
  try {
  const routed = await client.send(`/api/hkp/staff/borrow-confirm`, { method: 'POST', body: { id } }).catch((error) => error);
  if (routed && routed.requestNumber) return routed;
  const row = await client.collection(PB.borrowRequests).getOne(id, { expand: 'asset' });
  if (row.status !== 'pending') throw new Error('此申請不是待確認借出');
  const asset = row.expand?.asset;
  if (!asset?.id) throw new Error('找不到財產');
  if (await activeLoanExists(asset.id)) throw new Error('同一財產不可同時借給兩人');
  const already = await client.collection(PB.borrowRecords).getList(1, 1, { filter: `borrow_request = "${id}"` });
  if (already.totalItems) throw new Error('此申請已確認，請勿重複送出');
  const borrowedAt = new Date().toISOString();
  const updated = await client.collection(PB.borrowRequests).update(id, {
    status: 'borrowed'
  });
  const record = await client.collection(PB.borrowRecords).create({
    borrow_request: id,
    asset: asset.id,
    borrower_unit: row.borrower_unit,
    borrower_name: row.borrower_name,
    borrower_phone: row.borrower_phone,
    purpose: row.purpose || '',
    borrowed_at: borrowedAt,
    expected_return_at: row.expected_return_at,
    status: 'borrowed',
    checkout_condition: row.checkout_condition || '',
    processed_by: getProfile()?.id
  });
  await client.collection(PB.assets).update(asset.id, {
    availability_status: 'checked_out'
  });
  try {
    await writeUsage(asset, {
      userName: row.borrower_name,
      department: row.borrower_unit,
      usedAt: borrowedAt,
      purpose: row.purpose || '借用',
      note: `借用確認 ${row.request_number}`
    });
  } catch (error) {
    await client.collection(PB.borrowRequests).update(id, { status: 'pending' }).catch(() => {});
    await client.collection(PB.borrowRecords).delete(record.id).catch(() => {});
    await client.collection(PB.assets).update(asset.id, {
      availability_status: asset.availability_status || 'available',
      current_loan: asset.current_loan || null
    }).catch(() => {});
    throw new Error(pbMessage(error, '確認借出未完成，狀態已回復'));
  }
  return updated;
  } finally {
    deskBusy.delete(id);
  }
}

export async function reviewReservation(id, action, reason = '') {
  requireDesk();
  lockDesk(id);
  const client = requireClient();
  try {
    const routed = await client.send(`/api/hkp/staff/reservation-review`, {
      method: 'POST',
      body: { id, action, reason: collapse(reason) }
    }).catch((error) => error);
    if (routed && routed.ok) return routed;
    const rows = await client.collection(PB.timeLocks).getFullList({
      filter: `reservation_number = "${id}" && status = "pending"`
    });
    if (!rows.length) throw new Error('只能處理待審核預借');
    const status = action === 'approve' ? 'approved' : 'rejected';
    for (const row of rows) {
      const patch = { status };
      if (status === 'rejected') patch.slot_start = `released:${row.id}`;
      await client.collection(PB.timeLocks).update(row.id, patch);
    }
    return { ok: true, status };
  } finally {
    deskBusy.delete(id);
  }
}

export async function confirmBorrowReturn(id) {
  requireDesk();
  lockDesk(id);
  const client = requireClient();
  try {
    const routed = await client.send(`/api/hkp/staff/borrow-return-confirm`, { method: 'POST', body: { id } }).catch((error) => error);
    if (routed && routed.ok) return routed;
    const borrow = await client.collection(PB.borrowRequests).getOne(id);
    if (borrow.status !== 'return_pending') throw new Error('此筆不是待確認歸還');
    const now = new Date().toISOString();
    await client.collection(PB.borrowRequests).update(id, { status: 'returned' });
    const records = await client.collection(PB.borrowRecords).getFullList({
      filter: `borrow_request = "${id}" && status != "returned"`
    });
    await Promise.all(records.map((record) => client.collection(PB.borrowRecords).update(record.id, {
      status: 'returned',
      returned_at: now,
      returned_by: getProfile()?.id
    })));
    if (borrow.asset) {
      await client.collection(PB.assets).update(borrow.asset, {
        availability_status: 'available',
        current_loan: null
      });
    }
    try {
      await client.collection(PB.logs).create({
        action: '確認歸還',
        entity_type: PB.borrowRequests,
        entity_id: id,
        actor_name: getProfile()?.display_name || '經辦',
        detail: { event: 'confirm_return', recordId: id }
      });
    } catch {
      // 紀錄失敗不回復已完成的歸還，也不寫入電話
    }
    return { ok: true };
  } finally {
    deskBusy.delete(id);
  }
}

/** 舊歸還申請已併入 borrow_requests；保留函式名稱給櫃台 UI。 */
export async function confirmReturn(id) {
  return confirmBorrowReturn(id);
}

export function phonesEqual(left, right) {
  return phonesMatch(left, right);
}

export function friendlyBorrowError(error) {
  return pbMessage(error, error?.message || '無法完成借用作業');
}
