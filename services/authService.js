import { PB } from '../pocketbase/schema.mjs';
import { demoProfile, demoUpdateMe, demoUpdateUser, demoUsers, enterDemo, exitDemo } from './demoStore.js';
import { getPocketBaseConfigError, pb, pbMessage, requireClient } from './pocketbaseClient.js';

let currentUser = null;
let currentProfile = null;
let authReady = false;
let unsub = null;

export const ROLES = {
  BORROWER: 'borrower',
  STAFF: 'staff',
  ADMIN: 'admin'
};

export function testModeEnabled() {
  return import.meta.env.VITE_ENABLE_TEST_MODE === 'true';
}

export function roleLabel(role) {
  if (role === ROLES.ADMIN) return '管理者';
  if (role === ROLES.STAFF) return '經辦人員';
  return '借用人';
}

export function isStaff(profile = currentProfile) {
  return profile?.role === ROLES.STAFF || profile?.role === ROLES.ADMIN;
}

export function isAdmin(profile = currentProfile) {
  return profile?.role === ROLES.ADMIN;
}

export function getSessionUser() {
  return currentUser;
}

export function getProfile() {
  return currentProfile;
}

function mapProfile(record) {
  if (!record) return null;
  const active = record.active !== false && record.is_active !== false;
  return {
    id: record.id,
    display_name: record.name || record.display_name || String(record.email || '').split('@')[0] || '使用者',
    name: record.name || record.display_name || '',
    school_number: record.employee_number || record.school_number || '',
    employee_number: record.employee_number || '',
    phone: record.phone || '',
    department: record.department || '',
    last_login_at: record.last_login_at || '',
    role: record.role || '',
    is_active: active,
    active,
    email: record.email || '',
    created_at: record.created,
    updated_at: record.updated
  };
}

export async function loadProfile() {
  const client = requireClient();
  const record = client.authStore.record;
  currentUser = record || null;
  currentProfile = mapProfile(record);
  if (currentProfile && !currentProfile.active) {
    await signOut();
    throw new Error('此帳號已停用，請聯繫管理者');
  }
  return currentProfile;
}

export async function initAuth(onChange) {
  if (demoProfile()) {
    currentProfile = demoProfile();
    currentUser = currentProfile;
    authReady = true;
    onChange?.(currentProfile, currentUser);
    return { unsubscribe() {} };
  }
  if (getPocketBaseConfigError()) {
    authReady = true;
    onChange?.(null, null);
    return { unsubscribe() {} };
  }
  const client = requireClient();
  if (unsub) unsub();
  const stored = client.authStore.record;
  if (stored?.collectionName && stored.collectionName !== PB.staffUsers) client.authStore.clear();
  if (client.authStore.isValid) {
    try {
      await client.collection(PB.staffUsers).authRefresh();
    } catch {
      client.authStore.clear();
    }
  }
  const notify = async () => {
    try {
      await loadProfile();
    } catch {
      currentUser = null;
      currentProfile = null;
    }
    authReady = true;
    onChange?.(currentProfile, currentUser);
  };
  unsub = client.authStore.onChange(() => {
    notify();
  }, false);
  await notify();
  return { unsubscribe: () => unsub?.() };
}

export function isDemoMode() {
  return Boolean(demoProfile());
}

export async function enterDemoSession(role = 'admin') {
  if (!testModeEnabled()) throw new Error('正式環境未開放測試登入');
  currentProfile = enterDemo(role);
  currentUser = currentProfile;
  authReady = true;
  return currentProfile;
}

export async function signInWithPassword(email, password) {
  const client = requireClient();
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('請輸入電子郵件');
  if (!password) throw new Error('請輸入密碼');
  try {
    await client.collection(PB.staffUsers).authWithPassword(trimmed, password);
  } catch (error) {
    throw new Error(pbMessage(error, '登入失敗，請確認電子郵件與密碼'));
  }
  const profile = await loadProfile();
  if (!profile || (profile.role !== ROLES.ADMIN && profile.role !== ROLES.STAFF) || !profile.active) {
    await signOut();
    throw new Error('此帳號無法進入後台');
  }
  try {
    await client.collection(PB.staffUsers).update(profile.id, { last_login_at: new Date().toISOString() });
  } catch {
    // last_login 由規則限制時不影響登入，也不寫入密碼
  }
  return profile;
}

export async function registerWithPassword() {
  throw new Error('借用人不需要註冊。請直接使用首頁的預借、借用或歸還。');
}

export async function sendLoginOtp(email) {
  const client = requireClient();
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('請輸入電子郵件');
  try {
    const otp = await client.collection(PB.users).requestOTP(trimmed);
    sessionStorage.setItem('hkp-otp-id', otp.otpId || otp.id || '');
  } catch (error) {
    throw new Error(pbMessage(error, '無法寄送一次性密碼。本機請改用電子郵件與密碼登入，或在 PocketBase 設定 SMTP。'));
  }
}

