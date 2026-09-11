/// <reference path="../pb_data/types.d.ts" />
/**
 * HKProperty PocketBase JSVM hooks.
 * Collections: users, assets, loan_records, asset_reservations, usage_records,
 * inventory_audits, location_history, operation_logs, system_settings
 */

function actorOf(e) {
  var auth = e.auth;
  if (!auth) throw new UnauthorizedError('請先登入');
  if (auth.get('active') === false) throw new ForbiddenError('此帳號已停用，請聯繫管理者');
  return auth;
}

function roleOf(auth) {
  return String(auth.get('role') || 'borrower');
}

function isStaff(auth) {
  var role = roleOf(auth);
  return role === 'staff' || role === 'admin';
}

function isAdmin(auth) {
  return roleOf(auth) === 'admin';
}

function displayName(auth) {
  return String(auth.get('name') || auth.get('email') || '使用者');
}

function bodyOf(e) {
  try {
    return e.requestInfo().body || {};
  } catch (err) {
    return {};
  }
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function dayStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function exportRec(rec) {
  return rec.publicExport();
}

function boolFrom(value, fallback) {
  if (value == null) return fallback;
  return !!value;
}

function settingsRecord(app) {
  var db = app || $app;
  var list = db.findRecordsByFilter('system_settings', '', '-created', 1, 0);
  if (!list.length) throw new ApiError(500, '尚未建立系統設定');
  return list[0];
}

function nextSerial(app, collection, field, prefix) {
  var list = [];
  try {
    list = app.findRecordsByFilter(collection, field + ' ~ {:p}', '-' + field, 1, 0, { p: prefix });
  } catch (err) {
    list = [];
  }
  var n = 1;
  if (list.length) {
    var last = String(list[0].get(field) || '');
    var parsed = parseInt(last.slice(-4), 10);
    if (!isNaN(parsed)) n = parsed + 1;
  }
  return prefix + String(n).padStart(4, '0');
}

function nextLoanNumber(app) {
  return nextSerial(app, 'loan_records', 'loan_number', 'LOAN-' + dayStamp() + '-');
}

function nextReservationNumber(app) {
  return nextSerial(app, 'asset_reservations', 'reservation_number', 'RSV-' + dayStamp() + '-');
}

function nextUsageNumber(app) {
  return nextSerial(app, 'usage_records', 'usage_number', 'USE-' + dayStamp() + '-');
}

function requireAsset(app, id) {
  var asset;
  try {
    asset = app.findRecordById('assets', id);
  } catch (err) {
    throw new BadRequestError('查無此財產編號');
  }
  if (!asset || asset.get('active') === false) throw new BadRequestError('查無此財產編號');
  return asset;
}

function requireLoan(app, id) {
  try {
    return app.findRecordById('loan_records', id);
  } catch (err) {
    throw new BadRequestError('找不到借用紀錄');
  }
}

function requireReservation(app, id) {
  try {
    return app.findRecordById('asset_reservations', id);
  } catch (err) {
    throw new BadRequestError('找不到預約紀錄');
  }
}

function openLoansForAsset(app, assetId, exceptId) {
  var filter = 'asset = {:id} && (status = "pending" || status = "approved" || status = "checked_out" || status = "overdue" || status = "return_pending")';
  var list = app.findRecordsByFilter('loan_records', filter, '', 50, 0, { id: assetId });
  if (!exceptId) return list;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id !== exceptId) out.push(list[i]);
  }
  return out;
}

function overlappingReservations(app, assetId, startAt, endAt, exceptId) {
  var filter = 'asset = {:id} && (status = "pending" || status = "approved")';
  var list = app.findRecordsByFilter('asset_reservations', filter, '', 100, 0, { id: assetId });
  var start = new Date(startAt).getTime();
  var end = new Date(endAt).getTime();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (exceptId && row.id === exceptId) continue;
    var oldStart = new Date(row.get('start_at')).getTime();
    var oldEnd = new Date(row.get('end_at')).getTime();
    if (start < oldEnd && end > oldStart) out.push(row);
  }
  return out;
}

function conflictingReservationNow(app, assetId, exceptId) {
  return overlappingReservations(app, assetId, nowIso(), nowIso(), exceptId).filter(function (row) {
    return row.get('status') === 'approved';
  });
}

function findUsageByIdempotency(app, key) {
  try {
    return app.findFirstRecordByFilter('usage_records', 'idempotency_key = {:k}', { k: key });
  } catch (err) {
    return null;
  }
}

function logOp(app, auth, action, entityType, entityId, opts) {
  opts = opts || {};
  var col = app.findCollectionByNameOrId('operation_logs');
  var rec = new Record(col);
  rec.set('action', action);
  rec.set('entity_type', entityType || '');
  rec.set('entity_id', entityId || '');
  if (opts.asset) rec.set('asset', opts.asset);
  if (opts.loan) rec.set('loan', opts.loan);
  if (opts.reservation) rec.set('reservation', opts.reservation);
  rec.set('actor', auth.id);
  rec.set('actor_name', displayName(auth));
  rec.set('summary', opts.summary || action);
  rec.set('detail', opts.detail || {});
  app.save(rec);
  return rec;
}

function createUsageRecord(app, auth, data) {
  var key = trim(data.idempotency_key);
  if (!key) throw new BadRequestError('缺少 idempotency_key');
  var existing = findUsageByIdempotency(app, key);
  if (existing) return { record: existing, created: false };

  var asset = requireAsset(app, data.asset);
  var col = app.findCollectionByNameOrId('usage_records');
  var rec = new Record(col);
  rec.set('usage_number', nextUsageNumber(app));
  rec.set('idempotency_key', key);
  rec.set('usage_type', data.usage_type || 'admin_record');
  rec.set('asset', asset.id);
  rec.set('user', data.user || auth.id);
  rec.set('user_name', trim(data.user_name) || displayName(auth));
  rec.set('department', trim(data.department) || trim(auth.get('department') || ''));
  rec.set('purpose', trim(data.purpose) || '');
  rec.set('used_at', data.used_at || nowIso());
  rec.set('location', trim(data.location) || trim(asset.get('location') || ''));
  rec.set('recorded_by', auth.id);
  rec.set('note', trim(data.note) || '');
  if (data.loan) rec.set('loan', data.loan);
  if (data.reservation) rec.set('reservation', data.reservation);
  app.save(rec);

  asset.set('usage_count', Number(asset.get('usage_count') || 0) + 1);
  app.save(asset);
  return { record: rec, created: true };
}

