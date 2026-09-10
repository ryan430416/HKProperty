import catalog from '../data/inventory.json';
import { AUDIT_STATUS, PLACEHOLDER_IMAGE } from '../js/format.js';

const AUTH_KEY = 'hkp-demo-auth';
const DATA_KEY = 'hkp-demo-data';

const DEMO_USERS = {
  admin: {
    id: 'demo-admin',
    display_name: '測試管理者',
    role: 'admin',
    school_number: 'ADMIN001',
    department: '總務處',
    is_active: true,
    email: 'demo-admin@hk.local'
  },
  staff: {
    id: 'demo-staff',
    display_name: '測試經辦',
    role: 'staff',
    school_number: 'STAFF001',
    department: '總務處',
    is_active: true,
    email: 'demo-staff@hk.local'
  },
  borrower: {
    id: 'demo-borrower',
    display_name: '測試借用人',
    role: 'borrower',
    school_number: 'B12345678',
    department: '資訊工程系',
    is_active: true,
    email: 'demo-borrower@hk.local'
  }
};

function readJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

export function isDemoMode() {
  return Boolean(readJson(AUTH_KEY));
}

export function demoProfile() {
  return readJson(AUTH_KEY);
}

export function enterDemo(role = 'admin') {
  const profile = { ...(DEMO_USERS[role] || DEMO_USERS.admin) };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(profile));
  ensureData();
  return profile;
}

export function exitDemo() {
  sessionStorage.removeItem(AUTH_KEY);
}

function seedAssets() {
  return (catalog.items || []).map((item) => ({
    id: String(item.propertyId),
    property_id: String(item.propertyId),
    name: item.name,
    location: item.location || '',
    department: item.department || '',
    custodian: item.custodian || '',
    specification: item.specification || '',
    unit: item.unit || '',
    price: item.price ?? 0,
    purchase_date: item.purchaseDate || '',
    service_life: item.serviceLife ?? 0,
    supplier: item.supplier || '',
    asset_status: item.status === '正常' ? 'normal' : (item.status || 'normal'),
    availability_status: 'available',
    usage_count: 0,
    note: item.note || '',
    brand: item.brand || '',
    model: item.model || '',
    is_borrowable: true,
    is_active: true,
    audit_status: AUDIT_STATUS.PENDING,
    last_audit_at: '',
    current_loan: '',
    return_alert: '',
    photo: ''
  }));
}

function blankData() {
  return {
    assets: seedAssets(),
    loans: [],
    usage: [],
    audits: [],
    locations: [],
    logs: [],
    users: Object.values(DEMO_USERS).map((user) => ({ ...user })),
    settings: {
      require_loan_approval: false,
      allow_self_checkout: true,
      default_loan_days: 1
    }
  };
}

function ensureData() {
  const current = readJson(DATA_KEY);
  if (current?.assets?.length) return current;
  const data = blankData();
  sessionStorage.setItem(DATA_KEY, JSON.stringify(data));
  return data;
}

export function getDemoData() {
  return ensureData();
}

