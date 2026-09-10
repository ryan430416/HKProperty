/// <reference path="../pb_data/types.d.ts" />

function actorOf(e) {
  var auth = e.auth;
  if (!auth) throw new UnauthorizedError('請先登入');
  if (auth.get('is_active') === false) throw new ForbiddenError('此帳號已停用，請聯繫管理者');
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
  return String(auth.get('display_name') || auth.get('email') || '使用者');
}

function bodyOf(e) {
  return e.requestInfo().body || {};
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function settingsRecord() {
  var list = $app.findRecordsByFilter('hkp_system_settings', '', '-created', 1, 0);
  if (!list.length) throw new ApiError(500, '尚未建立系統設定');
  return list[0];
}

function findUserByNumber(number) {
  var token = trim(number);
  if (!token) return null;
  try {
    return $app.findFirstRecordByFilter('hkp_users', 'school_number = {:n}', { n: token });
  } catch (err) {
    return null;
  }
}

function nextLoanNumber() {
  var day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  var prefix = 'LOAN-' + day + '-';
  var list = [];
  try {
    list = $app.findRecordsByFilter('hkp_loan_records', 'loan_number ~ {:p}', '-loan_number', 1, 0, { p: prefix });
  } catch (err) {
    list = [];
  }
  var n = 1;
  if (list.length) {
    var last = String(list[0].get('loan_number') || '');
    var parsed = parseInt(last.slice(-4), 10);
    if (!isNaN(parsed)) n = parsed + 1;
  }
  return prefix + String(n).padStart(4, '0');
}

function openLoansForAsset(assetId, exceptId) {
  var filter = 'asset = {:id} && (status = "pending" || status = "approved" || status = "checked_out" || status = "overdue" || status = "return_pending")';
  var params = { id: assetId };
  var list = $app.findRecordsByFilter('hkp_loan_records', filter, '', 20, 0, params);
  if (!exceptId) return list;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id !== exceptId) out.push(list[i]);
  }
  return out;
}

function exportRec(rec) {
  return rec.publicExport();
}

function logOp(auth, action, entityType, entityId, assetId, detail) {
  var col = $app.findCollectionByNameOrId('hkp_operation_logs');
  var rec = new Record(col);
  rec.set('action', action);
  rec.set('entity_type', entityType || '');
  rec.set('entity_id', entityId || '');
  if (assetId) rec.set('asset', assetId);
  rec.set('actor', auth.id);
  rec.set('actor_name', displayName(auth));
  rec.set('detail', detail || {});
  $app.save(rec);
}

function requireAsset(id) {
  var asset = $app.findRecordById('hkp_assets', id);
  if (!asset || asset.get('is_active') === false) throw new BadRequestError('查無此財產編號');
  return asset;
}

function requireLoan(id) {
  try {
    return $app.findRecordById('hkp_loan_records', id);
  } catch (err) {
    throw new BadRequestError('找不到借用紀錄');
  }
}

function checkoutLoan(auth, rec) {
  var settings = settingsRecord();
  var status = rec.get('status');
  if (status === 'checked_out') throw new BadRequestError('此筆借用已完成借出');
  if (status === 'returned' || status === 'rejected' || status === 'cancelled') throw new BadRequestError('此筆借用無法借出');
  if (status === 'pending' && settings.get('require_loan_approval') === true && !isStaff(auth)) {
    throw new BadRequestError('借用申請尚待核准');
  }
  if (status !== 'pending' && status !== 'approved') throw new BadRequestError('目前狀態不可辦理借出');
  if (!isStaff(auth) && rec.get('borrower') !== auth.id) throw new ForbiddenError('只能辦理自己的借用');
  if (!isStaff(auth) && settings.get('allow_self_checkout') === false) {
    throw new BadRequestError('目前未開放自助借出，請由管理者辦理');
  }

  var asset = requireAsset(rec.get('asset'));
  var avail = asset.get('availability_status');
  if (avail === 'checked_out' || avail === 'overdue') throw new BadRequestError('此財產目前已借出，不可再次借出');
  if (avail === 'maintenance' || avail === 'lost') throw new BadRequestError('此財產目前不可借用');
  if (openLoansForAsset(asset.id, rec.id).length) throw new BadRequestError('此財產已有其他有效借用紀錄');

  rec.set('status', 'checked_out');
  if (!rec.get('checkout_at')) rec.set('checkout_at', nowIso());
  if (!rec.get('checkout_operator')) {
    rec.set('checkout_operator', rec.get('checkout_method') === 'self_service' ? '自助借用' : displayName(auth));
  }
  $app.save(rec);

  asset.set('availability_status', 'checked_out');
  asset.set('current_loan', rec.id);
  asset.set('usage_count', Number(asset.get('usage_count') || 0) + 1);
  asset.set('return_alert', '');
  $app.save(asset);

  var usageCol = $app.findCollectionByNameOrId('hkp_usage_records');
  var usage = new Record(usageCol);
  usage.set('asset', asset.id);
  usage.set('loan', rec.id);
  usage.set('user_name', rec.get('borrower_name'));
  usage.set('department', rec.get('borrower_department'));
  usage.set('used_at', rec.get('checkout_at') || nowIso());
  usage.set('purpose', rec.get('purpose'));
  usage.set('note', '借用編號 ' + rec.get('loan_number'));
  usage.set('created_by', auth.id);
  $app.save(usage);

  logOp(auth, '借出', 'loan', rec.id, asset.id, { loan_number: rec.get('loan_number') });
  return rec;
}