function normalizeReturnResult(value) {
  var result = trim(value);
  if (result === '正常') result = '正常歸還';
  if (result !== '正常歸還' && result !== '有損壞' && result !== '配件缺少' && result !== '送修' && result !== '遺失') {
    throw new BadRequestError('請選擇物品歸還狀況');
  }
  return result;
}

function validateLoanPayload(auth, data, opts) {
  opts = opts || {};
  if (!trim(data.borrower_name) && !displayName(auth)) throw new BadRequestError('請填寫借用人姓名');
  var number = trim(data.borrower_number) || trim(auth.get('school_number') || '');
  if (number.length < 4) throw new BadRequestError('學號或教職員編號至少 4 個字元');
  if (!trim(data.borrower_department) && !trim(auth.get('department') || '')) {
    throw new BadRequestError('請填寫借用單位、系所或社團');
  }
  if (!trim(data.purpose)) throw new BadRequestError('請填寫借用用途');
  if (!data.expected_return_at) throw new BadRequestError('請填寫預計歸還日期與時間');
  var checkoutAt = data.checkout_at || nowIso();
  if (new Date(data.expected_return_at) < new Date(checkoutAt)) {
    throw new BadRequestError('預計歸還時間不得早於借出時間');
  }
  var method = data.checkout_method || (opts.method || 'self_service');
  if (!isStaff(auth) && method === 'admin') throw new BadRequestError('借用人只能使用自助借用');
  return {
    borrower_name: trim(data.borrower_name) || displayName(auth),
    borrower_number: number,
    borrower_department: trim(data.borrower_department) || trim(auth.get('department') || ''),
    purpose: trim(data.purpose),
    contact: trim(data.contact) || '',
    checkout_at: checkoutAt,
    expected_return_at: data.expected_return_at,
    checkout_condition: trim(data.checkout_condition) || '',
    checkout_method: method,
    note: trim(data.note) || ''
  };
}

function assertAssetCheckoutable(app, asset, exceptLoanId) {
  if (asset.get('borrowable') === false) throw new BadRequestError('此財產不可借用');
  var avail = asset.get('availability_status');
  if (avail === 'maintenance') throw new BadRequestError('此財產維修中，無法辦理借出');
  if (avail === 'lost') throw new BadRequestError('此財產狀態為異常，無法辦理借出');
  if (avail === 'checked_out' || avail === 'overdue') throw new BadRequestError('此財產目前已借出，不可再次借出');
  if (openLoansForAsset(app, asset.id, exceptLoanId).length) {
    throw new BadRequestError('此財產已有未完成的借用紀錄，不可重複借出');
  }
  if (conflictingReservationNow(app, asset.id).length) {
    throw new BadRequestError('此財產目前時段已有核准預約，無法借出');
  }
}

function performCheckoutExisting(app, auth, rec) {
  var settings = settingsRecord(app);
  var status = rec.get('status');
  if (status === 'checked_out') throw new BadRequestError('此筆借用已完成借出');
  if (status === 'returned' || status === 'rejected' || status === 'cancelled') {
    throw new BadRequestError('此筆借用無法借出');
  }
  if (status === 'pending' && settings.get('require_loan_approval') === true && !isStaff(auth)) {
    throw new BadRequestError('借用申請尚待核准');
  }
  if (status !== 'pending' && status !== 'approved') throw new BadRequestError('目前狀態不可辦理借出');
  if (!isStaff(auth) && rec.get('borrower') !== auth.id) throw new ForbiddenError('只能辦理自己的借用');
  if (!isStaff(auth) && settings.get('allow_self_checkout') === false) {
    throw new BadRequestError('目前未開放自助借出，請由管理者辦理');
  }

  var asset = requireAsset(app, rec.get('asset'));
  assertAssetCheckoutable(app, asset, rec.id);

  var checkoutAt = nowIso();
  rec.set('status', 'checked_out');
  if (!rec.get('checkout_at')) rec.set('checkout_at', checkoutAt);
  if (!rec.get('checkout_operator')) {
    rec.set('checkout_operator', rec.get('checkout_method') === 'self_service' ? '自助借用' : displayName(auth));
  }
  app.save(rec);

  asset.set('availability_status', 'checked_out');
  asset.set('current_loan', rec.id);
  asset.set('return_alert', '');
  app.save(asset);

  createUsageRecord(app, auth, {
    asset: asset.id,
    loan: rec.id,
    user: rec.get('borrower') || auth.id,
    user_name: rec.get('borrower_name'),
    department: rec.get('borrower_department'),
    purpose: rec.get('purpose'),
    used_at: rec.get('checkout_at') || checkoutAt,
    usage_type: 'checkout',
    idempotency_key: 'checkout:' + rec.id,
    note: '借用編號 ' + rec.get('loan_number'),
    location: asset.get('location') || ''
  });

  logOp(app, auth, '借出', 'loan', rec.id, {
    asset: asset.id,
    loan: rec.id,
    summary: '借出 ' + rec.get('loan_number'),
    detail: { loan_number: rec.get('loan_number') }
  });
  return rec;
}

