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
  return { ...state, collections: [...state.collections], appMode: getAppMode() };
}

export function backendStatusLabel() {
  return appModeCopy();
}

/** @typedef {'checking' | 'official' | 'test' | 'offline'} AppMode */

export function getAppMode() {
  if (inDemoMode() || state.mode === 'demo') return 'test';
  if (state.mode === 'connected') return 'official';
  if (state.mode === 'failed') return 'offline';
  return 'checking';
}

export function appModeCopy(mode = getAppMode()) {
  if (mode === 'official') return 'PocketBase 正式模式';
  if (mode === 'test') return '測試資料模式，不寫入 PocketBase';
  if (mode === 'offline') return 'PocketBase 連線失敗';
  return '正在檢查後端連線';
}

export function beginModeCheck() {
  if (inDemoMode()) return markDemoBackend();
  return setStatus('checking', '正在重新檢查 PocketBase…');
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

let lastHealthOkAt = 0;
let probeInFlight = null;

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
  if (probeInFlight?.requireRead === requireRead) return probeInFlight.promise;
  const promise = runProbe({ requireRead });
  probeInFlight = { requireRead, promise };
  try {
    return await promise;
  } finally {
    if (probeInFlight?.promise === promise) probeInFlight = null;
  }
}

async function runProbe({ requireRead = false } = {}) {
  const configError = getPocketBaseConfigError();
  if (configError || !pb) {
    return setStatus('failed', configError || '尚未設定 VITE_POCKETBASE_URL');
  }

  setStatus('checking', '正在檢查 PocketBase…');
  const healthFresh = lastHealthOkAt && Date.now() - lastHealthOkAt < 10000;
  if (!healthFresh) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${pb.baseUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastHealthOkAt = 0;
        return setStatus('failed', `PocketBase health 回應 ${res.status}`);
      }
      lastHealthOkAt = Date.now();
    } catch (error) {
      lastHealthOkAt = 0;
      const reason = error?.name === 'AbortError'
        ? '連線逾時'
        : pbMessage(error, error?.message || '無法連線');
      logPocketBaseError('health', error, { requestUrl: `${pb.baseUrl}/api/health` });
      return setStatus('failed', `PocketBase 尚未連線：${reason}`);
    }
  }

  const checked = await Promise.allSettled(
    REQUIRED_COLLECTIONS.map(async (name) => ({
      name,
      fail: await assertCollectionReadable(name, { requireRead })
    }))
  );
  const failures = [];
  const ok = [];
  for (const item of checked) {
    if (item.status === 'rejected') {
      failures.push(item.reason?.message || '檢查失敗');
      continue;
    }
    if (item.value.fail) failures.push(item.value.fail);
    else ok.push(item.value.name);
  }
  if (failures.length) {
    return setStatus(
      'failed',
      `PocketBase 已回應，但${failures[0]}。必要集合：${REQUIRED_COLLECTIONS.join('、')}`
    );
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

export function assertOfficialWrite() {
  if (inDemoMode()) throw new Error('測試模式不會寫入 PocketBase');
  if (!pb.authStore.isValid) throw new Error('請先登入');
  if (state.mode !== 'connected') throw new Error('目前不是 PocketBase 正式模式，已停止寫入');
}

export function isFormalPocketBaseMode() {
  return !inDemoMode() && state.mode === 'connected';
}