function createLoan(e) {
  var auth = actorOf(e);
  var data = bodyOf(e);
  if (!trim(data.borrower_name)) throw new BadRequestError('請填寫借用人姓名');
  if (trim(data.borrower_number).length < 4) throw new BadRequestError('學號或教職員編號至少 4 個字元');
  if (!trim(data.borrower_department)) throw new BadRequestError('請填寫借用單位、系所或社團');
  if (!trim(data.purpose)) throw new BadRequestError('請填寫借用用途');
  if (!data.expected_return_at) throw new BadRequestError('請填寫預計歸還日期與時間');
  var checkoutAt = data.checkout_at || nowIso();
  if (new Date(data.expected_return_at) < new Date(checkoutAt)) {
    throw new BadRequestError('預計歸還時間不得早於借出時間');
  }
  var method = data.checkout_method || 'self_service';
  if (!isStaff(auth) && method !== 'self_service') throw new BadRequestError('借用人只能使用自助借用');

  var asset = requireAsset(data.asset_id);
  if (asset.get('is_borrowable') === false) throw new BadRequestError('此財產不可借用');
  var avail = asset.get('availability_status');
  if (avail === 'maintenance') throw new BadRequestError('此財產維修中，無法辦理借出');
  if (avail === 'lost') throw new BadRequestError('此財產狀態為異常，無法辦理借出');
  if (avail === 'checked_out' || avail === 'overdue') throw new BadRequestError('此財產目前已借出，不可再次借出');
  if (avail === 'pending') throw new BadRequestError('此財產已有待處理的借用申請');
  if (openLoansForAsset(asset.id).length) throw new BadRequestError('此財產已有未完成的借用紀錄，不可重複借出');

  var borrower = findUserByNumber(data.borrower_number) || auth;
  var col = $app.findCollectionByNameOrId('hkp_loan_records');
  var rec = new Record(col);
  rec.set('loan_number', nextLoanNumber());
  rec.set('asset', asset.id);
  rec.set('property_id', asset.get('property_id'));
  rec.set('property_name', asset.get('name'));
  rec.set('borrower', borrower.id);
  rec.set('borrower_name', trim(data.borrower_name));
  rec.set('borrower_number', trim(data.borrower_number));
  rec.set('borrower_department', trim(data.borrower_department));
  rec.set('purpose', trim(data.purpose));
  rec.set('contact', trim(data.contact));
  rec.set('requested_at', nowIso());
  rec.set('checkout_at', checkoutAt);
  rec.set('expected_return_at', data.expected_return_at);
  rec.set('checkout_condition', trim(data.checkout_condition));
  rec.set('checkout_method', method);
  rec.set('checkout_operator', method === 'self_service' ? '自助借用' : displayName(auth));
  rec.set('status', 'pending');
  rec.set('note', trim(data.note));
  $app.save(rec);

  var settings = settingsRecord();
  if (settings.get('require_loan_approval') === true && !isStaff(auth)) {
    asset.set('availability_status', 'pending');
    asset.set('current_loan', rec.id);
    $app.save(asset);
    logOp(auth, '借用申請', 'loan', rec.id, asset.id, { loan_number: rec.get('loan_number') });
    return rec;
  }
  return checkoutLoan(auth, rec);
}

