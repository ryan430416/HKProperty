import { createClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export function getSupabaseConfigError() {
  if (!url || !anonKey) {
    return '尚未設定雲端資料庫。請在專案根目錄建立 .env，填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY（只使用 anon／publishable key，不要使用 service_role）。Vercel 請在 Project → Settings → Environment Variables 設定相同名稱後重新部署。詳細步驟請見 SUPABASE_SETUP.md。';
  }
  if (anonKey.includes('service_role')) {
    return '偵測到 service_role 金鑰。前端只能使用 anon／publishable key，請立刻更換。';
  }
  return null;
}

export const supabase = url && anonKey && !anonKey.includes('service_role')
  ? createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  })
  : null;

export function requireClient() {
  const error = getSupabaseConfigError();
  if (error || !supabase) {
    throw new Error(error || 'Supabase 尚未設定');
  }
  return supabase;
}

export function throwIfError(error, fallback = '資料庫操作失敗') {
  if (!error) return;
  throw new Error(error.message || fallback);
}
