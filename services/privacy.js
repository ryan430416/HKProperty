const MOBILE = /^09\d{8}$/;
const LANDLINE = /^0\d{1,2}-?\d{6,8}$/;
const EXT = /^(?:0\d{1,2}-?)?\d{6,8}#\d{1,6}$/;

export const PRIVACY_NOTICE = '所填資料僅供財產預借、借用、歸還聯繫及管理使用。';
export const VERIFY_FAIL = '借用資料驗證失敗，請確認借用編號、姓名及電話。';

export function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function validateUnit(value) {
  const text = collapse(value);
  if (text.length < 2 || text.length > 50) return '單位需為 2 到 50 個字';
  return '';
}

export function validateName(value) {
  const text = collapse(value);
  if (text.length < 2 || text.length > 30 || !text.replace(/\s/g, '')) return '姓名需為 2 到 30 個字';
  return '';
}

export function normalizePhone(value) {
  return collapse(value).replace(/\s+/g, '').replace(/分機/g, '#').replace(/＃/g, '#');
}

export function validatePhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return '請填寫電話';
  if (phone.length > 20) return '電話格式不正確';
  if (MOBILE.test(phone) || LANDLINE.test(phone) || EXT.test(phone)) return '';
  return '請填寫台灣手機、室內電話或分機';
}

export function maskPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return '';
  if (phone.length <= 4) return '****';
  const start = phone.startsWith('09') ? 4 : Math.min(5, Math.floor(phone.length / 2));
  const end = phone.length - 3;
  if (end <= start) return `${phone.slice(0, 2)}***`;
  return `${phone.slice(0, start)}***${phone.slice(end)}`;
}

export function phonesMatch(left, right) {
  return normalizePhone(left) !== '' && normalizePhone(left) === normalizePhone(right);
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function createPublicToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(String(token || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export function createRequestNumber(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `${prefix}-${stamp}-${bytesToHex(bytes).toUpperCase()}`;
}