function createPendingLoan(app, auth, data) {
  var fields = validateLoanPayload(auth, data);
  var assetId = data.asset_id || data.asset;
  if (!assetId) throw new BadRequestError('請指定財產');
  var asset = requireAsset(app, assetId);
  if (asset.get('borrowable') === false) throw new BadRequestError('此財產不可借用');
  var avail = asset.get('availability_status');
  if (avail === 'maintenance') throw new BadRequestError('此財產維修中，無法辦理借出');
  if (avail === 'lost') throw new BadRequestError('此財產狀態為異常，無法辦理借出');
  if (avail === 'checked_out' || avail === 'overdue') throw new BadRequestError('此財產目前已借出，不可再次借出');
  if (openLoansForAsset(app, asset.id).length) throw new BadRequestError('此財產已有未完成的借用紀錄，不可重複借出');

  var col = app.findCollectionByNameOrId('loan_records');
  var rec = new Record(col);
  rec.set('loan_number', nextLoanNumber(app));
  rec.set('asset', asset.id);
  rec.set('property_id', asset.get('property_id'));
  rec.set('property_name', asset.get('name'));
  rec.set('borrower', auth.id);
  rec.set('borrower_name', fields.borrower_name);
  rec.set('borrower_number', fields.borrower_number);
  rec.set('borrower_department', fields.borrower_department);
  rec.set('purpose', fields.purpose);
  rec.set('contact', fields.contact);
  rec.set('requested_at', nowIso());
  rec.set('expected_return_at', fields.expected_return_at);
  rec.set('checkout_condition', fields.checkout_condition);
  rec.set('checkout_method', fields.checkout_method);
  rec.set('status', 'pending');
  rec.set('note', fields.note);
  app.save(rec);

  asset.set('availability_status', avail === 'available' || avail === 'reserved' ? 'reserved' : avail);
  asset.set('current_loan', rec.id);
  app.save(asset);

  logOp(app, auth, '借用申請', 'loan', rec.id, {
    asset: asset.id,
    loan: rec.id,
    summary: '借用申請 ' + rec.get('loan_number'),
    detail: { loan_number: rec.get('loan_number') }
  });
  return rec;
}

function createCheckoutLoan(app, auth, data) {
  var settings = settingsRecord(app);
  if (!isStaff(auth) && settings.get('allow_self_checkout') === false) {
    throw new BadRequestError('目前未開放自助借出，請由管理者辦理');
  }
  if (!isStaff(auth) && settings.get('require_loan_approval') === true) {
    throw new BadRequestError('目前需先提出借用申請並經核准');
  }

  var fields = validateLoanPayload(auth, data);
  var assetId = data.asset_id || data.asset;
  if (!assetId) throw new BadRequestError('請指定財產');
  var asset = requireAsset(app, assetId);
  assertAssetCheckoutable(app, asset);

  var col = app.findCollectionByNameOrId('loan_records');
  var rec = new Record(col);
  rec.set('loan_number', nextLoanNumber(app));
  rec.set('asset', asset.id);
  rec.set('property_id', asset.get('property_id'));
  rec.set('property_name', asset.get('name'));
  rec.set('borrower', auth.id);
  rec.set('borrower_name', fields.borrower_name);
  rec.set('borrower_number', fields.borrower_number);
  rec.set('borrower_department', fields.borrower_department);
  rec.set('purpose', fields.purpose);
  rec.set('contact', fields.contact);
  rec.set('requested_at', nowIso());
  rec.set('checkout_at', fields.checkout_at);
  rec.set('expected_return_at', fields.expected_return_at);
  rec.set('checkout_condition', fields.checkout_condition);
  rec.set('checkout_method', fields.checkout_method);
  rec.set('checkout_operator', fields.checkout_method === 'self_service' ? '自助借用' : displayName(auth));
  rec.set('status', 'checked_out');
  rec.set('note', fields.note);
  app.save(rec);

  asset.set('availability_status', 'checked_out');
  asset.set('current_loan', rec.id);
  asset.set('return_alert', '');
  app.save(asset);

  createUsageRecord(app, auth, {
    asset: asset.id,
    loan: rec.id,
    user: auth.id,
    user_name: fields.borrower_name,
    department: fields.borrower_department,
    purpose: fields.purpose,
    used_at: fields.checkout_at,
    usage_type: 'checkout',
    idempotency_key: trim(data.idempotency_key) || ('checkout:' + rec.id),
    note: '借用編號 ' + rec.get('loan_number'),
    location: asset.get('location') || ''
  });

  logOp(app, auth, '借出', 'loan', rec.id, {
    asset: asset.id,
    loan: rec.id,
    summary: '借出 ' + rec.get('loan_number'),
    detail: { loan_number: rec.get('loan_number') }
  });
  return rec;
}

function completeReturn(app, auth, rec, data) {
  var settings = settingsRecord(app);
  if (rec.get('returned_at') || rec.get('status') === 'returned') {
    throw new BadRequestError('此筆借用已完成歸還，不可重複歸還');
  }
  var status = rec.get('status');
  if (status !== 'checked_out' && status !== 'overdue' && status !== 'return_pending') {
    throw new BadRequestError('目前狀態不可辦理歸還');
  }
  if (!isStaff(auth)) {
    if (rec.get('borrower') !== auth.id) throw new ForbiddenError('只能歸還自己的借用');
    if (settings.get('allow_self_checkout') === false) {
      throw new BadRequestError('目前未開放自助歸還，請由管理者辦理');
    }
  }
  if (!data.returned_at) throw new BadRequestError('請填寫實際歸還日期與時間');
  if (!trim(data.return_location)) throw new BadRequestError('請填寫歸還後存放地點');
  if (new Date(data.returned_at) < new Date(rec.get('checkout_at') || rec.get('requested_at'))) {
    throw new BadRequestError('實際歸還時間不得早於借出時間');
  }
  var result = normalizeReturnResult(data.return_result);
  if (result !== '正常歸還' && !trim(data.return_condition) && !isStaff(auth)) {
    throw new BadRequestError('請填寫問題說明');
  }

  var nextStatus = 'available';
  var nextAlert = '';
  if (result === '送修') nextStatus = 'maintenance';
  if (result === '遺失') nextStatus = 'lost';
  if (result === '有損壞') nextAlert = 'damaged';
  if (result === '配件缺少') nextAlert = 'missing_parts';

  var asset = requireAsset(app, rec.get('asset'));
  rec.set('status', 'returned');
  rec.set('returned_at', data.returned_at);
  rec.set('return_location', trim(data.return_location));
  rec.set('return_result', result);
  rec.set('return_condition', trim(data.return_condition) || '');
  rec.set('return_operator', rec.get('checkout_method') === 'self_service' && !isStaff(auth) ? '自助歸還' : displayName(auth));
  if (trim(data.note)) {
    rec.set('note', trim((rec.get('note') || '') + (rec.get('note') ? '；' : '') + data.note));
  }
  app.save(rec);

  if (trim(data.return_location) !== trim(asset.get('location') || '')) {
    var histCol = app.findCollectionByNameOrId('location_history');
    var hist = new Record(histCol);
    hist.set('asset', asset.id);
    hist.set('from_location', asset.get('location') || '');
    hist.set('to_location', trim(data.return_location));
    hist.set('reason', '歸還後更新存放位置（' + result + '）');
    hist.set('operator', auth.id);
    hist.set('operator_name', displayName(auth));
    app.save(hist);
    asset.set('location', trim(data.return_location));
  }

  asset.set('availability_status', nextStatus);
  asset.set('current_loan', '');
  asset.set('return_alert', nextAlert);
  app.save(asset);

  logOp(app, auth, '歸還', 'loan', rec.id, {
    asset: asset.id,
    loan: rec.id,
    summary: '歸還 ' + rec.get('loan_number'),
    detail: { loan_number: rec.get('loan_number'), result: result }
  });
  return rec;
}

