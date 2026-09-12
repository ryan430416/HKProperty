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
    ...extra
  };
  console.error('[HKProperty PocketBase]', payload);
  return payload;
}

export function pbMessage(error, fallback = '資料庫操作失敗') {
  const status = error?.status || error?.data?.code;
  const data = error?.data || error?.response;
  const raw = data?.message || error?.message || fallback;
  if (status === 401) return '登入已失效，請重新登入';
  if (status === 403) return '此帳號沒有執行此操作的權限';
  if (status === 404) return '找不到指定資料或 Collection';
  if (status === 400) {
    const fields = data?.data && typeof data.data === 'object' ? Object.keys(data.data).filter((key) => key !== 'password').join('、') : '';
    return fields ? `資料格式錯誤，請檢查必填欄位：${fields}` : '資料格式錯誤，請檢查必填欄位';
  }
  if (error?.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return '無法連接 PocketBase，請檢查網路、HTTPS 或 CORS';
  }
  if (!raw || /^(something went wrong|error|failed)$/i.test(String(raw).trim())) {
    return fallback;
  }
  return raw;
}

export { getPocketBaseConfigError as getSupabaseConfigError };