function completeReturn(auth, rec, data) {
  var settings = settingsRecord();
  if (rec.get('returned_at') || rec.get('status') === 'returned') {
    throw new BadRequestError('此筆借用已完成歸還，不可重複歸還');
  }
  var status = rec.get('status');
  if (status !== 'checked_out' && status !== 'overdue' && status !== 'return_pending') {
    throw new BadRequestError('目前狀態不可辦理歸還');
  }
  if (!isStaff(auth)) {
    if (rec.get('borrower') !== auth.id) throw new ForbiddenError('只能歸還自己的借用');
    if (settings.get('allow_self_checkout') === false) throw new BadRequestError('目前未開放自助歸還，請由管理者辦理');
  }
  if (!data.returned_at) throw new BadRequestError('請填寫實際歸還日期與時間');
  if (!trim(data.return_location)) throw new BadRequestError('請填寫歸還後存放地點');
  if (new Date(data.returned_at) < new Date(rec.get('checkout_at') || rec.get('requested_at'))) {
    throw new BadRequestError('實際歸還時間不得早於借出時間');
  }
  var result = trim(data.return_result);
  if (result === '正常') result = '正常歸還';
  if (result !== '正常歸還' && result !== '有損壞' && result !== '配件缺少' && result !== '送修' && result !== '遺失') {
    throw new BadRequestError('請選擇物品歸還狀況');
  }
  if (result !== '正常歸還' && !trim(data.return_condition) && !isStaff(auth)) {
    throw new BadRequestError('請填寫問題說明');
  }

  var nextStatus = 'available';
  var nextAlert = '';
  if (result === '送修') nextStatus = 'maintenance';
  if (result === '遺失') nextStatus = 'lost';
  if (result === '有損壞') nextAlert = 'damaged';
  if (result === '配件缺少') nextAlert = 'missing_parts';

  var asset = requireAsset(rec.get('asset'));
  rec.set('status', 'returned');
  rec.set('returned_at', data.returned_at);
  rec.set('return_location', trim(data.return_location));
  rec.set('return_result', result);
  rec.set('return_condition', trim(data.return_condition));
  rec.set('return_operator', rec.get('checkout_method') === 'self_service' && !isStaff(auth) ? '自助歸還' : displayName(auth));
  if (trim(data.note)) rec.set('note', trim((rec.get('note') || '') + (rec.get('note') ? '；' : '') + data.note));
  $app.save(rec);

  asset.set('availability_status', nextStatus);
  asset.set('current_loan', '');
  asset.set('return_alert', nextAlert);
  if (trim(data.return_location) !== trim(asset.get('location') || '')) {
    var histCol = $app.findCollectionByNameOrId('hkp_location_history');
    var hist = new Record(histCol);
    hist.set('asset', asset.id);
    hist.set('from_location', asset.get('location') || '');
    hist.set('to_location', trim(data.return_location));
    hist.set('reason', '歸還後更新存放位置（' + result + '）');
    hist.set('operator', auth.id);
    hist.set('operator_name', displayName(auth));
    $app.save(hist);
    asset.set('location', trim(data.return_location));
  }
  $app.save(asset);
  logOp(auth, '歸還', 'loan', rec.id, asset.id, { loan_number: rec.get('loan_number'), result: result });
  return rec;
}