function createReservation(app, auth, data) {
  var assetId = data.asset_id || data.asset;
  if (!assetId) throw new BadRequestError('請指定財產');
  if (!trim(data.purpose)) throw new BadRequestError('請填寫預約用途');
  if (!data.start_at || !data.end_at) throw new BadRequestError('請填寫預約起迄時間');
  if (new Date(data.end_at) <= new Date(data.start_at)) {
    throw new BadRequestError('預約結束時間必須晚於開始時間');
  }

  var asset = requireAsset(app, assetId);
  if (asset.get('borrowable') === false) throw new BadRequestError('此財產不可借用');
  var avail = asset.get('availability_status');
  if (avail === 'maintenance' || avail === 'lost') throw new BadRequestError('此財產目前不可預約');
  if (overlappingReservations(app, asset.id, data.start_at, data.end_at).length) {
    throw new BadRequestError('此時段已有其他待審或已核准的預約');
  }

  var col = app.findCollectionByNameOrId('asset_reservations');
  var rec = new Record(col);
  rec.set('reservation_number', nextReservationNumber(app));
  rec.set('asset', asset.id);
  rec.set('user', auth.id);
  rec.set('purpose', trim(data.purpose));
  rec.set('start_at', data.start_at);
  rec.set('end_at', data.end_at);
  rec.set('status', 'pending');
  rec.set('contact', trim(data.contact) || '');
  rec.set('note', trim(data.note) || '');
  app.save(rec);

  logOp(app, auth, '預約申請', 'reservation', rec.id, {
    asset: asset.id,
    reservation: rec.id,
    summary: '預約申請 ' + rec.get('reservation_number'),
    detail: { reservation_number: rec.get('reservation_number') }
  });
  return rec;
}

function approveReservation(app, auth, rec) {
  if (!isStaff(auth)) throw new ForbiddenError('沒有核准預約的權限');
  if (rec.get('status') !== 'pending') throw new BadRequestError('僅能核准待審核的預約');
  if (overlappingReservations(app, rec.get('asset'), rec.get('start_at'), rec.get('end_at'), rec.id).length) {
    throw new BadRequestError('此時段已有衝突的預約');
  }

  rec.set('status', 'approved');
  rec.set('approved_by', auth.id);
  rec.set('approved_at', nowIso());
  app.save(rec);

  var asset = requireAsset(app, rec.get('asset'));
  if (asset.get('availability_status') === 'available') {
    asset.set('availability_status', 'reserved');
    app.save(asset);
  }

  logOp(app, auth, '核准預約', 'reservation', rec.id, {
    asset: asset.id,
    reservation: rec.id,
    summary: '核准預約 ' + rec.get('reservation_number'),
    detail: { reservation_number: rec.get('reservation_number') }
  });
  return rec;
}

function rejectReservation(app, auth, rec, reason) {
  if (!isStaff(auth)) throw new ForbiddenError('沒有拒絕預約的權限');
  reason = trim(reason);
  if (!reason) throw new BadRequestError('請填寫拒絕原因');
  if (rec.get('status') !== 'pending' && rec.get('status') !== 'approved') {
    throw new BadRequestError('此預約目前無法拒絕');
  }

  rec.set('status', 'rejected');
  rec.set('rejection_reason', reason);
  app.save(rec);

  var asset = requireAsset(app, rec.get('asset'));
  if (asset.get('availability_status') === 'reserved') {
    var other = app.findRecordsByFilter(
      'asset_reservations',
      'asset = {:id} && status = "approved" && id != {:rid}',
      '',
      1,
      0,
      { id: asset.id, rid: rec.id }
    );
    var open = openLoansForAsset(app, asset.id);
    if (!other.length && !open.length) {
      asset.set('availability_status', 'available');
      app.save(asset);
    }
  }

  logOp(app, auth, '拒絕預約', 'reservation', rec.id, {
    asset: asset.id,
    reservation: rec.id,
    summary: '拒絕預約 ' + rec.get('reservation_number'),
    detail: { reason: reason }
  });
  return rec;
}

