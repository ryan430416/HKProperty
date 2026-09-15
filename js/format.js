export const PAGE_SIZE = 20;

/** Built-in category glyph for text-only asset cards (no photo upload). */
export function categoryIcon(name = '', specification = '') {
  const text = `${name} ${specification}`.toLowerCase();
  let kind = 'box';
  if (/投影|螢幕|顯示|電視|monitor|projector|display/.test(text)) kind = 'display';
  else if (/相機|攝影|錄影|camera|cam/.test(text)) kind = 'camera';
  else if (/筆電|電腦|平板|notebook|laptop|pc|電腦主機|主機/.test(text)) kind = 'computer';
  else if (/椅|桌|櫃|架|桌椅|furniture/.test(text)) kind = 'furniture';
  else if (/音響|喇叭|麥克風|mic|speaker|音/.test(text)) kind = 'audio';
  const paths = {
    display: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M10 16h4"/>',
    furniture: '<path d="M4 10h16v8H4zM7 10V7h10v3M6 18v2M18 18v2"/>',
    audio: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 14v6M8 20h8"/>',
    box: '<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M3 8v8l9 4 9-4V8M12 12v8"/>'
  };
  return `<span class="asset-glyph" data-kind="${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg></span>`;
}

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

const TAIPEI = 'Asia/Taipei';

function partsInTaipei(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return bag;
}

export function formatDate(iso) {
  if (!iso) return '未提供';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未提供';
  const bag = partsInTaipei(date);
  return `${bag.year}-${bag.month}-${bag.day}`;
}

export function formatDateTime(iso, empty = '未提供') {
  if (!iso) return empty;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未提供';
  const bag = partsInTaipei(date);
  return `${bag.year}-${bag.month}-${bag.day} ${bag.hour}:${bag.minute}`;
}

export function availabilityClass(status) {
  if (status === 'available') return 'ok';
  if (status === 'checked_out' || status === 'pending') return 'loan';
  if (status === 'overdue' || status === 'lost') return 'alert';
  if (status === 'maintenance') return 'pending';
  return '';
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
