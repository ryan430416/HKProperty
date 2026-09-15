/// <reference path="../pb_data/types.d.ts" />
/**
 * Production public borrow routes for db.keson.pro (PocketBase >= 0.23).
 * Install beside the PocketBase executable:
 *   <PB_ROOT>/pb_hooks/public_borrow.pb.js
 *   <PB_ROOT>/pb_hooks/hkp_shared.js
 *
 * Do not put secrets in this file. Do not log name/phone/token.
 */

routerAdd('GET', '/api/hkp/hooks-health', function (e) {
  return e.json(200, { ok: true, hooks: 'hkp-public', api: 'v0.23+' });
});

routerAdd('POST', '/api/hkp/public/borrow', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError(h.VERIFY_FAIL);
    var body = h.publicBody(e);
    if (!body.privacyAck) throw new BadRequestError('請先勾選個資使用告知');
    if (!body.assetId || !h.clean(body.purpose) || !body.expectedReturnAt) {
      throw new BadRequestError('請填寫完整借用資料');
    }
    if (h.clean(body.purpose).length > 80 || h.clean(body.notes).length > 200) {
      throw new BadRequestError('請填寫完整借用資料');
    }
    if (new Date(body.expectedReturnAt).getTime() <= Date.now()) {
      throw new BadRequestError('預計歸還時間必須晚於現在');
    }
    var person = h.validatePerson(body.unit, body.name, body.phone, true);
    var asset;
    try {
      asset = $app.findRecordById('hkp_assets', body.assetId);
    } catch (err) {
      throw new BadRequestError('找不到財產');
    }
    if (!asset || asset.get('is_active') === false || asset.get('is_borrowable') === false) {
      throw new BadRequestError('此財產目前不可借用');
    }
    if (String(asset.get('availability_status') || '') !== 'available') {
      throw new BadRequestError('此財產目前已借出或待歸還');
    }
    var active = $app.findRecordsByFilter(
      'hkp_borrow_requests',
      'asset = {:asset} && (status = "borrowed" || status = "return_pending")',
      '',
      1,
      0,
      { asset: body.assetId }
    );
    if (active.length) throw new BadRequestError('此財產目前已借出或待歸還');
    var col = $app.findCollectionByNameOrId('hkp_borrow_requests');
    var rec = new Record(col);
    var number = h.requestNumber('BR');
    rec.set('request_number', number);
    rec.set('borrower_unit', person.unit);
    rec.set('borrower_name', person.name);
    rec.set('borrower_name_hash', h.tokenHash(person.name));
    rec.set('borrower_phone', person.phone);
    rec.set('asset', body.assetId);
    rec.set('purpose', h.clean(body.purpose));
    rec.set('requested_at', new Date().toISOString());
    rec.set('expected_return_at', body.expectedReturnAt);
    rec.set('status', 'pending');
    rec.set('public_token_hash', h.tokenHash(body.token));
    rec.set('notes', h.clean(body.notes));
    rec.set('checkout_condition', h.clean(body.condition));
    rec.set('privacy_ack', true);
    $app.save(rec);
    h.safeLog('public_borrow_created', { requestNumber: number, assetId: String(body.assetId) });
    return e.json(200, { requestNumber: number });
  } catch (err) {
    h.safeLog('public_borrow_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});

routerAdd('POST', '/api/hkp/public/reserve', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError(h.VERIFY_FAIL);
    var body = h.publicBody(e);
    if (!body.privacyAck) throw new BadRequestError('請先勾選個資使用告知');
    if (!body.assetId) throw new BadRequestError('請填寫完整借用資料');
    var person = h.validatePerson(body.unit, body.name, body.phone, true);
    var slots = h.hourSlots(body.startAt, body.endAt);
    try {
      $app.findRecordById('hkp_assets', body.assetId);
    } catch (err) {
      throw new BadRequestError('找不到財產');
    }
    var col = $app.findCollectionByNameOrId('hkp_time_locks');
    var number = h.requestNumber('RV');
    var created = [];
    try {
      for (var i = 0; i < slots.length; i++) {
        var rec = new Record(col);
        rec.set('reservation_number', number);
        rec.set('asset', body.assetId);
        rec.set('slot_start', slots[i]);
        rec.set('start_at', body.startAt);
        rec.set('end_at', body.endAt);
        rec.set('borrower_unit', person.unit);
        rec.set('borrower_name', person.name);
        rec.set('borrower_name_hash', h.tokenHash(person.name));
        rec.set('borrower_phone', person.phone);
        rec.set('purpose', h.clean(body.purpose));
        rec.set('notes', h.clean(body.notes));
        rec.set('status', 'pending');
        rec.set('public_token_hash', h.tokenHash(body.token));
        rec.set('privacy_ack', true);
        $app.save(rec);
        created.push(rec);
      }
    } catch (err) {
      h.releaseLocks($app, created);
      throw new BadRequestError('此時段與其他有效預借重疊');
    }
    h.safeLog('public_reserve_created', { requestNumber: number, slots: slots.length });
    return e.json(200, { requestNumber: number });
  } catch (err) {
    h.safeLog('public_reserve_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});

routerAdd('POST', '/api/hkp/public/lookup', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError(h.VERIFY_FAIL);
    var body = h.publicBody(e);
    var rec = h.findByNumber($app, 'hkp_borrow_requests', 'request_number', h.clean(body.requestNumber))
      || h.findByNumber($app, 'hkp_time_locks', 'reservation_number', h.clean(body.requestNumber));
    if (!rec || !h.identityMatches(rec, body.name, body.phone, body.token)) {
      h.noteFail(e);
      throw new BadRequestError(h.VERIFY_FAIL);
    }
    return e.json(200, {
      requestNumber: rec.get('request_number') || rec.get('reservation_number'),
      status: rec.get('status'),
      phoneMasked: h.maskPhone(rec.get('borrower_phone')),
      purpose: rec.get('purpose') || ''
    });
  } catch (err) {
    h.safeLog('public_lookup_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});

routerAdd('POST', '/api/hkp/public/cancel', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError(h.VERIFY_FAIL);
    var body = h.publicBody(e);
    var number = h.clean(body.requestNumber);
    var locks = $app.findRecordsByFilter('hkp_time_locks', 'reservation_number = {:n} && status = "pending"', '', 200, 0, { n: number });
    var sample = locks.length ? locks[0] : null;
    if (!sample || !h.identityMatches(sample, body.name, body.phone, body.token) || sample.get('status') !== 'pending') {
      h.noteFail(e);
      throw new BadRequestError(h.VERIFY_FAIL);
    }
    h.releaseLocks($app, locks);
    h.safeLog('public_cancel_ok', { requestNumber: number });
    return e.json(200, { ok: true });
  } catch (err) {
    h.safeLog('public_cancel_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});

routerAdd('POST', '/api/hkp/public/return', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError(h.VERIFY_FAIL);
    var body = h.publicBody(e);
    h.validatePerson(body.unit || '歸還', body.name, body.phone, false);
    var rec = h.findByNumber($app, 'hkp_borrow_requests', 'request_number', h.clean(body.requestNumber));
    if (!rec || !h.identityMatches(rec, body.name, body.phone, body.token) || rec.get('status') !== 'borrowed') {
      h.noteFail(e);
      throw new BadRequestError(h.VERIFY_FAIL);
    }
    if (h.clean(body.propertyId)) {
      var asset;
      try {
        asset = $app.findRecordById('hkp_assets', rec.get('asset'));
      } catch (err) {
        h.noteFail(e);
        throw new BadRequestError(h.VERIFY_FAIL);
      }
      if (String(asset.get('property_id') || '') !== h.clean(body.propertyId)) {
        h.noteFail(e);
        throw new BadRequestError(h.VERIFY_FAIL);
      }
    }
    if (!h.clean(body.condition)) throw new BadRequestError('請填寫物品歸還狀況');
    rec.set('status', 'return_pending');
    $app.save(rec);
    h.safeLog('public_return_ok', { requestNumber: rec.get('request_number') });
    return e.json(200, { ok: true });
  } catch (err) {
    h.safeLog('public_return_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});