function cancelReservation(app, auth, rec) {
  if (rec.get('status') === 'converted' || rec.get('status') === 'cancelled') {
    throw new BadRequestError('此預約無法取消');
  }
  if (!isStaff(auth) && rec.get('user') !== auth.id) throw new ForbiddenError('只能取消自己的預約');
  if (rec.get('status') === 'rejected' || rec.get('status') === 'expired') {
    throw new BadRequestError('此預約目前無法取消');
  }

  rec.set('status', 'cancelled');
  app.save(rec);

  var asset = requireAsset(app, rec.get('asset'));
  if (asset.get('availability_status') === 'reserved') {
    var other = app.findRecordsByFilter(
      'asset_reservations',
      'asset = {:id} && status = "approved" && id != {:rid}',
      '',
      1,
      0,
      { id: asset.id, rid: rec.id }
    );
    var open = openLoansForAsset(app, asset.id);
    if (!other.length && !open.length) {
      asset.set('availability_status', 'available');
      app.save(asset);
    }
  }

  logOp(app, auth, '取消預約', 'reservation', rec.id, {
    asset: asset.id,
    reservation: rec.id,
    summary: '取消預約 ' + rec.get('reservation_number'),
    detail: { reservation_number: rec.get('reservation_number') }
  });
  return rec;
}

function checkoutReservation(app, auth, rec, data) {
  data = data || {};
  var settings = settingsRecord(app);
  if (rec.get('status') !== 'approved') throw new BadRequestError('僅已核准的預約可辦理借出');
  if (!isStaff(auth) && rec.get('user') !== auth.id) throw new ForbiddenError('只能辦理自己的預約借出');
  if (!isStaff(auth) && settings.get('allow_self_checkout') === false) {
    throw new BadRequestError('目前未開放自助借出，請由管理者辦理');
  }

  var now = new Date();
  if (now.getTime() < new Date(rec.get('start_at')).getTime() - 15 * 60 * 1000) {
    throw new BadRequestError('尚未到達預約開始時間');
  }
  if (now.getTime() > new Date(rec.get('end_at')).getTime()) {
    throw new BadRequestError('預約時段已結束，無法借出');
  }

  var asset = requireAsset(app, rec.get('asset'));
  assertAssetCheckoutable(app, asset);

  var borrower;
  try {
    borrower = app.findRecordById('users', rec.get('user'));
  } catch (err) {
    borrower = auth;
  }

  var checkoutAt = data.checkout_at || nowIso();
  var expected = data.expected_return_at || rec.get('end_at');
  var col = app.findCollectionByNameOrId('loan_records');
  var loan = new Record(col);
  loan.set('loan_number', nextLoanNumber(app));
  loan.set('asset', asset.id);
  loan.set('property_id', asset.get('property_id'));
  loan.set('property_name', asset.get('name'));
  loan.set('borrower', borrower.id);
  loan.set('borrower_name', borrower.get('name') || displayName(auth));
  loan.set('borrower_number', borrower.get('school_number') || '');
  loan.set('borrower_department', borrower.get('department') || '');
  loan.set('purpose', rec.get('purpose'));
  loan.set('contact', rec.get('contact') || '');
  loan.set('requested_at', nowIso());
  loan.set('checkout_at', checkoutAt);
  loan.set('expected_return_at', expected);
  loan.set('checkout_method', 'reservation');
  loan.set('checkout_operator', isStaff(auth) ? displayName(auth) : '預約自助借出');
  loan.set('status', 'checked_out');
  loan.set('note', trim(data.note) || trim(rec.get('note') || ''));
  app.save(loan);

  asset.set('availability_status', 'checked_out');
  asset.set('current_loan', loan.id);
  asset.set('return_alert', '');
  app.save(asset);

  createUsageRecord(app, auth, {
    asset: asset.id,
    loan: loan.id,
    reservation: rec.id,
    user: borrower.id,
    user_name: loan.get('borrower_name'),
    department: loan.get('borrower_department'),
    purpose: loan.get('purpose'),
    used_at: checkoutAt,
    usage_type: 'reservation_checkout',
    idempotency_key: trim(data.idempotency_key) || ('reservation_checkout:' + rec.id),
    note: '預約編號 ' + rec.get('reservation_number'),
    location: asset.get('location') || ''
  });

  rec.set('status', 'converted');
  rec.set('converted_loan', loan.id);
  app.save(rec);

  logOp(app, auth, '預約借出', 'reservation', rec.id, {
    asset: asset.id,
    loan: loan.id,
    reservation: rec.id,
    summary: '預約借出 ' + rec.get('reservation_number'),
    detail: {
      reservation_number: rec.get('reservation_number'),
      loan_number: loan.get('loan_number')
    }
  });
  return { reservation: rec, loan: loan };
}

function createAudit(app, auth, data) {
  if (!isStaff(auth)) throw new ForbiddenError('沒有盤點權限');
  var assetId = data.asset_id || data.asset;
  if (!assetId) throw new BadRequestError('請指定財產');
  var asset = requireAsset(app, assetId);
  if (!trim(data.auditor)) throw new BadRequestError('請填寫盤點人');
  if (!trim(data.actual_location)) throw new BadRequestError('請填寫本次實際位置');
  if (!data.result) throw new BadRequestError('請選擇盤點結果');
  if (data.result === '位置正確' && trim(data.actual_location) !== trim(data.registered_location || asset.get('location') || '')) {
    throw new BadRequestError('實際位置與系統登記位置不同，請改選「位置異常」');
  }

  var col = app.findCollectionByNameOrId('inventory_audits');
  var rec = new Record(col);
  rec.set('asset', asset.id);
  rec.set('registered_location', data.registered_location || asset.get('location') || '');
  rec.set('actual_location', trim(data.actual_location));
  rec.set('result', data.result);
  rec.set('auditor', trim(data.auditor));
  rec.set('audited_at', data.audited_at || nowIso());
  rec.set('note', trim(data.note) || '');
  rec.set('created_by', auth.id);
  app.save(rec);

  var nextAudit = '待盤點';
  if (data.result === '位置正確') nextAudit = '已盤點';
  if (data.result === '位置異常') nextAudit = '位置異常';
  if (data.result === '找不到物品') nextAudit = '找不到物品';
  if (data.result === '物品損壞') nextAudit = '物品損壞';
  asset.set('last_audit_at', rec.get('audited_at'));
  asset.set('audit_status', nextAudit);
  app.save(asset);

  logOp(app, auth, '盤點', 'audit', rec.id, {
    asset: asset.id,
    summary: '盤點 ' + asset.get('property_id'),
    detail: { result: data.result }
  });
  return rec;
}

