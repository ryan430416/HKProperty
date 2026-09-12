import PocketBase from 'pocketbase';

export const DEFAULT_POCKETBASE_URL = 'https://db.keson.pro';

const url = String(import.meta.env.VITE_POCKETBASE_URL || DEFAULT_POCKETBASE_URL)
  .trim()
  .replace(/\/$/, '');

export function getPocketBaseUrl() {
  return url;
}

export function getPocketBaseConfigError() {
  if (!url) return '尚未設定 VITE_POCKETBASE_URL';
  if (import.meta.env.PROD && /localhost|127\.0\.0\.1/i.test(url)) {
    return `正式環境不可使用本機 PocketBase（目前是 ${url}）。請將 VITE_POCKETBASE_URL 設為 ${DEFAULT_POCKETBASE_URL} 後重新部署。`;
  }
  return null;
}

export const pb = new PocketBase(url);
pb.autoCancellation(false);

export function requireClient() {
  const error = getPocketBaseConfigError();
  if (error) throw new Error(error);
  return pb;
}

export function logPocketBaseError(scope, error, extra = {}) {
  const payload = {
    scope,
    url: pb?.baseUrl || url,
    status: error?.status || error?.data?.code || null,
    message: error?.message || String(error),
    data: error?.data || error?.response || null,
    ...extra
  };
  console.error('[HKProperty PocketBase]', payload);
  return payload;
}

export function pbMessage(error, fallback = '資料庫操作失敗') {
  const data = error?.data || error?.response;
  const detail = data?.message || error?.message || fallback;
  if (error?.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(detail)) {
    return `PocketBase 尚未連線：Failed to fetch（${url}）。請確認 VITE_POCKETBASE_URL、HTTPS 與 CORS。`;
  }
  return detail;
}

export { getPocketBaseConfigError as getSupabaseConfigError };
