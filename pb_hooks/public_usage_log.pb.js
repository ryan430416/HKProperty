/// <reference path="../pb_data/types.d.ts" />
/**
 * Public annual usage-log fill (no login).
 * POST /api/hkp/public/usage-log
 * Does not change asset availability (backfill semantics).
 */

routerAdd('POST', '/api/hkp/public/usage-log', function (e) {
  var h = require(__hooks + '/hkp_shared.js');
  try {
    if (h.tooMany(e)) throw new BadRequestError('嘗試次數過多，請稍後再試');
    var body = h.publicBody(e);
    if (!body.privacyAck) throw new BadRequestError('請先勾選個資使用告知');

    var unit = h.clean(body.unit);
    var title = h.clean(body.title);
    var name = h.clean(body.name);
    var purpose = h.clean(body.purpose);
    var borrowerNumber = h.clean(body.borrowerNumber || body.borrower_number);
    var note = h.clean(body.note);
    var borrowedAt = body.borrowedAt || body.checkout_at || body.checkoutAt;
    var returnedAt = body.returnedAt || body.returned_at;

    if (unit.length < 2 || unit.length > 50) throw new BadRequestError('請填寫單位（2–50 字）');
    if (!title || title.length > 40) throw new BadRequestError('請填寫職稱');
    if (name.length < 2 || name.length > 30) throw new BadRequestError('請填寫姓名');
    if (!purpose || purpose.length > 80) throw new BadRequestError('請填寫借用用途');
    if (!borrowedAt || !returnedAt) throw new BadRequestError('請填寫借用與歸還日期');
    if (new Date(returnedAt).getTime() < new Date(borrowedAt).getTime()) {
      throw new BadRequestError('歸還日期不得早於借用日期');
    }
    if (borrowerNumber && borrowerNumber.length < 4) {
      throw new BadRequestError('學號或教職員編號至少 4 個字元');
    }

    var asset;
    try {
      if (body.assetId) asset = $app.findRecordById('hkp_assets', body.assetId);
      else if (body.propertyId) {
        var rows = $app.findRecordsByFilter(
          'hkp_assets',
          'property_id = {:pid} && is_active != false',
          '',
          1,
          0,
          { pid: h.clean(body.propertyId) }
        );
        asset = rows.length ? rows[0] : null;
      }
    } catch (err) {
      asset = null;
    }
    if (!asset || asset.get('is_active') === false) throw new BadRequestError('找不到財產');

    var day = String(borrowedAt).slice(0, 10);
    var dup = $app.findRecordsByFilter(
      'hkp_loan_records',
      'property_id = {:pid} && borrower_name = {:name} && checkout_at >= {:from} && checkout_at <= {:to} && status = "returned"',
      '',
      1,
      0,
      {
        pid: String(asset.get('property_id') || ''),
        name: name,
        from: day + ' 00:00:00.000Z',
        to: day + ' 23:59:59.999Z'
      }
    );
    if (dup.length) throw new BadRequestError('已有相同財產、借用日與借用人的紀錄，請勿重複填報');

    if (!borrowerNumber) {
      borrowerNumber = 'PUBLIC-' + day.replace(/-/g, '') + '-' + $security.randomStringWithAlphabet(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    }

    var loanNumber = 'LOAN-' + day.replace(/-/g, '') + '-F' + $security.randomStringWithAlphabet(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    var col = $app.findCollectionByNameOrId('hkp_loan_records');
    var rec = new Record(col);
    rec.set('loan_number', loanNumber);
    rec.set('asset', asset.id);
    rec.set('property_id', asset.get('property_id'));
    rec.set('property_name', asset.get('name'));
    rec.set('borrower_name', name);
    rec.set('borrower_number', borrowerNumber);
    rec.set('borrower_department', unit);
    try { rec.set('borrower_title', title); } catch (err) { /* older schema */ }
    try { rec.set('entry_source', 'backfill'); } catch (err) { /* older schema */ }
    rec.set('purpose', purpose.slice(0, 80));
    rec.set('requested_at', borrowedAt);
    rec.set('checkout_at', borrowedAt);
    rec.set('expected_return_at', returnedAt);
    rec.set('returned_at', returnedAt);
    try { rec.set('checkout_method', 'backfill'); } catch (err) { rec.set('checkout_method', 'admin'); }
    rec.set('checkout_operator', '公開填報');
    rec.set('return_operator', '公開填報');
    rec.set('return_result', '正常歸還');
    rec.set('return_location', asset.get('location') || '');
    rec.set('status', 'returned');
    rec.set('note', note || '公開器材使用紀錄填報');
    if (!note && title) {
      /* ensure title survives older schemas without borrower_title */
    }
    $app.save(rec);

    h.safeLog('public_usage_fill_created', {
      loanNumber: loanNumber,
      propertyId: String(asset.get('property_id') || '')
    });
    return e.json(200, {
      loanNumber: loanNumber,
      propertyId: String(asset.get('property_id') || ''),
      propertyName: String(asset.get('name') || '')
    });
  } catch (err) {
    h.safeLog('public_usage_fill_error', { status: err && err.status ? err.status : 500 });
    throw err;
  }
});