function updateAssetLocation(app, auth, assetId, data) {
  if (!isStaff(auth)) throw new ForbiddenError('沒有修改位置的權限');
  var asset = requireAsset(app, assetId);
  if (!trim(data.to_location)) throw new BadRequestError('請填寫新的存放位置');
  var from = trim(data.from_location || asset.get('location') || '');
  if (trim(data.to_location) === from) throw new BadRequestError('新位置與目前位置相同');

  var histCol = app.findCollectionByNameOrId('location_history');
  var hist = new Record(histCol);
  hist.set('asset', asset.id);
  hist.set('from_location', from);
  hist.set('to_location', trim(data.to_location));
  hist.set('reason', trim(data.reason) || '更新存放位置');
  hist.set('operator', auth.id);
  hist.set('operator_name', displayName(auth));
  app.save(hist);

  asset.set('location', trim(data.to_location));
  app.save(asset);

  logOp(app, auth, '位置異動', 'asset', asset.id, {
    asset: asset.id,
    summary: '位置異動 ' + asset.get('property_id'),
    detail: { to: trim(data.to_location) }
  });
  return asset;
}

function setAssetActive(app, auth, assetId, data) {
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以停用財產');
  var asset = requireAsset(app, assetId);
  var active = data.active != null ? !!data.active : data.is_active !== false;
  asset.set('active', active);
  app.save(asset);
  logOp(app, auth, active ? '修改財產' : '停用財產', 'asset', asset.id, {
    asset: asset.id,
    summary: (active ? '啟用' : '停用') + ' ' + asset.get('property_id'),
    detail: { property_id: asset.get('property_id'), active: active }
  });
  return asset;
}

function updateSettings(app, auth, data) {
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以修改系統設定');
  var rec = settingsRecord(app);
  if (data.require_loan_approval != null) rec.set('require_loan_approval', !!data.require_loan_approval);
  if (data.allow_self_checkout != null) rec.set('allow_self_checkout', !!data.allow_self_checkout);
  if (data.default_loan_days != null) rec.set('default_loan_days', Number(data.default_loan_days));
  rec.set('updated_by', auth.id);
  app.save(rec);
  logOp(app, auth, '修改系統設定', 'settings', rec.id, {
    summary: '修改系統設定',
    detail: exportRec(rec)
  });
  return rec;
}

function updateUser(app, auth, userId, data) {
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以修改使用者角色');
  var rec;
  try {
    rec = app.findRecordById('users', userId);
  } catch (err) {
    throw new BadRequestError('找不到使用者');
  }
  var role = data.role;
  if (role) {
    if (role !== 'borrower' && role !== 'staff' && role !== 'admin') throw new BadRequestError('角色不正確');
    rec.set('role', role);
  }
  if (data.active != null || data.is_active != null) {
    rec.set('active', data.active != null ? !!data.active : !!data.is_active);
  }
  if (data.name || data.display_name) rec.set('name', trim(data.name || data.display_name));
  if (data.department != null) rec.set('department', trim(data.department));
  if (data.school_number != null) rec.set('school_number', trim(data.school_number));
  app.save(rec);
  logOp(app, auth, '角色修改', 'profile', rec.id, {
    summary: '修改使用者 ' + (rec.get('name') || rec.get('email')),
    detail: { role: rec.get('role'), active: rec.get('active') }
  });
  return rec;
}

function dashboardPayload(app, auth) {
  var assets = app.findRecordsByFilter('assets', 'active = true', '', 5000, 0);
  var counts = {
    total: assets.length,
    available: 0,
    reserved: 0,
    checked_out: 0,
    overdue: 0,
    maintenance: 0,
    lost: 0
  };
  for (var i = 0; i < assets.length; i++) {
    var st = assets[i].get('availability_status');
    if (counts[st] != null) counts[st]++;
  }

  var loans = app.findRecordsByFilter('loan_records', '', '-requested_at', 2000, 0);
  var now = new Date();
  var today = now.toISOString().slice(0, 10);
  var loanStats = { open: 0, pending: 0, overdue: 0, due_today: 0, checked_out: 0 };
  for (var j = 0; j < loans.length; j++) {
    var loan = loans[j];
    var ls = loan.get('status');
    if (ls === 'pending') loanStats.pending++;
    if (ls === 'pending' || ls === 'approved' || ls === 'checked_out' || ls === 'overdue' || ls === 'return_pending') {
      loanStats.open++;
    }
    if (ls === 'checked_out' || ls === 'overdue') {
      loanStats.checked_out++;
      var expected = loan.get('expected_return_at');
      if (expected) {
        var exp = new Date(expected);
        if (exp.getTime() < now.getTime()) loanStats.overdue++;
        if (String(expected).slice(0, 10) === today) loanStats.due_today++;
      }
    }
  }

  var reservations = app.findRecordsByFilter(
    'asset_reservations',
    'status = "pending" || status = "approved"',
    '',
    1000,
    0
  );
  var resStats = { pending: 0, approved: 0 };
  for (var k = 0; k < reservations.length; k++) {
    if (reservations[k].get('status') === 'pending') resStats.pending++;
    if (reservations[k].get('status') === 'approved') resStats.approved++;
  }

  var monthPrefix = now.toISOString().slice(0, 7);
  var usage = [];
  try {
    usage = app.findRecordsByFilter('usage_records', 'used_at >= {:m}', '', 5000, 0, { m: monthPrefix + '-01 00:00:00.000Z' });
  } catch (err) {
    usage = [];
  }

  var settings = null;
  try {
    settings = exportRec(settingsRecord(app));
  } catch (err) {
    settings = null;
  }

  return {
    role: roleOf(auth),
    assets: counts,
    loans: loanStats,
    reservations: resStats,
    usage_month: usage.length,
    settings: settings
  };
}