export async function verifyEmailOtp(email, token) {
  const client = requireClient();
  const otpId = sessionStorage.getItem('hkp-otp-id');
  if (!otpId) throw new Error('請先寄送一次性密碼');
  try {
    await client.collection(PB.users).authWithOTP(otpId, String(token || '').trim());
  } catch (error) {
    throw new Error(pbMessage(error, '驗證碼不正確或已過期'));
  }
  return loadProfile();
}

export async function updateMyProfile(patch) {
  if (isDemoMode()) {
    const next = {};
    if (patch.displayName != null) {
      next.name = String(patch.displayName).trim();
      next.display_name = next.name;
    }
    if (patch.schoolNumber != null) next.school_number = String(patch.schoolNumber).trim();
    if (patch.department != null) next.department = String(patch.department).trim();
    currentProfile = demoUpdateMe(next);
    currentUser = currentProfile;
    return currentProfile;
  }
  const client = requireClient();
  const user = currentUser;
  if (!user) throw new Error('請先登入');
  const payload = {};
  if (patch.displayName != null) payload.name = String(patch.displayName).trim();
  if (patch.schoolNumber != null) payload.school_number = String(patch.schoolNumber).trim();
  if (patch.department != null) payload.department = String(patch.department).trim();
  try {
    const data = await client.collection(PB.users).update(user.id, payload);
    currentUser = data;
    currentProfile = mapProfile(data);
    return currentProfile;
  } catch (error) {
    throw new Error(pbMessage(error, '無法更新個人資料'));
  }
}

export async function listProfiles() {
  if (isDemoMode()) return demoUsers();
  if (!isAdmin()) throw new Error('只有管理者可以管理使用者');
  const client = requireClient();
  try {
    const data = await client.collection(PB.staffUsers).getFullList({ sort: '-created' });
    return Array.isArray(data) ? data.map(mapProfile) : [];
  } catch (error) {
    throw new Error(pbMessage(error, '無法載入使用者'));
  }
}

export async function createStaffAccount({ email, password, name, employeeNumber, department, phone }) {
  if (!isAdmin()) throw new Error('只有管理者可以建立經辦人員');
  const client = requireClient();
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('請填寫電子郵件');
  if (String(password || '').length < 8) throw new Error('密碼至少 8 個字元');
  if (String(name || '').trim().length < 2) throw new Error('請填寫姓名');
  if (!String(employeeNumber || '').trim()) throw new Error('請填寫員工編號');
  try {
    const row = await client.collection(PB.staffUsers).create({
      email: trimmed,
      password,
      passwordConfirm: password,
      emailVisibility: false,
      name: String(name).trim(),
      employee_number: String(employeeNumber).trim(),
      role: 'staff',
      department: String(department || '').trim(),
      phone: String(phone || '').trim(),
      active: true,
      is_active: true,
      ...(getProfile()?.id ? { created_by: getProfile().id } : {})
    });
    return mapProfile(row);
  } catch (error) {
    throw new Error(pbMessage(error, '無法建立經辦人員'));
  }
}

export async function requestStaffPasswordReset(email) {
  if (!isAdmin()) throw new Error('只有管理者可以重設密碼');
  const client = requireClient();
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('請填寫電子郵件');
  try {
    await client.collection(PB.staffUsers).requestPasswordReset(trimmed);
  } catch (error) {
    throw new Error(pbMessage(error, '無法寄出重設密碼信。請確認 PocketBase 已設定 SMTP。'));
  }
}

export async function adminUpdateProfile(payload) {
  if (isDemoMode()) {
    return demoUpdateUser({
      id: payload.id,
      role: payload.role ?? null,
      is_active: payload.isActive ?? null,
      display_name: payload.displayName ?? null,
      department: payload.department ?? null,
      school_number: payload.schoolNumber ?? null
    });
  }
  if (!isAdmin()) throw new Error('只有管理者可以管理使用者');
  if (payload.id === currentProfile?.id && payload.isActive === false) throw new Error('不能停用目前登入中的自己');
  const admins = (await listProfiles()).filter((row) => row.role === ROLES.ADMIN && row.is_active);
  const target = admins.find((row) => row.id === payload.id);
  if (target && payload.isActive === false && admins.length <= 1) throw new Error('至少要保留一個有效管理員');
  const client = requireClient();
  const patch = {};
  if (payload.displayName != null) patch.name = String(payload.displayName).trim();
  if (payload.department != null) patch.department = String(payload.department).trim();
  if (payload.phone != null) patch.phone = String(payload.phone).trim();
  if (payload.isActive != null) {
    patch.active = payload.isActive;
    patch.is_active = payload.isActive;
  }
  try {
    const data = await client.collection(PB.staffUsers).update(payload.id, patch);
    return mapProfile(data);
  } catch (error) {
    throw new Error(pbMessage(error, '無法更新經辦人員'));
  }
}

export async function signOut() {
  const demo = Boolean(demoProfile());
  currentUser = null;
  currentProfile = null;
  if (demo) {
    exitDemo();
    return;
  }
  pb.authStore.clear();
}
