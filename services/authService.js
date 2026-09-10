import { requireClient, throwIfError } from './supabaseClient.js';

let currentUser = null;
let currentProfile = null;
let authReady = false;

export const ROLES = {
  BORROWER: 'borrower',
  STAFF: 'staff',
  ADMIN: 'admin'
};

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

export async function loadProfile() {
  const client = requireClient();
  const { data: { user }, error } = await client.auth.getUser();
  throwIfError(error, '無法取得登入狀態');
  currentUser = user || null;
  currentProfile = null;
  if (!user) return null;
  const { data, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  throwIfError(profileError, '無法載入使用者資料');
  currentProfile = data;
  if (data && !data.is_active) {
    await signOut();
    throw new Error('此帳號已停用，請聯繫管理者');
  }
  return currentProfile;
}

export async function initAuth(onChange) {
  const client = requireClient();
  const { data } = client.auth.onAuthStateChange(async (event, session) => {
    if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
    currentUser = session?.user || null;
    if (currentUser) {
      try {
        await loadProfile();
      } catch {
        currentProfile = null;
      }
    } else {
      currentProfile = null;
    }
    authReady = true;
    onChange?.(currentProfile, currentUser, event);
  });
  authReady = true;
  return data.subscription;
}

export function isAuthReady() {
  return authReady;
}

export async function sendLoginOtp(email) {
  const client = requireClient();
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('請輸入電子郵件');
  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: window.location.origin,
      shouldCreateUser: true,
      data: { display_name: trimmed.split('@')[0] }
    }
  });
  throwIfError(error, '無法寄送登入連結');
}

export async function verifyEmailOtp(email, token) {
  const client = requireClient();
  const { error } = await client.auth.verifyOtp({
    email: String(email || '').trim(),
    token: String(token || '').trim(),
    type: 'email'
  });
  throwIfError(error, '驗證碼不正確或已過期');
  return loadProfile();
}

export async function updateMyProfile(patch) {
  const client = requireClient();
  const user = currentUser;
  if (!user) throw new Error('請先登入');
  const payload = {};
  if (patch.displayName != null) payload.display_name = String(patch.displayName).trim();
  if (patch.schoolNumber != null) payload.school_number = String(patch.schoolNumber).trim();
  if (patch.department != null) payload.department = String(patch.department).trim();
  const { data, error } = await client
    .from('profiles')
    .update(payload)
    .eq('id', user.id)
    .select()
    .single();
  throwIfError(error, '無法更新個人資料');
  currentProfile = data;
  return data;
}

export async function listProfiles() {
  if (!isAdmin()) throw new Error('只有管理者可以管理使用者');
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  throwIfError(error, '無法載入使用者');
  return data || [];
}

export async function adminUpdateProfile(payload) {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_update_profile', {
    p_profile_id: payload.id,
    p_role: payload.role ?? null,
    p_is_active: payload.isActive ?? null,
    p_display_name: payload.displayName ?? null,
    p_department: payload.department ?? null,
    p_school_number: payload.schoolNumber ?? null
  });
  throwIfError(error, '無法更新使用者');
  return data;
}

export async function signOut() {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  throwIfError(error, '登出失敗');
  currentUser = null;
  currentProfile = null;
}