function handleLoanRequest(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var rec = $app.runInTransaction(function (txApp) {
    return createPendingLoan(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleLoanCheckout(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var loanId = data.loan_id || data.id || data.loan;
  var rec = $app.runInTransaction(function (txApp) {
    if (loanId) return performCheckoutExisting(txApp, auth, requireLoan(txApp, loanId));
    return createCheckoutLoan(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleLoanApprove(e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有核准權限');
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    var loan = requireLoan(txApp, id);
    if (loan.get('status') !== 'pending') throw new BadRequestError('僅能核准待審核的申請');
    loan.set('status', 'approved');
    loan.set('approved_at', nowIso());
    loan.set('approved_by', auth.id);
    txApp.save(loan);
    var asset = requireAsset(txApp, loan.get('asset'));
    if (asset.get('availability_status') === 'available') {
      asset.set('availability_status', 'reserved');
      txApp.save(asset);
    }
    logOp(txApp, auth, '核准', 'loan', loan.id, {
      asset: loan.get('asset'),
      loan: loan.id,
      summary: '核准 ' + loan.get('loan_number'),
      detail: { loan_number: loan.get('loan_number') }
    });
    return loan;
  });
  return e.json(200, exportRec(rec));
}

function handleLoanReject(e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有拒絕權限');
  var reason = trim(bodyOf(e).reason);
  if (!reason) throw new BadRequestError('請填寫拒絕原因');
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    var loan = requireLoan(txApp, id);
    if (loan.get('status') !== 'pending' && loan.get('status') !== 'approved') {
      throw new BadRequestError('此申請目前無法拒絕');
    }
    loan.set('status', 'rejected');
    loan.set('rejection_reason', reason);
    txApp.save(loan);
    var asset = requireAsset(txApp, loan.get('asset'));
    if (String(asset.get('current_loan') || '') === loan.id) {
      asset.set('availability_status', 'available');
      asset.set('current_loan', '');
      txApp.save(asset);
    }
    logOp(txApp, auth, '拒絕', 'loan', loan.id, {
      asset: loan.get('asset'),
      loan: loan.id,
      summary: '拒絕 ' + loan.get('loan_number'),
      detail: { reason: reason }
    });
    return loan;
  });
  return e.json(200, exportRec(rec));
}

function handleLegacyLoansCreate(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var settings = settingsRecord($app);
  var asRequest = boolFrom(data.as_request, false) || boolFrom(data.request_only, false);
  if (!asRequest && data.mode === 'request') asRequest = true;
  if (!asRequest && settings.get('require_loan_approval') === true && !isStaff(auth)) asRequest = true;
  var rec = $app.runInTransaction(function (txApp) {
    if (asRequest) return createPendingLoan(txApp, auth, data);
    return createCheckoutLoan(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleLegacyLoanCheckout(e) {
  var auth = actorOf(e);
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    return performCheckoutExisting(txApp, auth, requireLoan(txApp, id));
  });
  return e.json(200, exportRec(rec));
}

function handleLegacyLoanReturn(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    return completeReturn(txApp, auth, requireLoan(txApp, id), data);
  });
  return e.json(200, exportRec(rec));
}

function handleLegacyReturnRequest(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var id = e.request.pathValue('id');
  var settings = settingsRecord($app);
  if (!isStaff(auth) && settings.get('allow_self_checkout') === true) {
    var done = $app.runInTransaction(function (txApp) {
      return completeReturn(txApp, auth, requireLoan(txApp, id), data);
    });
    return e.json(200, exportRec(done));
  }
  var rec = $app.runInTransaction(function (txApp) {
    var loan = requireLoan(txApp, id);
    if (loan.get('returned_at') || loan.get('status') === 'returned') {
      throw new BadRequestError('此筆借用已完成歸還，不可重複歸還');
    }
    var status = loan.get('status');
    if (status !== 'checked_out' && status !== 'overdue' && status !== 'return_pending') {
      throw new BadRequestError('目前狀態不可辦理歸還');
    }
    if (!isStaff(auth) && loan.get('borrower') !== auth.id) throw new ForbiddenError('只能歸還自己的借用');
    loan.set('status', 'return_pending');
    if (trim(data.return_location)) loan.set('return_location', trim(data.return_location));
    if (data.return_result) loan.set('return_result', data.return_result);
    if (data.return_condition) loan.set('return_condition', data.return_condition);
    txApp.save(loan);
    logOp(txApp, auth, '歸還申請', 'loan', loan.id, {
      asset: loan.get('asset'),
      loan: loan.id,
      summary: '歸還申請 ' + loan.get('loan_number'),
      detail: { loan_number: loan.get('loan_number') }
    });
    return loan;
  });
  return e.json(200, exportRec(rec));
}

function handleReservationCreate(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var rec = $app.runInTransaction(function (txApp) {
    return createReservation(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleReservationApprove(e) {
  var auth = actorOf(e);
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    return approveReservation(txApp, auth, requireReservation(txApp, id));
  });
  return e.json(200, exportRec(rec));
}

function handleReservationReject(e) {
  var auth = actorOf(e);
  var id = e.request.pathValue('id');
  var reason = bodyOf(e).reason;
  var rec = $app.runInTransaction(function (txApp) {
    return rejectReservation(txApp, auth, requireReservation(txApp, id), reason);
  });
  return e.json(200, exportRec(rec));
}

function handleReservationCheckout(e) {
  var auth = actorOf(e);
  var id = e.request.pathValue('id');
  var data = bodyOf(e);
  var result = $app.runInTransaction(function (txApp) {
    return checkoutReservation(txApp, auth, requireReservation(txApp, id), data);
  });
  return e.json(200, {
    reservation: exportRec(result.reservation),
    loan: exportRec(result.loan)
  });
}

function handleReservationCancel(e) {
  var auth = actorOf(e);
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    return cancelReservation(txApp, auth, requireReservation(txApp, id));
  });
  return e.json(200, exportRec(rec));
}

function handleUsage(e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有登記使用的權限');
  var data = bodyOf(e);
  var assetId = data.asset_id || data.asset;
  if (!assetId) throw new BadRequestError('請指定財產');
  if (!trim(data.user_name)) throw new BadRequestError('請填寫使用人');
  if (!trim(data.purpose)) throw new BadRequestError('請填寫使用用途');
  if (!data.used_at) throw new BadRequestError('請填寫使用日期與時間');

  var key = trim(data.idempotency_key);
  if (!key) {
    // Legacy clients may omit the key; generate a unique one so usage_count still increments once.
    key = 'auto:' + assetId + ':' + data.used_at + ':' + $security.randomString(10);
  }

  var existing = findUsageByIdempotency($app, key);
  if (existing) return e.json(200, exportRec(existing));

  var usageType = data.usage_type || (trim(data.department) ? 'on_site' : 'admin_record');
  if (usageType !== 'checkout' && usageType !== 'on_site' && usageType !== 'reservation_checkout' && usageType !== 'admin_record') {
    throw new BadRequestError('使用類型不正確');
  }

  var result = $app.runInTransaction(function (txApp) {
    return createUsageRecord(txApp, auth, {
      asset: assetId,
      user: auth.id,
      user_name: data.user_name,
      department: data.department,
      purpose: data.purpose,
      used_at: data.used_at,
      location: data.location,
      note: data.note,
      usage_type: usageType,
      idempotency_key: key,
      loan: data.loan_id || data.loan,
      reservation: data.reservation_id || data.reservation
    });
  });
  return e.json(200, exportRec(result.record));
}

function handleAudits(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var rec = $app.runInTransaction(function (txApp) {
    return createAudit(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleAssetLocation(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var id = e.request.pathValue('id');
  var asset = $app.runInTransaction(function (txApp) {
    return updateAssetLocation(txApp, auth, id, data);
  });
  return e.json(200, exportRec(asset));
}

function handleAssetActive(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var id = e.request.pathValue('id');
  var asset = $app.runInTransaction(function (txApp) {
    return setAssetActive(txApp, auth, id, data);
  });
  return e.json(200, exportRec(asset));
}

function handleSettings(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var rec = $app.runInTransaction(function (txApp) {
    return updateSettings(txApp, auth, data);
  });
  return e.json(200, exportRec(rec));
}

function handleUsers(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var id = e.request.pathValue('id');
  var rec = $app.runInTransaction(function (txApp) {
    return updateUser(txApp, auth, id, data);
  });
  return e.json(200, exportRec(rec));
}

function handleDashboard(e) {
  var auth = actorOf(e);
  return e.json(200, dashboardPayload($app, auth));
}

function handleLoanReturnNew(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  var loanId = data.loan_id || data.id || data.loan;
  if (!loanId) throw new BadRequestError('請指定借用紀錄');
  var rec = $app.runInTransaction(function (txApp) {
    return completeReturn(txApp, auth, requireLoan(txApp, loanId), data);
  });
  return e.json(200, exportRec(rec));
}

// ---- Primary routes (/api/hkproperty/...) ----
routerAdd('POST', '/api/hkproperty/loans/request', handleLoanRequest, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/loans/checkout', handleLoanCheckout, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/loans/return', handleLoanReturnNew, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/loans/{id}/approve', handleLoanApprove, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/loans/{id}/reject', handleLoanReject, $apis.requireAuth());

routerAdd('POST', '/api/hkproperty/reservations', handleReservationCreate, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/reservations/{id}/approve', handleReservationApprove, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/reservations/{id}/reject', handleReservationReject, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/reservations/{id}/checkout', handleReservationCheckout, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/reservations/{id}/cancel', handleReservationCancel, $apis.requireAuth());

routerAdd('POST', '/api/hkproperty/usage', handleUsage, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/audits', handleAudits, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/assets/{id}/location', handleAssetLocation, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/assets/{id}/active', handleAssetActive, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/settings', handleSettings, $apis.requireAuth());
routerAdd('POST', '/api/hkproperty/users/{id}', handleUsers, $apis.requireAuth());
routerAdd('GET', '/api/hkproperty/dashboard', handleDashboard, $apis.requireAuth());

// ---- Backward-compatible aliases (/api/hkp/...) ----
routerAdd('POST', '/api/hkp/loans', handleLegacyLoansCreate, $apis.requireAuth());
routerAdd('POST', '/api/hkp/loans/{id}/approve', handleLoanApprove, $apis.requireAuth());
routerAdd('POST', '/api/hkp/loans/{id}/reject', handleLoanReject, $apis.requireAuth());
routerAdd('POST', '/api/hkp/loans/{id}/checkout', handleLegacyLoanCheckout, $apis.requireAuth());
routerAdd('POST', '/api/hkp/loans/{id}/return', handleLegacyLoanReturn, $apis.requireAuth());
routerAdd('POST', '/api/hkp/loans/{id}/return-request', handleLegacyReturnRequest, $apis.requireAuth());
routerAdd('POST', '/api/hkp/usage', handleUsage, $apis.requireAuth());
routerAdd('POST', '/api/hkp/audits', handleAudits, $apis.requireAuth());
routerAdd('POST', '/api/hkp/assets/{id}/location', handleAssetLocation, $apis.requireAuth());
routerAdd('POST', '/api/hkp/assets/{id}/active', handleAssetActive, $apis.requireAuth());
routerAdd('POST', '/api/hkp/settings', handleSettings, $apis.requireAuth());
routerAdd('POST', '/api/hkp/users/{id}', handleUsers, $apis.requireAuth());

onRecordCreateRequest(function (e) {
  if (e.collection.name !== 'users') {
    e.next();
    return;
  }
  if (!e.hasSuperuserAuth()) {
    e.record.set('role', 'borrower');
    e.record.set('active', true);
    if (!e.record.get('name')) {
      var email = String(e.record.get('email') || '');
      e.record.set('name', email.split('@')[0] || '使用者');
    }
  }
  e.next();
}, 'users');
