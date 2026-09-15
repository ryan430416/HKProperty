/// <reference path="../pb_data/types.d.ts" />
/**
 * Staff-only borrow confirm / return / reservation review routes.
 * PocketBase >= 0.23 JSVM. Install at:
 *   <PB_ROOT>/pb_hooks/staff_borrow.pb.js
 *   <PB_ROOT>/pb_hooks/hkp_shared.js
 *
 * Checkout + usage are written in one transaction to avoid half-complete states.
 */

routerAdd('POST', '/api/hkp/staff/borrow-confirm', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    var auth = h.requireStaff(e);
    var body = h.publicBody(e);
    var id = h.clean(body.id);
    if (!id) throw new BadRequestError('缺少申請編號');

    var result = $app.runInTransaction(function (txApp) {
      var request;
      try {
        request = txApp.findRecordById('hkp_borrow_requests', id);
      } catch (err) {
        throw new BadRequestError('找不到借用申請');
      }
      if (String(request.get('status') || '') !== 'pending') {
        throw new BadRequestError('此申請不是待確認借出');
      }

      var already = txApp.findRecordsByFilter(
        'hkp_borrow_records',
        'borrow_request = {:id}',
        '',
        1,
        0,
        { id: id }
      );
      if (already.length) throw new BadRequestError('此申請已確認，請勿重複送出');

      var assetId = request.get('asset');
      var asset;
      try {
        asset = txApp.findRecordById('hkp_assets', assetId);
      } catch (err) {
        throw new BadRequestError('找不到財產');
      }

      var active = txApp.findRecordsByFilter(
        'hkp_borrow_requests',
        'asset = {:asset} && id != {:id} && (status = "borrowed" || status = "return_pending")',
        '',
        1,
        0,
        { asset: assetId, id: id }
      );
      if (active.length) throw new BadRequestError('同一財產不可同時借給兩人');
      if (String(asset.get('availability_status') || '') !== 'available') {
        throw new BadRequestError('此財產目前不可借出');
      }

      var borrowedAt = new Date().toISOString();
      request.set('status', 'borrowed');
      txApp.save(request);

      var recordCol = txApp.findCollectionByNameOrId('hkp_borrow_records');
      var record = new Record(recordCol);
      record.set('borrow_request', id);
      record.set('asset', assetId);
      record.set('borrower_unit', request.get('borrower_unit'));
      record.set('borrower_name', request.get('borrower_name'));
      record.set('borrower_phone', request.get('borrower_phone'));
      record.set('purpose', request.get('purpose') || '');
      record.set('borrowed_at', borrowedAt);
      record.set('expected_return_at', request.get('expected_return_at'));
      record.set('status', 'borrowed');
      record.set('checkout_condition', request.get('checkout_condition') || '');
      record.set('processed_by', auth.id);
      txApp.save(record);

      asset.set('availability_status', 'checked_out');
      txApp.save(asset);

      var usageNote = '借用確認 ' + String(request.get('request_number') || id);
      var usageDup = txApp.findRecordsByFilter(
        'hkp_usage_records',
        'asset = {:asset} && note = {:note}',
        '',
        1,
        0,
        { asset: assetId, note: usageNote }
      );
      if (!usageDup.length) {
        var usageCol = txApp.findCollectionByNameOrId('hkp_usage_records');
        var usage = new Record(usageCol);
        usage.set('asset', assetId);
        usage.set('user_name', request.get('borrower_name'));
        usage.set('user_number', 'PUBLIC');
        usage.set('department', request.get('borrower_unit'));
        usage.set('used_at', borrowedAt);
        usage.set('purpose', request.get('purpose') || '借用');
        usage.set('note', usageNote);
        usage.set('property_id', asset.get('property_id') || '');
        usage.set('property_name', asset.get('name') || '');
        txApp.save(usage);
      }

      return {
        requestNumber: request.get('request_number'),
        borrowRecordId: record.id,
        assetId: assetId
      };
    });

    h.safeLog('staff_borrow_confirm_ok', {
      requestNumber: result.requestNumber,
      assetId: result.assetId,
      staffId: auth.id
    });
    return e.json(200, result);
  } catch (err) {
    var h2 = require(__hooks + '/hkp_shared.js');
    h2.safeLog('staff_borrow_confirm_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
}, $apis.requireAuth('hkp_staff_users'));

routerAdd('POST', '/api/hkp/staff/borrow-return-confirm', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    var auth = h.requireStaff(e);
    var body = h.publicBody(e);
    var id = h.clean(body.id);
    if (!id) throw new BadRequestError('缺少申請編號');

    var result = $app.runInTransaction(function (txApp) {
      var request;
      try {
        request = txApp.findRecordById('hkp_borrow_requests', id);
      } catch (err) {
        throw new BadRequestError('找不到借用申請');
      }
      if (String(request.get('status') || '') !== 'return_pending') {
        throw new BadRequestError('此筆不是待確認歸還');
      }
      var now = new Date().toISOString();
      request.set('status', 'returned');
      txApp.save(request);

      var records = txApp.findRecordsByFilter(
        'hkp_borrow_records',
        'borrow_request = {:id} && status != "returned"',
        '',
        50,
        0,
        { id: id }
      );
      for (var i = 0; i < records.length; i++) {
        records[i].set('status', 'returned');
        records[i].set('returned_at', now);
        records[i].set('returned_by', auth.id);
        txApp.save(records[i]);
      }

      if (request.get('asset')) {
        var asset = txApp.findRecordById('hkp_assets', request.get('asset'));
        asset.set('availability_status', 'available');
        asset.set('current_loan', null);
        txApp.save(asset);
      }
      return { ok: true, requestNumber: request.get('request_number') };
    });

    h.safeLog('staff_return_confirm_ok', { requestNumber: result.requestNumber, staffId: auth.id });
    return e.json(200, result);
  } catch (err) {
    var h2 = require(__hooks + '/hkp_shared.js');
    h2.safeLog('staff_return_confirm_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
}, $apis.requireAuth('hkp_staff_users'));

routerAdd('POST', '/api/hkp/staff/reservation-review', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    var auth = h.requireStaff(e);
    var body = h.publicBody(e);
    var number = h.clean(body.id || body.reservationNumber);
    var action = h.clean(body.action);
    if (!number || (action !== 'approve' && action !== 'reject')) {
      throw new BadRequestError('預借審核參數不正確');
    }
    var status = action === 'approve' ? 'approved' : 'rejected';
    var rows = $app.findRecordsByFilter(
      'hkp_time_locks',
      'reservation_number = {:n} && status = "pending"',
      '',
      200,
      0,
      { n: number }
    );
    if (!rows.length) throw new BadRequestError('只能處理待審核預借');
    for (var i = 0; i < rows.length; i++) {
      rows[i].set('status', status);
      if (status === 'rejected') rows[i].set('slot_start', 'released:' + rows[i].id);
      $app.save(rows[i]);
    }
    h.safeLog('staff_reservation_review_ok', { reservationNumber: number, status: status, staffId: auth.id });
    return e.json(200, { ok: true, status: status });
  } catch (err) {
    var h2 = require(__hooks + '/hkp_shared.js');
    h2.safeLog('staff_reservation_review_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
}, $apis.requireAuth('hkp_staff_users'));