routerAdd('POST', '/api/hkp/loans', function (e) {
  var rec = createLoan(e);
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/loans/{id}/approve', function (e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有核准權限');
  var rec = requireLoan(e.request.pathValue('id'));
  if (rec.get('status') !== 'pending') throw new BadRequestError('僅能核准待審核的申請');
  rec.set('status', 'approved');
  rec.set('approved_at', nowIso());
  rec.set('approved_by', auth.id);
  $app.save(rec);
  var asset = requireAsset(rec.get('asset'));
  asset.set('availability_status', 'pending');
  $app.save(asset);
  logOp(auth, '核准', 'loan', rec.id, rec.get('asset'), { loan_number: rec.get('loan_number') });
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/loans/{id}/reject', function (e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有拒絕權限');
  var reason = trim(bodyOf(e).reason);
  if (!reason) throw new BadRequestError('請填寫拒絕原因');
  var rec = requireLoan(e.request.pathValue('id'));
  if (rec.get('status') !== 'pending' && rec.get('status') !== 'approved') throw new BadRequestError('此申請目前無法拒絕');
  rec.set('status', 'rejected');
  rec.set('rejection_reason', reason);
  $app.save(rec);
  var asset = requireAsset(rec.get('asset'));
  if (asset.get('current_loan') === rec.id) {
    asset.set('availability_status', 'available');
    asset.set('current_loan', '');
    $app.save(asset);
  }
  logOp(auth, '拒絕', 'loan', rec.id, rec.get('asset'), { reason: reason });
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/loans/{id}/checkout', function (e) {
  var rec = checkoutLoan(actorOf(e), requireLoan(e.request.pathValue('id')));
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/loans/{id}/return', function (e) {
  var rec = completeReturn(actorOf(e), requireLoan(e.request.pathValue('id')), bodyOf(e));
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/loans/{id}/return-request', function (e) {
  var auth = actorOf(e);
  var rec = requireLoan(e.request.pathValue('id'));
  var settings = settingsRecord();
  if (!isStaff(auth) && settings.get('allow_self_checkout') === true) {
    rec = completeReturn(auth, rec, bodyOf(e));
    return e.json(200, exportRec(rec));
  }
  if (rec.get('returned_at') || rec.get('status') === 'returned') throw new BadRequestError('此筆借用已完成歸還，不可重複歸還');
  var status = rec.get('status');
  if (status !== 'checked_out' && status !== 'overdue' && status !== 'return_pending') throw new BadRequestError('目前狀態不可辦理歸還');
  if (!isStaff(auth) && rec.get('borrower') !== auth.id) throw new ForbiddenError('只能歸還自己的借用');
  var data = bodyOf(e);
  rec.set('status', 'return_pending');
  if (trim(data.return_location)) rec.set('return_location', trim(data.return_location));
  if (data.return_result) rec.set('return_result', data.return_result);
  if (data.return_condition) rec.set('return_condition', data.return_condition);
  $app.save(rec);
  logOp(auth, '歸還申請', 'loan', rec.id, rec.get('asset'), { loan_number: rec.get('loan_number') });
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/usage', function (e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有登記使用的權限');
  var data = bodyOf(e);
  var asset = requireAsset(data.asset_id);
  if (!trim(data.user_name)) throw new BadRequestError('請填寫使用人');
  if (!trim(data.department)) throw new BadRequestError('請填寫使用單位');
  if (!data.used_at) throw new BadRequestError('請填寫使用日期與時間');
  if (!trim(data.purpose)) throw new BadRequestError('請填寫使用用途');
  var col = $app.findCollectionByNameOrId('hkp_usage_records');
  var rec = new Record(col);
  rec.set('asset', asset.id);
  rec.set('user_name', trim(data.user_name));
  rec.set('department', trim(data.department));
  rec.set('used_at', data.used_at);
  rec.set('purpose', trim(data.purpose));
  rec.set('note', trim(data.note));
  rec.set('created_by', auth.id);
  $app.save(rec);
  asset.set('usage_count', Number(asset.get('usage_count') || 0) + 1);
  $app.save(asset);
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/audits', function (e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有盤點權限');
  var data = bodyOf(e);
  var asset = requireAsset(data.asset_id);
  if (!trim(data.auditor)) throw new BadRequestError('請填寫盤點人');
  if (!trim(data.actual_location)) throw new BadRequestError('請填寫本次實際位置');
  if (!data.result) throw new BadRequestError('請選擇盤點結果');
  if (data.result === '位置正確' && trim(data.actual_location) !== trim(data.registered_location || '')) {
    throw new BadRequestError('實際位置與系統登記位置不同，請改選「位置異常」');
  }
  var col = $app.findCollectionByNameOrId('hkp_inventory_audits');
  var rec = new Record(col);
  rec.set('asset', asset.id);
  rec.set('registered_location', data.registered_location || '');
  rec.set('actual_location', trim(data.actual_location));
  rec.set('result', data.result);
  rec.set('auditor', trim(data.auditor));
  rec.set('audited_at', data.audited_at || nowIso());
  rec.set('note', trim(data.note));
  rec.set('created_by', auth.id);
  $app.save(rec);
  var nextAudit = '待盤點';
  if (data.result === '位置正確') nextAudit = '已盤點';
  if (data.result === '位置異常') nextAudit = '位置異常';
  if (data.result === '找不到物品') nextAudit = '找不到物品';
  if (data.result === '物品損壞') nextAudit = '物品損壞';
  asset.set('last_audit_at', rec.get('audited_at'));
  asset.set('audit_status', nextAudit);
  $app.save(asset);
  logOp(auth, '盤點', 'audit', rec.id, asset.id, { result: data.result });
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/assets/{id}/location', function (e) {
  var auth = actorOf(e);
  if (!isStaff(auth)) throw new ForbiddenError('沒有修改位置的權限');
  var data = bodyOf(e);
  var asset = requireAsset(e.request.pathValue('id'));
  if (!trim(data.to_location)) throw new BadRequestError('請填寫新的存放位置');
  var from = trim(data.from_location || asset.get('location') || '');
  if (trim(data.to_location) === from) throw new BadRequestError('新位置與目前位置相同');
  var histCol = $app.findCollectionByNameOrId('hkp_location_history');
  var hist = new Record(histCol);
  hist.set('asset', asset.id);
  hist.set('from_location', from);
  hist.set('to_location', trim(data.to_location));
  hist.set('reason', trim(data.reason) || '更新存放位置');
  hist.set('operator', auth.id);
  hist.set('operator_name', displayName(auth));
  $app.save(hist);
  asset.set('location', trim(data.to_location));
  $app.save(asset);
  logOp(auth, '位置異動', 'asset', asset.id, asset.id, { to: trim(data.to_location) });
  return e.json(200, exportRec(asset));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/assets/{id}/active', function (e) {
  var auth = actorOf(e);
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以停用財產');
  var asset = requireAsset(e.request.pathValue('id'));
  var isActive = bodyOf(e).is_active !== false;
  asset.set('is_active', isActive);
  $app.save(asset);
  logOp(auth, isActive ? '修改財產' : '停用財產', 'asset', asset.id, asset.id, { property_id: asset.get('property_id'), is_active: isActive });
  return e.json(200, exportRec(asset));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/settings', function (e) {
  var auth = actorOf(e);
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以修改系統設定');
  var data = bodyOf(e);
  var rec = settingsRecord();
  if (data.require_loan_approval != null) rec.set('require_loan_approval', !!data.require_loan_approval);
  if (data.allow_self_checkout != null) rec.set('allow_self_checkout', !!data.allow_self_checkout);
  if (data.default_loan_days != null) rec.set('default_loan_days', Number(data.default_loan_days));
  rec.set('updated_by', auth.id);
  $app.save(rec);
  logOp(auth, '修改系統設定', 'settings', rec.id, '', exportRec(rec));
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

