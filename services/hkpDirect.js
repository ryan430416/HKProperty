import { PB } from '../pocketbase/schema.mjs';
import { pbMessage, requireClient } from './pocketbaseClient.js';

function relationId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.id || '';
}

function nowIso() {
  return new Date().toISOString();
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function authRecord() {
  const client = requireClient();
  const record = client.authStore.record;
  if (!record) throw new Error('請先登入');
  return record;
}

function isStaff(auth = authRecord()) {
  return auth.role === 'staff' || auth.role === 'admin';
}

function isAdmin(auth = authRecord()) {
  return auth.role === 'admin';
}

function displayName(auth = authRecord()) {
  return auth.name || auth.display_name || auth.email || '使用者';
}

async function logOp(action, entityType, entityId, assetId, detail) {
  const client = requireClient();
  const auth = authRecord();
  try {
    await client.collection(PB.logs).create({
      action,
      entity_type: entityType,
      entity_id: entityId || '',
      asset: assetId || '',
      actor: auth.id,
      actor_name: displayName(auth),
      detail: detail || {}
    });
  } catch {
    // 操作紀錄失敗不阻擋主流程
  }
}

async function settingsRecord() {
  const client = requireClient();
  const rows = await client.collection(PB.settings).getFullList({ sort: '-created' });
  if (!rows[0]) throw new Error('尚未建立系統設定');
  return rows[0];
}

async function recountUsage(assetId) {
  const client = requireClient();
  const rows = await client.collection(PB.usage).getFullList({
    filter: `asset = "${assetId}"`,
    fields: 'id'
  });
  return Math.max(0, rows.length);
}

async function syncUsageCount(assetId) {
  const counted = await recountUsage(assetId);
  if (!isStaff()) return counted;
  try {
    await requireClient().collection(PB.assets).update(assetId, { usage_count: counted });
  } catch (error) {
    console.error('[HKProperty PocketBase]', {
      scope: 'usage_count',
      status: error?.status || null,
      message: error?.message || '無法同步使用次數'
    });
  }
  return counted;
}

async function createUsageRecord(asset, extra = {}) {
  const client = requireClient();
  const auth = authRecord();
  const payload = {
    asset: asset.id,
    user_name: trim(extra.user_name),
    user_number: trim(extra.user_number),
    department: trim(extra.department),
    used_at: extra.used_at,
    purpose: trim(extra.purpose),
    note: trim(extra.note),
    created_by: auth.id,
    user: auth.id,
    property_id: asset.property_id || '',
    property_name: asset.name || ''
  };
  if (extra.loan) payload.loan = extra.loan;
  const optional = ['user_number', 'user', 'property_id', 'property_name', 'loan'];
  let lastError;
  for (let attempt = 0; attempt < optional.length + 1; attempt += 1) {
    try {
      return await client.collection(PB.usage).create(payload);
    } catch (error) {
      lastError = error;
      const fields = Object.keys(error?.data?.data || {});
      const unknown = fields.find((field) => optional.includes(field) && payload[field] != null);
      if ((error?.status === 400 || error?.data?.code === 400) && unknown) {
        delete payload[unknown];
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function requireAsset(id) {
  const client = requireClient();
  try {
    const asset = await client.collection(PB.assets).getOne(id);
    if (!asset || asset.is_active === false) throw new Error('查無此財產編號');
    return asset;
  } catch (error) {
    if (error?.status !== 403 && error?.status !== 404) throw error;
    const asset = await client.collection(PB.assetsPublic).getOne(id);
    if (!asset || asset.is_active === false) throw new Error('查無此財產編號');
    return asset;
  }
}

function nextLoanNumber(existing) {
  const day = nowIso().slice(0, 10).replace(/-/g, '');
  const prefix = `LOAN-${day}-`;
  const same = existing.filter((row) => String(row.loan_number || '').startsWith(prefix));
  return `${prefix}${String(same.length + 1).padStart(4, '0')}`;
}

async function createLoan(body) {
  const client = requireClient();
  const auth = authRecord();
  if (!trim(body.borrower_name)) throw new Error('請填寫借用人姓名');
  if (trim(body.borrower_number).length < 4) throw new Error('學號或教職員編號至少 4 個字元');
  if (!trim(body.borrower_department)) throw new Error('請填寫借用單位、系所或社團');
  if (!trim(body.purpose)) throw new Error('請填寫借用用途');
  if (!body.expected_return_at) throw new Error('請填寫預計歸還日期與時間');
  const checkoutAt = body.checkout_at || nowIso();
  if (new Date(body.expected_return_at) < new Date(checkoutAt)) {
    throw new Error('預計歸還時間不得早於借出時間');
  }
  const method = body.checkout_method || 'self_service';
  if (!isStaff(auth) && method !== 'self_service') throw new Error('借用人只能使用自助借用');
  const asset = await requireAsset(body.asset_id);
  const avail = asset.availability_status;
  if (asset.is_borrowable === false) throw new Error('此財產不可借用');
  if (avail === 'maintenance') throw new Error('此財產維修中，無法辦理借出');
  if (avail === 'lost') throw new Error('此財產狀態為異常，無法辦理借出');
  if (avail === 'checked_out' || avail === 'overdue') throw new Error('此財產目前已借出，不可再次借出');
  if (avail === 'pending') throw new Error('此財產已有待處理的借用申請');
  const loans = await client.collection(PB.loans).getFullList({
    filter: `asset = "${asset.id}" && status != "returned" && status != "rejected" && status != "cancelled"`
  });
  if (loans.length) throw new Error('此財產已有未完成的借用紀錄，不可重複借出');
  const settings = await settingsRecord();
  const pending = settings.require_loan_approval === true && !isStaff(auth);
  const borrowerId = isStaff(auth) && trim(body.borrower_id) ? trim(body.borrower_id) : auth.id;
  const rec = await client.collection(PB.loans).create({
    loan_number: nextLoanNumber(await client.collection(PB.loans).getFullList({ fields: 'loan_number' })),
    asset: asset.id,
    property_id: asset.property_id,
    property_name: asset.name,
    borrower: borrowerId,
    borrower_name: trim(body.borrower_name),
    borrower_number: trim(body.borrower_number),
    borrower_department: trim(body.borrower_department),
    purpose: trim(body.purpose),
    contact: trim(body.contact),
    requested_at: nowIso(),
    checkout_at: pending ? null : checkoutAt,
    expected_return_at: body.expected_return_at,
    checkout_condition: trim(body.checkout_condition),
    checkout_method: method,
    checkout_operator: pending ? '' : (method === 'self_service' ? '自助借用' : displayName(auth)),
    status: pending ? 'pending' : 'checked_out',
    note: trim(body.note)
  });
  try {
    await client.collection(PB.assets).update(asset.id, {
      availability_status: pending ? 'reserved' : 'checked_out',
      current_loan: rec.id
    });
    if (!pending) {
      await createUsageRecord(asset, {
        loan: rec.id,
        user_name: rec.borrower_name,
        user_number: rec.borrower_number,
        department: rec.borrower_department,
        used_at: checkoutAt,
        purpose: rec.purpose,
        note: `借用編號 ${rec.loan_number}`
      });
      await syncUsageCount(asset.id);
    }
  } catch (error) {
    await client.collection(PB.loans).update(rec.id, { status: 'cancelled', note: '寫入未完成，已取消' }).catch(() => {});
    await client.collection(PB.assets).update(asset.id, {
      availability_status: avail,
      current_loan: asset.current_loan || null
    }).catch(() => {});
    throw error;
  }
  await logOp(pending ? '借用申請' : '借出', 'loan', rec.id, asset.id, { loan_number: rec.loan_number });
  return rec;
}

async function completeCheckout(id) {
  const client = requireClient();
  const auth = authRecord();
  if (!isStaff(auth)) throw new Error('沒有借出權限');
  const rec = await client.collection(PB.loans).getOne(id);
  const now = nowIso();
  const updated = await client.collection(PB.loans).update(id, {
    status: 'checked_out',
    checkout_at: now,
    checkout_operator: displayName(auth)
  });
  const assetId = relationId(rec.asset);
  const asset = await requireAsset(assetId);
  await client.collection(PB.assets).update(asset.id, {
    availability_status: 'checked_out',
    current_loan: rec.id
  });
  await createUsageRecord(asset, {
    loan: rec.id,
    user_name: rec.borrower_name,
    user_number: rec.borrower_number,
    department: rec.borrower_department,
    used_at: now,
    purpose: rec.purpose,
    note: `借用編號 ${rec.loan_number}`
  });
  await syncUsageCount(asset.id);
  await logOp('借出', 'loan', rec.id, asset.id, { loan_number: rec.loan_number });
  return updated;
}

async function completeReturn(id, body) {
  const client = requireClient();
  const auth = authRecord();
  const rec = await client.collection(PB.loans).getOne(id);
  if (rec.returned_at || rec.status === 'returned') throw new Error('此筆借用已完成歸還，不可重複歸還');
  let result = trim(body.return_result);
  if (result === '正常') result = '正常歸還';
  let next = 'available';
  if (result === '送修') next = 'maintenance';
  if (result === '遺失') next = 'lost';
  const updated = await client.collection(PB.loans).update(id, {
    status: 'returned',
    returned_at: body.returned_at,
    return_location: trim(body.return_location),
    return_result: result,
    return_condition: trim(body.return_condition),
    return_operator: rec.checkout_method === 'self_service' && !isStaff(auth) ? '自助歸還' : displayName(auth)
  });
  const asset = await requireAsset(relationId(rec.asset));
  const patch = {
    availability_status: next,
    current_loan: null
  };
  if (isStaff(auth)) {
    patch.return_alert = result === '有損壞' ? 'damaged' : result === '配件缺少' ? 'missing_parts' : '';
  }
  if (isStaff(auth) && trim(body.return_location) && trim(body.return_location) !== trim(asset.location || '')) {
    await client.collection(PB.locations).create({
      asset: asset.id,
      from_location: asset.location || '',
      to_location: trim(body.return_location),
      reason: `歸還後更新存放位置（${result}）`,
      operator: auth.id,
      operator_name: displayName(auth)
    });
    patch.location = trim(body.return_location);
  }
  await client.collection(PB.assets).update(asset.id, patch);
  await logOp('歸還', 'loan', rec.id, asset.id, { loan_number: rec.loan_number, result });
  return updated;
}

function overlaps(startAt, endAt, otherStart, otherEnd) {
  return new Date(startAt).getTime() < new Date(otherEnd).getTime()
    && new Date(endAt).getTime() > new Date(otherStart).getTime();
}

async function activeReservationSlots(assetId) {
  const client = requireClient();
  const filter = `asset = "${assetId}" && (status = "pending" || status = "approved")`;
  try {
    return await client.collection(PB.reservationSlots).getFullList({ filter });
  } catch (error) {
    const status = error?.status || error?.data?.code;
    if (status !== 404) throw error;
    if (!isStaff()) throw new Error('無法向 PocketBase 查詢預約衝突，已停止送出');
    return client.collection(PB.reservations).getFullList({ filter });
  }
}

async function createReservation(body) {
  const client = requireClient();
  const auth = authRecord();
  const asset = await requireAsset(body.asset_id);
  if (!trim(body.purpose)) throw new Error('請填寫預約用途');
  if (!body.start_at || !body.end_at) throw new Error('請填寫預約起迄時間');
  if (new Date(body.end_at) <= new Date(body.start_at)) throw new Error('預約結束時間必須晚於開始時間');
  if (new Date(body.start_at).getTime() < Date.now() - 60_000) throw new Error('不可預約過去時間');
  const assetStatus = String(asset.asset_status || '').toLowerCase();
  if (assetStatus && assetStatus !== 'normal' && assetStatus !== '正常') throw new Error('此財產不是正常狀態，無法預約');
  if (asset.is_borrowable === false) throw new Error('此財產不可借用');
  if (asset.availability_status === 'maintenance') throw new Error('此財產維修中，無法預約');
  if (['lost', 'checked_out', 'overdue'].includes(asset.availability_status)) {
    throw new Error('此財產目前不可預約');
  }
  const existing = await activeReservationSlots(asset.id);
  if (existing.some((row) => overlaps(body.start_at, body.end_at, row.start_at, row.end_at))) {
    throw new Error('此時段已有其他待審或已核准的預約');
  }
  const day = nowIso().slice(0, 10).replace(/-/g, '');
  const payload = {
    reservation_number: `RSV-${day}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    asset: asset.id,
    user: auth.id,
    user_name: displayName(auth),
    user_number: auth.school_number || '',
    department: auth.department || '',
    property_id: asset.property_id,
    property_name: asset.name,
    purpose: trim(body.purpose),
    start_at: body.start_at,
    end_at: body.end_at,
    status: 'pending',
    contact: trim(body.contact),
    note: trim(body.note)
  };
  const optional = ['user_number', 'department'];
  let rec;
  let lastError;
  for (let attempt = 0; attempt < optional.length + 1; attempt += 1) {
    try {
      rec = await client.collection(PB.reservations).create(payload);
      break;
    } catch (error) {
      lastError = error;
      const fields = Object.keys(error?.data?.data || {});
      const unknown = fields.find((field) => optional.includes(field));
      if ((error?.status === 400 || error?.data?.code === 400) && unknown) {
        delete payload[unknown];
        continue;
      }
      throw error;
    }
  }
  if (!rec) throw lastError;
  await logOp('預約申請', 'reservation', rec.id, asset.id, { reservation_number: rec.reservation_number });
  return rec;
}

async function approveReservation(id) {
  const client = requireClient();
  const auth = authRecord();
  if (!isStaff(auth)) throw new Error('沒有核准預約的權限');
  const rec = await client.collection(PB.reservations).getOne(id);
  if (rec.status !== 'pending') throw new Error('僅能核准待審核的預約');
  const others = await activeReservationSlots(relationId(rec.asset));
  if (others.some((row) => row.id !== rec.id && overlaps(rec.start_at, rec.end_at, row.start_at, row.end_at))) {
    throw new Error('此時段已有衝突的預約');
  }
  const updated = await client.collection(PB.reservations).update(id, {
    status: 'approved',
    approved_by: auth.id,
    approved_at: nowIso()
  });
  return updated;
}

async function checkoutReservation(id, body = {}) {
  const client = requireClient();
  const auth = authRecord();
  const rec = await client.collection(PB.reservations).getOne(id);
  if (rec.status === 'converted' || rec.converted_loan) throw new Error('此預借已轉成借出，不可重複辦理');
  if (rec.status !== 'approved') throw new Error('僅已核准的預約可辦理借出');
  if (!isStaff(auth) && relationId(rec.user) !== auth.id) throw new Error('只能辦理自己的預約借出');
  const asset = await requireAsset(relationId(rec.asset));
  const number = trim(rec.user_number || body.borrower_number || auth.school_number);
  if (number.length < 4) throw new Error('找不到借用人的學號或教職員編號，無法轉成借出');
  const loan = await createLoan({
    asset_id: asset.id,
    borrower_id: relationId(rec.user),
    borrower_name: rec.user_name || displayName(auth),
    borrower_number: number,
    borrower_department: trim(rec.department || body.borrower_department || auth.department) || '未填單位',
    purpose: rec.purpose,
    expected_return_at: body.expected_return_at || rec.end_at,
    checkout_method: 'reservation',
    contact: rec.contact,
    note: trim(body.note) || trim(rec.note)
  });
  const updated = await client.collection(PB.reservations).update(id, {
    status: 'converted',
    converted_loan: loan.id
  });
  await logOp('預約轉借出', 'reservation', rec.id, asset.id, { loan_number: loan.loan_number });
  return { ...updated, loan };
}

async function rejectReservation(id, reason) {
  const client = requireClient();
  if (!isStaff()) throw new Error('沒有拒絕預約的權限');
  if (!trim(reason)) throw new Error('請填寫拒絕原因');
  return client.collection(PB.reservations).update(id, {
    status: 'rejected',
    rejection_reason: trim(reason)
  });
}

async function cancelReservation(id) {
  const client = requireClient();
  const auth = authRecord();
  const rec = await client.collection(PB.reservations).getOne(id);
  if (!isStaff(auth) && relationId(rec.user) !== auth.id) throw new Error('只能取消自己的預借');
  if (!isStaff(auth) && rec.status !== 'pending') throw new Error('只能取消自己仍在待審核的預借');
  if (isStaff(auth) && !['pending', 'approved'].includes(rec.status)) throw new Error('此預約目前無法取消');
  return client.collection(PB.reservations).update(id, { status: 'cancelled' });
}

async function runHkpDirect(path, body = {}) {
  const client = requireClient();
  const auth = authRecord();
  // Normalize new API paths to existing handlers
  if (path === '/api/hkproperty/loans/checkout') return createLoan({ ...body, checkout_method: body.checkout_method || 'self_service' });
  if (path === '/api/hkproperty/loans/request') return createLoan({ ...body, force_pending: true });
  if (path === '/api/hkproperty/loans/return') {
    return completeReturn(body.loan_id, body);
  }
  if (path === '/api/hkproperty/usage') path = '/api/hkp/usage';
  if (path === '/api/hkproperty/reservations') path = '/api/hkp/reservations';
  const propRsv = path.match(/^\/api\/hkproperty\/reservations\/([^/]+)\/(approve|reject|cancel|checkout)$/);
  if (propRsv) path = `/api/hkp/reservations/${propRsv[1]}/${propRsv[2]}`;
  if (path === '/api/hkproperty/audits') path = '/api/hkp/audits';
  if (path === '/api/hkproperty/settings') path = '/api/hkp/settings';
  const propAsset = path.match(/^\/api\/hkproperty\/assets\/([^/]+)\/(location|active)$/);
  if (propAsset) path = `/api/hkp/assets/${propAsset[1]}/${propAsset[2]}`;
  const propLoan = path.match(/^\/api\/hkproperty\/loans\/([^/]+)\/(approve|reject)$/);
  if (propLoan) path = `/api/hkp/loans/${propLoan[1]}/${propLoan[2]}`;
  const propUser = path.match(/^\/api\/hkproperty\/users\/([^/]+)$/);
  if (propUser) path = `/api/hkp/users/${propUser[1]}`;

  const loanMut = path.match(/^\/api\/hkp\/loans\/([^/]+)\/(approve|reject|checkout|return|return-request)$/);
  if (path === '/api/hkp/loans') return createLoan(body);
  if (loanMut) {
    const [, id, action] = loanMut;
    if (action === 'approve') {
      if (!isStaff(auth)) throw new Error('沒有核准權限');
      const rec = await client.collection(PB.loans).update(id, { status: 'approved', approved_at: nowIso(), approved_by: auth.id });
      await client.collection(PB.assets).update(relationId(rec.asset), { availability_status: 'pending' });
      await logOp('核准', 'loan', id, relationId(rec.asset), { loan_number: rec.loan_number });
      return rec;
    }
    if (action === 'reject') {
      if (!isStaff(auth)) throw new Error('沒有拒絕權限');
      const rec = await client.collection(PB.loans).update(id, { status: 'rejected', rejection_reason: trim(body.reason) });
      const assetId = relationId(rec.asset);
      const asset = await requireAsset(assetId);
      if (relationId(asset.current_loan) === rec.id) {
        await client.collection(PB.assets).update(asset.id, { availability_status: 'available', current_loan: null });
      }
      await logOp('拒絕', 'loan', id, assetId, { reason: trim(body.reason) });
      return rec;
    }
    if (action === 'checkout') return completeCheckout(id);
    if (action === 'return' || action === 'return-request') return completeReturn(id, body);
  }
  if (path === '/api/hkp/usage') {
    const asset = await requireAsset(body.asset_id);
    if (!trim(body.user_name)) throw new Error('請填寫使用人姓名');
    if (trim(body.user_number).length < 4) throw new Error('學號或教職員編號至少 4 個字元');
    if (!trim(body.purpose)) throw new Error('請填寫使用用途');
    if (!body.used_at) throw new Error('請填寫使用時間');
    const rec = await createUsageRecord(asset, {
      user_name: body.user_name,
      user_number: body.user_number,
      department: body.department,
      used_at: body.used_at,
      purpose: body.purpose,
      note: body.note
    });
    const counted = await syncUsageCount(asset.id);
    await logOp('現場使用', 'usage', rec.id, asset.id, { property_id: asset.property_id });
    return { ...rec, usage_count: counted };
  }
  if (path === '/api/hkp/audits') {
    if (!isStaff(auth)) throw new Error('沒有盤點權限');
    const asset = await requireAsset(body.asset_id);
    const rec = await client.collection(PB.audits).create({
      asset: asset.id,
      registered_location: body.registered_location || '',
      actual_location: trim(body.actual_location),
      result: body.result,
      auditor: trim(body.auditor),
      audited_at: body.audited_at || nowIso(),
      note: trim(body.note),
      created_by: auth.id
    });
    let nextAudit = '待盤點';
    if (body.result === '位置正確') nextAudit = '已盤點';
    if (body.result === '位置異常') nextAudit = '位置異常';
    if (body.result === '找不到物品') nextAudit = '找不到物品';
    if (body.result === '物品損壞') nextAudit = '物品損壞';
    await client.collection(PB.assets).update(asset.id, { last_audit_at: rec.audited_at, audit_status: nextAudit });
    await logOp('盤點', 'audit', rec.id, asset.id, { result: body.result });
    return rec;
  }
  const locMut = path.match(/^\/api\/hkp\/assets\/([^/]+)\/location$/);
  if (locMut) {
    if (!isStaff(auth)) throw new Error('沒有修改位置的權限');
    const asset = await requireAsset(locMut[1]);
    await client.collection(PB.locations).create({
      asset: asset.id,
      from_location: trim(body.from_location || asset.location || ''),
      to_location: trim(body.to_location),
      reason: trim(body.reason) || '更新存放位置',
      operator: auth.id,
      operator_name: displayName(auth)
    });
    const updated = await client.collection(PB.assets).update(asset.id, { location: trim(body.to_location) });
    await logOp('位置異動', 'asset', asset.id, asset.id, { to: trim(body.to_location) });
    return updated;
  }
  const activeMut = path.match(/^\/api\/hkp\/assets\/([^/]+)\/active$/);
  if (activeMut) {
    if (!isAdmin(auth)) throw new Error('只有管理者可以停用財產');
    const updated = await client.collection(PB.assets).update(activeMut[1], { is_active: body.is_active !== false });
    await logOp(body.is_active !== false ? '修改財產' : '停用財產', 'asset', updated.id, updated.id, { property_id: updated.property_id, is_active: updated.is_active });
    return updated;
  }
  if (path === '/api/hkp/reservations') return createReservation(body);
  const rsvMut = path.match(/^\/api\/hkp\/reservations\/([^/]+)\/(approve|reject|cancel|checkout)$/);
  if (rsvMut) {
    const [, id, action] = rsvMut;
    if (action === 'approve') return approveReservation(id);
    if (action === 'reject') return rejectReservation(id, body.reason);
    if (action === 'checkout') return checkoutReservation(id, body);
    return cancelReservation(id);
  }
  if (path === '/api/hkp/settings') {
    if (!isAdmin(auth)) throw new Error('只有管理者可以修改系統設定');
    const current = await settingsRecord();
    const updated = await client.collection(PB.settings).update(current.id, {
      require_loan_approval: body.require_loan_approval ?? current.require_loan_approval,
      allow_self_checkout: body.allow_self_checkout ?? current.allow_self_checkout,
      default_loan_days: body.default_loan_days ?? current.default_loan_days,
      updated_by: auth.id
    });
    await logOp('修改系統設定', 'settings', updated.id, '', updated);
    return updated;
  }
  const userMut = path.match(/^\/api\/hkp\/users\/([^/]+)$/);
  if (userMut) {
    if (!isAdmin(auth)) throw new Error('只有管理者可以修改使用者角色');
    const patch = {};
    if (body.role) patch.role = body.role;
    if (body.is_active != null) patch.is_active = !!body.is_active;
    if (body.display_name) patch.display_name = trim(body.display_name);
    if (body.department != null) patch.department = trim(body.department);
    if (body.school_number != null) patch.school_number = trim(body.school_number);
    const updated = await client.collection(PB.users).update(userMut[1], patch);
    await logOp('角色修改', 'profile', updated.id, '', { role: updated.role, is_active: updated.is_active });
    return updated;
  }
  throw new Error(`找不到 API：${path}`);
}

export async function hkpDirect(path, body = {}) {
  try {
    return await runHkpDirect(path, body);
  } catch (error) {
    if (error?.status || error?.data?.code) throw new Error(pbMessage(error));
    throw error;
  }
}