function saveData(data) {
  sessionStorage.setItem(DATA_KEY, JSON.stringify(data));
  return data;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function log(data, action, detail = {}) {
  const auth = demoProfile() || DEMO_USERS.admin;
  data.logs.unshift({
    id: uid('log'),
    action,
    actor_name: auth.display_name,
    created: new Date().toISOString(),
    created_at: new Date().toISOString(),
    detail
  });
}

function assetById(data, id) {
  return data.assets.find((row) => row.id === id || row.property_id === String(id));
}

function nextLoanNumber(data) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LOAN-${day}-`;
  const same = data.loans.filter((row) => String(row.loan_number || '').startsWith(prefix));
  return `${prefix}${String(same.length + 1).padStart(4, '0')}`;
}

export function demoAssets() {
  return getDemoData().assets.slice();
}

export function demoLoans() {
  return getDemoData().loans.slice();
}

export function demoUsage() {
  return getDemoData().usage.slice();
}

export function demoAudits() {
  return getDemoData().audits.slice();
}

export function demoLocations() {
  return getDemoData().locations.slice();
}

export function demoLogs() {
  return getDemoData().logs.slice();
}

export function demoSettings() {
  return { ...getDemoData().settings };
}

export function demoUsers() {
  return getDemoData().users.map((user) => ({ ...user }));
}

export function demoSaveSettings(patch) {
  const data = getDemoData();
  Object.assign(data.settings, patch);
  log(data, '修改系統設定', patch);
  saveData(data);
  return data.settings;
}

export function demoCheckout(payload) {
  const data = getDemoData();
  const asset = assetById(data, payload.assetId || payload.propertyId);
  if (!asset || asset.is_active === false) throw new Error('查無此財產編號');
  if (asset.availability_status !== 'available') throw new Error('此財產目前無法借用');
  const open = data.loans.find((row) => row.asset === asset.id && !['returned', 'rejected', 'cancelled'].includes(row.status));
  if (open) throw new Error('此財產已有未完成的借用紀錄，不可重複借出');
  const now = payload.checkout_at || new Date().toISOString();
  const method = payload.checkout_method || 'self_service';
  const pending = data.settings.require_loan_approval && method !== 'admin';
  const rec = {
    id: uid('loan'),
    loan_number: nextLoanNumber(data),
    asset: asset.id,
    property_id: asset.property_id,
    property_name: asset.name,
    borrower: demoProfile()?.id || 'demo-borrower',
    borrower_name: payload.borrower_name,
    borrower_number: payload.borrower_number,
    borrower_department: payload.borrower_department,
    purpose: payload.purpose,
    contact: payload.contact || '',
    requested_at: now,
    checkout_at: pending ? '' : now,
    expected_return_at: payload.expected_return_at,
    returned_at: '',
    checkout_condition: payload.checkout_condition || '',
    checkout_method: method,
    checkout_operator: pending ? '' : (method === 'admin' ? (demoProfile()?.display_name || '測試管理者') : '自助借用'),
    status: pending ? 'pending' : 'checked_out',
    note: payload.note || '',
    created: now,
    updated: now
  };
  data.loans.unshift(rec);
  asset.availability_status = pending ? 'pending' : 'checked_out';
  asset.current_loan = rec.id;
  if (!pending) {
    asset.usage_count = Number(asset.usage_count || 0) + 1;
    data.usage.unshift({
      id: uid('use'),
      asset: asset.id,
      loan: rec.id,
      user_name: rec.borrower_name,
      department: rec.borrower_department,
      used_at: now,
      purpose: rec.purpose,
      note: `借用編號 ${rec.loan_number}`
    });
    log(data, '借出', { loan_number: rec.loan_number });
  } else {
    log(data, '送出借用申請', { loan_number: rec.loan_number });
  }
  saveData(data);
  return rec;
}

export function demoApprove(id) {
  const data = getDemoData();
  const rec = data.loans.find((row) => row.id === id);
  if (!rec) throw new Error('找不到借用申請');
  rec.status = 'approved';
  rec.approved_at = new Date().toISOString();
  rec.updated = rec.approved_at;
  saveData(data);
  return rec;
}

export function demoCompleteCheckout(id) {
  const data = getDemoData();
  const rec = data.loans.find((row) => row.id === id);
  if (!rec) throw new Error('找不到借用申請');
  const now = new Date().toISOString();
  rec.status = 'checked_out';
  rec.checkout_at = now;
  rec.checkout_operator = demoProfile()?.display_name || '測試管理者';
  rec.updated = now;
  const asset = assetById(data, rec.asset);
  if (asset) {
    asset.availability_status = 'checked_out';
    asset.current_loan = rec.id;
    asset.usage_count = Number(asset.usage_count || 0) + 1;
  }
  data.usage.unshift({
    id: uid('use'),
    asset: rec.asset,
    loan: rec.id,
    user_name: rec.borrower_name,
    department: rec.borrower_department,
    used_at: now,
    purpose: rec.purpose,
    note: `借用編號 ${rec.loan_number}`
  });
  log(data, '借出', { loan_number: rec.loan_number });
  saveData(data);
  return rec;
}

export function demoReject(id, reason) {
  const data = getDemoData();
  const rec = data.loans.find((row) => row.id === id);
  if (!rec) throw new Error('找不到借用申請');
  rec.status = 'rejected';
  rec.rejection_reason = reason;
  const asset = assetById(data, rec.asset);
  if (asset) {
    asset.availability_status = 'available';
    asset.current_loan = '';
  }
  saveData(data);
  return rec;
}

export function demoReturn(id, payload) {
  const data = getDemoData();
  const rec = data.loans.find((row) => row.id === id);
  if (!rec) throw new Error('找不到借用紀錄');
  if (rec.status === 'returned') throw new Error('此筆借用已完成歸還，不可重複歸還');
  rec.status = 'returned';
  rec.returned_at = payload.returned_at;
  rec.return_location = payload.return_location;
  rec.return_result = payload.return_result;
  rec.return_condition = payload.return_condition || '';
  rec.return_operator = demoProfile()?.role === 'borrower' ? '自助歸還' : (demoProfile()?.display_name || '測試管理者');
  const asset = assetById(data, rec.asset);
  if (asset) {
    let next = 'available';
    if (payload.return_result === '送修') next = 'maintenance';
    if (payload.return_result === '遺失') next = 'lost';
    asset.availability_status = next;
    asset.current_loan = '';
    if (payload.return_location && payload.return_location !== asset.location) {
      data.locations.unshift({
        id: uid('loc'),
        asset: asset.id,
        from_location: asset.location,
        to_location: payload.return_location,
        reason: '歸還後更新存放位置',
        operator_name: rec.return_operator,
        created: new Date().toISOString()
      });
      asset.location = payload.return_location;
    }
  }
  log(data, '歸還', { loan_number: rec.loan_number });
  saveData(data);
  return rec;
}

export function demoAddUsage(payload) {
  const data = getDemoData();
  const asset = assetById(data, payload.asset_id);
  if (!asset) throw new Error('找不到財產');
  const rec = {
    id: uid('use'),
    asset: asset.id,
    user_name: payload.user_name,
    department: payload.department,
    used_at: payload.used_at,
    purpose: payload.purpose,
    note: payload.note || ''
  };
  data.usage.unshift(rec);
  asset.usage_count = Number(asset.usage_count || 0) + 1;
  saveData(data);
  return rec;
}

export function demoAddAudit(payload) {
  const data = getDemoData();
  const asset = assetById(data, payload.asset_id);
  if (!asset) throw new Error('找不到財產');
  const rec = {
    id: uid('audit'),
    asset: asset.id,
    registered_location: payload.registered_location,
    actual_location: payload.actual_location,
    result: payload.result,
    auditor: payload.auditor,
    audited_at: payload.audited_at,
    note: payload.note || ''
  };
  data.audits.unshift(rec);
  asset.last_audit_at = rec.audited_at;
  asset.audit_status = payload.result === '位置正確' ? AUDIT_STATUS.DONE
    : payload.result === '位置異常' ? AUDIT_STATUS.MISMATCH
      : payload.result === '找不到物品' ? AUDIT_STATUS.MISSING
        : payload.result === '物品損壞' ? AUDIT_STATUS.DAMAGED
          : AUDIT_STATUS.PENDING;
  log(data, '盤點', { result: payload.result });
  saveData(data);
  return rec;
}

export function demoUpdateLocation(assetId, payload) {
  const data = getDemoData();
  const asset = assetById(data, assetId);
  if (!asset) throw new Error('找不到財產');
  data.locations.unshift({
    id: uid('loc'),
    asset: asset.id,
    from_location: payload.from_location || asset.location,
    to_location: payload.to_location,
    reason: payload.reason || '更新存放位置',
    operator_name: demoProfile()?.display_name || '測試管理者',
    created: new Date().toISOString()
  });
  asset.location = payload.to_location;
  saveData(data);
  return asset;
}

export function demoSetActive(assetId, isActive) {
  const data = getDemoData();
  const asset = assetById(data, assetId);
  if (!asset) throw new Error('找不到財產');
  asset.is_active = isActive;
  saveData(data);
  return asset;
}

export async function demoSavePhoto(assetId, file) {
  const data = getDemoData();
  const asset = assetById(data, assetId);
  if (!asset) throw new Error('找不到財產');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.readAsDataURL(file);
  });
  asset.photo = dataUrl;
  saveData(data);
  return dataUrl;
}

export function demoPhotoUrl(row) {
  return row?.photo || PLACEHOLDER_IMAGE;
}

export function demoUpdateMe(patch) {
  const current = demoProfile();
  if (!current) throw new Error('請先登入');
  const next = { ...current, ...patch };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(next));
  const data = getDemoData();
  const user = data.users.find((row) => row.id === current.id);
  if (user) Object.assign(user, next);
  saveData(data);
  return next;
}

export function demoUpdateUser(payload) {
  const data = getDemoData();
  const user = data.users.find((row) => row.id === payload.id);
  if (!user) throw new Error('找不到使用者');
  if (payload.role) user.role = payload.role;
  if (payload.is_active != null) user.is_active = payload.is_active;
  if (payload.display_name) user.display_name = payload.display_name;
  if (payload.department != null) user.department = payload.department;
  if (payload.school_number != null) user.school_number = payload.school_number;
  saveData(data);
  return user;
}

export { PLACEHOLDER_IMAGE };
