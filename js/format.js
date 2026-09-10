export const PLACEHOLDER_IMAGE = 'assets/placeholder.svg';
export const PAGE_SIZE = 20;
export const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const AUDIT_RESULTS = {
  MATCH: '位置正確',
  MISMATCH: '位置異常',
  MISSING: '找不到物品',
  DAMAGED: '物品損壞'
};

export const AUDIT_STATUS = {
  PENDING: '待盤點',
  DONE: '已盤點',
  MISMATCH: '位置異常',
  MISSING: '找不到物品',
  DAMAGED: '物品損壞'
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

export function isBlank(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '' || text === '*' || text === '0';
}

export function displayValue(value, fallback = '未提供') {
  return isBlank(value) ? fallback : String(value).trim();
}

export function formatPrice(value) {
  if (isBlank(value) && value !== 0) return '未提供';
  if (value === 0 || value === '0') return '未提供';
  const number = Number(value);
  if (!Number.isFinite(number)) return '未提供';
  return `NT$ ${number.toLocaleString('zh-Hant')}`;
}

export function pad(number) {
  return String(number).padStart(2, '0');
}

export function formatDate(iso) {
  if (!iso) return '未提供';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return '未提供';
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateTime(iso) {
  if (!iso) return '尚未盤點';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未提供';
  return `${formatDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toInputDateTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isCurrentMonth(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function uniqueSorted(values) {
  return [...new Set(values.filter((value) => !isBlank(value)).map((value) => String(value).trim()))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function auditStatusClass(status) {
  if (status === AUDIT_STATUS.DONE) return 'ok';
  if (status === AUDIT_STATUS.PENDING) return 'pending';
  return 'alert';
}
