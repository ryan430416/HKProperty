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

async function createLoan(_body) {
  // Phase 2: stop writing hkp_loan_records. Use /api/staff/checkout on hkp_reservations.
  throw new Error('舊借出路徑已停用：請改用預借核准後的「確認借出」');
}

async function completeCheckout(_id) {
  throw new Error('舊借出路徑已停用：請改用預借核准後的「確認借出」');
}

async function completeReturn(_id, _body) {
  throw new Error('舊歸還路徑已停用：請改用經辦「確認歸還」');
}

function hourSlots(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  start.setMinutes(0, 0, 0);
  const slots = [];
  for (let t = start.getTime(); t < end.getTime(); t += 3600000) {
    slots.push(new Date(t).toISOString());
  }
  return slots;
}

async function activeReservationSlots(assetId) {
  const client = requireClient();
  const filter = `asset = "${assetId}" && (status = "pending" || status = "approved")`;
  return client.collection(PB.lockPublic).getFullList({
    filter,
    fields: 'id,asset,slot_start,status'
  }).catch(() => []);
}

async function locksByRef(ref) {
  const client = requireClient();
  const key = trim(ref);
  if (!key) return [];
  const byNumber = await client.collection(PB.timeLocks).getFullList({
    filter: `reservation_number = "${key}"`
  }).catch(() => []);
  if (byNumber.length) return byNumber;
  try {
    const one = await client.collection(PB.timeLocks).getOne(key);
    return [one];
  } catch {
    return [];
  }
}

async function createReservation(body) {
  const client = requireClient();
  const auth = authRecord();
  const asset = await requireAsset(body.asset_id);
  if (!trim(body.purpose)) throw new Error('請填寫預約用途');
  if (!body.start_at || !body.end_at) throw new Error('請填寫預約起迄時間');
  if (new Date(body.end_at) <= new Date(body.start_at)) throw new Error('預約結束時間必須晚於開始時間');
  if (asset.is_borrowable === false) throw new Error('此財產不可借用');
  if (['lost', 'checked_out', 'overdue', 'reserved'].includes(asset.availability_status)) {
    throw new Error('此財產目前不可預約');
  }
  const blocking = await client.collection(PB.reservations).getList(1, 1, {
    filter: `asset = "${asset.id}" && (status = "pending" || status = "approved" || status = "checked_out" || status = "return_requested" || status = "overdue")`
  });
  if (blocking.totalItems) throw new Error('此財產已有進行中的預借');
  const requestNo = `RQ-${Date.now().toString(36).toUpperCase()}`;
  const verification = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verification));
  const verificationHash = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const row = await client.collection(PB.reservations).create({
    request_no: requestNo,
    request_group_no: requestNo,
    verification_hash: verificationHash,
    borrower_unit: trim(auth.department) || '櫃台',
    borrower_name: displayName(auth),
    borrower_phone: trim(body.contact) || '0000000000',
    asset: asset.id,
    purpose: trim(body.purpose),
    borrow_date: body.start_at,
    expected_return_date: body.end_at,
    status: 'pending',
    staff_note: trim(body.note)
  });
  await client.collection(PB.assets).update(asset.id, { availability_status: 'reserved' }).catch(() => {});
  await logOp('預約申請', 'reservation', row.id, asset.id, { request_no: requestNo });
  return { ...row, reservation_number: requestNo, start_at: row.borrow_date, end_at: row.expected_return_date };
}

async function approveReservation(id) {
  throw new Error('請改用經辦工作台核准（/api/staff/approve）');
}

async function checkoutReservation(_id, _body = {}) {
  throw new Error('請改用經辦工作台確認借出（/api/staff/checkout）');
}

async function rejectReservation(_id, _reason) {
  throw new Error('請改用經辦工作台拒絕（/api/staff/reject）');
}

async function cancelReservation(_id) {
  throw new Error('公開取消請使用申請編號＋驗證碼 API');
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
