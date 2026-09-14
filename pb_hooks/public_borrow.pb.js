/// <reference path="../pb_data/types.d.ts" />
/**
 * Anonymous borrow/reserve/return routes.
 * Install on the PocketBase server at pb_hooks/public_borrow.pb.js and restart.
 * db.keson.pro does not load this file from GitHub or Vercel.
 * Overlap is also enforced by the hkp_time_locks unique index; this route must write those rows.
 * Does not store plaintext tokens or write full phone numbers into logs.
 */

var VERIFY_FAIL = '借用資料驗證失敗，請確認借用編號、姓名及電話。';
var failWindow = {};

function publicBody(e) {
  try {
    return e.requestInfo().body || {};
  } catch (err) {
    return {};
  }
}

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function phoneOf(value) {
  return clean(value).replace(/\s+/g, '').replace(/分機/g, '#').replace(/＃/g, '#');
}

function maskPhone(value) {
  var phone = phoneOf(value);
  if (!phone) return '';
  if (phone.length <= 4) return '****';
  var start = phone.indexOf('09') === 0 ? 4 : Math.min(5, Math.floor(phone.length / 2));
  var end = phone.length - 3;
  if (end <= start) return phone.slice(0, 2) + '***';
  return phone.slice(0, start) + '***' + phone.slice(end);
}

function clientKey(e) {
  try {
    return String(e.realIP() || e.requestInfo().headers['x_forwarded_for'] || 'unknown');
  } catch (err) {
    return 'unknown';
  }
}

function tooMany(e) {
  var key = clientKey(e);
  var now = Date.now();
  var row = failWindow[key] || { count: 0, at: now };
  if (now - row.at > 10 * 60 * 1000) row = { count: 0, at: now };
  failWindow[key] = row;
  return row.count >= 8;
}

function noteFail(e) {
  var key = clientKey(e);
  var now = Date.now();
  var row = failWindow[key] || { count: 0, at: now };
  if (now - row.at > 10 * 60 * 1000) row = { count: 0, at: now };
  row.count += 1;
  row.at = now;
  failWindow[key] = row;
}

function tokenHash(token) {
  return $security.sha256(String(token || ''));
}

function findByNumber(collection, field, number) {
  var rows = $app.findRecordsByFilter(collection, field + ' = {:n}', '-created', 1, 0, { n: number });
  return rows.length ? rows[0] : null;
}

function identityMatches(rec, name, phone, token) {
  return clean(rec.get('borrower_name')) === clean(name)
    && phoneOf(rec.get('borrower_phone')) === phoneOf(phone)
    && rec.get('public_token_hash') === tokenHash(token);
}

