import PocketBase from 'pocketbase';

const url = String(import.meta.env.VITE_POCKETBASE_URL || '').trim().replace(/\/$/, '');

export function getPocketBaseConfigError() {
  if (!url) {
    return '尚未設定 PocketBase。請在專案根目錄建立 .env，填入 VITE_POCKETBASE_URL（例如 http://127.0.0.1:8090）。詳細步驟請見 POCKETBASE_SETUP.md。';
  }
  return null;
}

export const pb = url ? new PocketBase(url) : null;
if (pb) pb.autoCancellation(false);

export function requireClient() {
  const error = getPocketBaseConfigError();
  if (error || !pb) throw new Error(error || 'PocketBase 尚未設定');
  return pb;
}

export function throwIfError(error, fallback = '資料庫操作失敗') {
  if (!error) return;
  throw new Error(error.message || fallback);
}

export function pbMessage(error, fallback = '資料庫操作失敗') {
  const data = error?.data || error?.response;
  return data?.message || error?.message || fallback;
}

export { getPocketBaseConfigError as getSupabaseConfigError };
