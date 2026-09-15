/**
 * Shared helpers for HKProperty production hooks (PocketBase >= 0.23 JSVM).
 * This file is NOT a hook entrypoint (no .pb.js suffix). Load with:
 *   var h = require(__hooks + '/hkp_shared.js');
 *
 * Never store or log names, phones, tokens, or verification codes.
 */
var VERIFY_FAIL = '借用資料驗證失敗，請確認申請編號、姓名、電話及驗證碼。';
var failWindow = {};

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

function publicBody(e) {
  try {
    return e.requestInfo().body || {};
  } catch (err) {
    return {};
  }
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

function requestNumber(prefix) {
  return prefix + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + $security.randomStringWithAlphabet(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
}

function findByNumber(app, collection, field, number) {
  var rows = app.findRecordsByFilter(collection, field + ' = {:n}', '-created', 1, 0, { n: number });
  return rows.length ? rows[0] : null;
}

function identityMatches(rec, name, phone, token) {
  return clean(rec.get('borrower_name')) === clean(name)
    && phoneOf(rec.get('borrower_phone')) === phoneOf(phone)
    && rec.get('public_token_hash') === tokenHash(token);
}

function validatePerson(unit, name, phone, requireUnit) {
  var u = clean(unit);
  var n = clean(name);
  var p = phoneOf(phone);
  if (requireUnit && (u.length < 2 || u.length > 50)) throw new BadRequestError('請填寫完整借用資料');
  if (n.length < 2 || n.length > 30) throw new BadRequestError('請填寫完整借用資料');
  if (!p || p.length > 20) throw new BadRequestError('請填寫完整借用資料');
  return { unit: u, name: n, phone: p };
}

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

function releaseLocks(app, rows) {
  for (var i = 0; i < rows.length; i++) {
    rows[i].set('status', 'cancelled');
    rows[i].set('slot_start', 'released:' + rows[i].id);
    app.save(rows[i]);
  }
}

function requireStaff(e) {
  var auth = e.auth;
  if (!auth) throw new UnauthorizedError('請先登入');
  var collectionName = '';
  try {
    collectionName = String(auth.collection().name || '');
  } catch (err) {
    collectionName = '';
  }
  if (collectionName !== 'hkp_staff_users') throw new ForbiddenError('沒有權限');
  if (auth.get('is_active') === false || auth.get('active') === false) {
    throw new ForbiddenError('此帳號已停用');
  }
  var role = String(auth.get('role') || '');
  if (role !== 'staff' && role !== 'admin') throw new ForbiddenError('沒有權限');
  return auth;
}

function safeLog(event, detail) {
  try {
    var payload = detail || {};
    console.log('[hkp-hooks]', event, JSON.stringify(payload));
  } catch (err) {
    console.log('[hkp-hooks]', event, 'log_failed');
  }
}

module.exports = {
  VERIFY_FAIL: VERIFY_FAIL,
  clean: clean,
  phoneOf: phoneOf,
  maskPhone: maskPhone,
  publicBody: publicBody,
  tooMany: tooMany,
  noteFail: noteFail,
  tokenHash: tokenHash,
  requestNumber: requestNumber,
  findByNumber: findByNumber,
  identityMatches: identityMatches,
  validatePerson: validatePerson,
  hourSlots: hourSlots,
  releaseLocks: releaseLocks,
  requireStaff: requireStaff,
  safeLog: safeLog
};