function requestNumber(prefix) {
  return prefix + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + $security.randomStringWithAlphabet(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
}

routerAdd('POST', '/api/hkp/public/borrow', function (e) {
  if (tooMany(e)) throw new BadRequestError(VERIFY_FAIL);
  var body = publicBody(e);
  if (!body.privacyAck) throw new BadRequestError('請先勾選個資使用告知');
  if (!body.assetId || !clean(body.purpose) || !body.expectedReturnAt) throw new BadRequestError('請填寫完整借用資料');
  if (new Date(body.expectedReturnAt).getTime() <= Date.now()) throw new BadRequestError('預計歸還時間必須晚於現在');
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
  var number = requestNumber('BR');
  rec.set('request_number', number);
  rec.set('borrower_unit', clean(body.unit));
  rec.set('borrower_name', clean(body.name));
  rec.set('borrower_phone', phoneOf(body.phone));
  rec.set('asset', body.assetId);
  rec.set('purpose', clean(body.purpose));
  rec.set('requested_at', new Date().toISOString());
  rec.set('expected_return_at', body.expectedReturnAt);
  rec.set('status', 'pending');
  rec.set('public_token_hash', tokenHash(body.token));
  rec.set('notes', clean(body.notes));
  rec.set('checkout_condition', clean(body.condition));
  rec.set('privacy_ack', true);
  $app.save(rec);
  return e.json(200, { requestNumber: number });
});

function hourSlots(startAt, endAt) {
  var start = new Date(startAt).getTime();
  var end = new Date(endAt).getTime();
  var hour = 60 * 60 * 1000;
  if (!start || !end || end <= start || start <= Date.now() || end - start > 7 * 24 * hour) {
    throw new BadRequestError('預借時段不正確');
  }
  var slots = [];
  var cursor = Math.floor(start / hour) * hour;
  while (cursor < end) {
    slots.push(new Date(cursor).toISOString());
    cursor += hour;
    if (slots.length > 168) throw new BadRequestError('預借時段過長');
  }
  return slots;
}

function releaseLocks(rows) {
  for (var i = 0; i < rows.length; i++) {
    rows[i].set('status', 'cancelled');
    rows[i].set('slot_start', 'released:' + rows[i].id);
    $app.save(rows[i]);
  }
}

routerAdd('POST', '/api/hkp/public/reserve', function (e) {
  if (tooMany(e)) throw new BadRequestError(VERIFY_FAIL);
  var body = publicBody(e);
  if (!body.privacyAck) throw new BadRequestError('請先勾選個資使用告知');
  var slots = hourSlots(body.startAt, body.endAt);
  var overlap = $app.findRecordsByFilter(
    'hkp_reservations_v2',
    'asset = {:asset} && (status = "pending" || status = "approved") && start_at < {:end} && end_at > {:start}',
    '',
    1,
    0,
    { asset: body.assetId, start: body.startAt, end: body.endAt }
  );
  if (overlap.length) throw new BadRequestError('此時段與其他有效預借重疊');
  var col = $app.findCollectionByNameOrId('hkp_time_locks');
  var number = requestNumber('RV');
  var created = [];
  try {
    for (var i = 0; i < slots.length; i++) {
      var rec = new Record(col);
      rec.set('reservation_number', number);
      rec.set('asset', body.assetId);
      rec.set('slot_start', slots[i]);
      rec.set('start_at', body.startAt);
      rec.set('end_at', body.endAt);
      rec.set('borrower_unit', clean(body.unit));
      rec.set('borrower_name', clean(body.name));
      rec.set('borrower_name_hash', tokenHash(clean(body.name)));
      rec.set('borrower_phone', phoneOf(body.phone));
      rec.set('purpose', clean(body.purpose));
      rec.set('notes', clean(body.notes));
      rec.set('status', 'pending');
      rec.set('public_token_hash', tokenHash(body.token));
      rec.set('privacy_ack', true);
      $app.save(rec);
      created.push(rec);
    }
  } catch (err) {
    releaseLocks(created);
    throw new BadRequestError('此時段與其他有效預借重疊');
  }
  return e.json(200, { requestNumber: number });
});

routerAdd('POST', '/api/hkp/public/lookup', function (e) {
  if (tooMany(e)) throw new BadRequestError(VERIFY_FAIL);
  var body = publicBody(e);
  var rec = findByNumber('hkp_borrow_requests', 'request_number', clean(body.requestNumber))
    || findByNumber('hkp_reservations_v2', 'reservation_number', clean(body.requestNumber));
  if (!rec || !identityMatches(rec, body.name, body.phone, body.token)) {
    noteFail(e);
    throw new BadRequestError(VERIFY_FAIL);
  }
  return e.json(200, {
    requestNumber: rec.get('request_number') || rec.get('reservation_number'),
    status: rec.get('status'),
    name: rec.get('borrower_name'),
    phoneMasked: maskPhone(rec.get('borrower_phone')),
    purpose: rec.get('purpose') || ''
  });
});

routerAdd('POST', '/api/hkp/public/cancel', function (e) {
  if (tooMany(e)) throw new BadRequestError(VERIFY_FAIL);
  var body = publicBody(e);
  var number = clean(body.requestNumber);
  var locks = $app.findRecordsByFilter('hkp_time_locks', 'reservation_number = {:n} && status = "pending"', '', 200, 0, { n: number });
  var legacy = findByNumber('hkp_reservations_v2', 'reservation_number', number);
  var sample = locks.length ? locks[0] : legacy;
  if (!sample || !identityMatches(sample, body.name, body.phone, body.token) || sample.get('status') !== 'pending') {
    noteFail(e);
    throw new BadRequestError(VERIFY_FAIL);
  }
  if (locks.length) releaseLocks(locks);
  if (legacy && legacy.get('status') === 'pending') {
    legacy.set('status', 'cancelled');
    $app.save(legacy);
  }
  return e.json(200, { ok: true });
});

routerAdd('POST', '/api/hkp/public/return', function (e) {
  if (tooMany(e)) throw new BadRequestError(VERIFY_FAIL);
  var body = publicBody(e);
  var rec = findByNumber('hkp_borrow_requests', 'request_number', clean(body.requestNumber));
  if (!rec || !identityMatches(rec, body.name, body.phone, body.token) || rec.get('status') !== 'borrowed') {
    noteFail(e);
    throw new BadRequestError(VERIFY_FAIL);
  }
  var col = $app.findCollectionByNameOrId('hkp_return_requests');
  var row = new Record(col);
  row.set('borrow_request', rec.id);
  row.set('request_number', rec.get('request_number'));
  row.set('asset', rec.get('asset'));
  row.set('borrower_name', clean(body.name));
  row.set('borrower_phone', phoneOf(body.phone));
  row.set('condition', clean(body.condition));
  row.set('notes', clean(body.notes));
  row.set('status', 'pending');
  row.set('requested_at', new Date().toISOString());
  $app.save(row);
  rec.set('status', 'return_pending');
  $app.save(rec);
  return e.json(200, { ok: true });
});