routerAdd('POST', '/api/hkp/users/{id}', function (e) {
  var auth = actorOf(e);
  if (!isAdmin(auth)) throw new ForbiddenError('只有管理者可以修改使用者角色');
  var data = bodyOf(e);
  var rec = $app.findRecordById('hkp_users', e.request.pathValue('id'));
  if (data.role) {
    if (data.role !== 'borrower' && data.role !== 'staff' && data.role !== 'admin') throw new BadRequestError('角色不正確');
    rec.set('role', data.role);
  }
  if (data.is_active != null) rec.set('is_active', !!data.is_active);
  if (data.display_name) rec.set('display_name', trim(data.display_name));
  if (data.department != null) rec.set('department', trim(data.department));
  if (data.school_number != null) rec.set('school_number', trim(data.school_number));
  $app.save(rec);
  logOp(auth, '角色修改', 'profile', rec.id, '', { role: rec.get('role'), is_active: rec.get('is_active') });
  return e.json(200, exportRec(rec));
}, $apis.requireAuth());

onRecordCreateRequest(function (e) {
  if (e.collection.name !== 'hkp_users') {
    e.next();
    return;
  }
  if (!e.hasSuperuserAuth()) {
    e.record.set('role', 'borrower');
    e.record.set('is_active', true);
    if (!e.record.get('display_name')) {
      var email = String(e.record.get('email') || '');
      e.record.set('display_name', email.split('@')[0] || '使用者');
    }
  }
  e.next();
}, 'hkp_users');
