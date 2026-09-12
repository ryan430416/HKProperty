import { demoProfile } from './demoStore.js';
import { getPocketBaseConfigError, logPocketBaseError, pb, pbMessage } from './pocketbaseClient.js';
import { PB } from '../pocketbase/schema.mjs';

/** @typedef {'unset' | 'checking' | 'connected' | 'demo' | 'failed'} BackendMode */

/** @type {{ mode: BackendMode, message: string, checkedAt: string | null, collections: string[] }} */
let state = {
  mode: 'unset',
  message: '',
  checkedAt: null,
  collections: []
};

const REQUIRED_COLLECTIONS = [
  PB.assets,
  PB.loans,
  PB.reservations,
  PB.usage
];

function inDemoMode() {
  return Boolean(demoProfile());
}

export function getBackendStatus() {
  return { ...state, collections: [...state.collections] };
}

export function backendStatusLabel(status = state) {
  if (status.mode === 'demo') return '測試資料模式';
  if (status.mode === 'connected') return 'PocketBase 正式模式';
  if (status.mode === 'failed') return 'PocketBase 連線失敗';
  if (status.mode === 'checking') return '正在檢查後端連線…';
  return 'PocketBase 尚未設定';
}

function setStatus(mode, message = '', collections = []) {
  state = {
    mode,
    message: String(message || ''),
    checkedAt: new Date().toISOString(),
    collections: Array.isArray(collections) ? collections.slice() : []
  };
  return getBackendStatus();
}

export function markDemoBackend() {
  return setStatus('demo', '資料只存在此瀏覽器，不會寫入 PocketBase', []);
}

async function assertCollectionReadable(collection, { requireRead = false } = {}) {
  try {
    await pb.collection(collection).getList(1, 1, { requestKey: `health-${collection}-${requireRead ? 'auth' : 'anon'}` });
    return null;
  } catch (error) {
    const status = error?.status || error?.data?.code;
    if (status === 404) {
      logPocketBaseError('health.collection', error, { collection, url: `${pb.baseUrl}/api/collections/${collection}/records` });
      return `集合 ${collection} 不存在`;
    }
    // 登入前：401/403 代表集合存在但需登入，不算失敗
    if (!requireRead && (status === 401 || status === 403)) return null;
    if (status === 403 || status === 401) return `集合 ${collection} 無權限讀取`;
    return `集合 ${collection} 無法讀取：${pbMessage(error, error?.message || '未知錯誤')}`;
  }
}

/**
 * Probe PocketBase health + required collections. Never falls back to demo data.
 * @param {{ requireRead?: boolean }} [options]
 */
export async function probePocketBase({ requireRead = false } = {}) {
  if (inDemoMode()) return markDemoBackend();

  const configError = getPocketBaseConfigError();
  if (configError || !pb) {
    return setStatus('failed', configError || '尚未設定 VITE_POCKETBASE_URL');
  }

  setStatus('checking', '正在檢查 PocketBase…');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${pb.baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return setStatus('failed', `PocketBase health 回應 ${res.status}`);
    }
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? '連線逾時'
      : pbMessage(error, error?.message || '無法連線');
      logPocketBaseError('health', error, { requestUrl: `${pb.baseUrl}/api/health` });
      return setStatus('failed', `PocketBase 尚未連線：${reason}`);
  }

  const ok = [];
  for (const name of REQUIRED_COLLECTIONS) {
    const fail = await assertCollectionReadable(name, { requireRead });
    if (fail) {
      return setStatus(
        'failed',
        `PocketBase 已回應，但${fail}。必要集合：${REQUIRED_COLLECTIONS.join('、')}`
      );
    }
    ok.push(name);
  }

  return setStatus(
    'connected',
    requireRead
      ? `正式模式｜${pb.baseUrl}｜已驗證可讀 ${ok.join('、')}`
      : `已連線 ${pb.baseUrl}｜必要集合存在（登入後再驗證讀取權限）`,
    ok
  );
}

export function requirePocketBaseReady() {
  if (inDemoMode()) return;
  if (state.mode === 'connected') return;
  const detail = state.message || getPocketBaseConfigError() || '未知錯誤';
  throw new Error(`PocketBase 尚未進入正式模式。${detail}`);
}

export function isFormalPocketBaseMode() {
  return !inDemoMode() && state.mode === 'connected';
}
