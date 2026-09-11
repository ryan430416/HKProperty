import { demoProfile } from './demoStore.js';
import { getPocketBaseConfigError, pb, pbMessage } from './pocketbaseClient.js';

/** @typedef {'unset' | 'checking' | 'connected' | 'demo' | 'failed'} BackendMode */

/** @type {{ mode: BackendMode, message: string, checkedAt: string | null }} */
let state = {
  mode: 'unset',
  message: '',
  checkedAt: null
};

function inDemoMode() {
  return Boolean(demoProfile());
}

export function getBackendStatus() {
  return { ...state };
}

export function backendStatusLabel(status = state) {
  if (status.mode === 'demo') return '測試資料模式';
  if (status.mode === 'connected') return 'PocketBase 已連線';
  if (status.mode === 'failed') return 'PocketBase 連線失敗';
  if (status.mode === 'checking') return '正在檢查後端連線…';
  return 'PocketBase 尚未設定';
}

function setStatus(mode, message = '') {
  state = {
    mode,
    message: String(message || ''),
    checkedAt: new Date().toISOString()
  };
  return getBackendStatus();
}

export function markDemoBackend() {
  return setStatus('demo', '資料只存在此瀏覽器，不會寫入 PocketBase');
}

/**
 * Probe PocketBase. Does not fall back to demo data.
 * @returns {Promise<{ mode: BackendMode, message: string, checkedAt: string | null }>}
 */
export async function probePocketBase() {
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
    return setStatus('connected', `已連線 ${pb.baseUrl}`);
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? '連線逾時'
      : pbMessage(error, error?.message || '無法連線');
    return setStatus('failed', `PocketBase 尚未連線：${reason}`);
  }
}

export function requirePocketBaseReady() {
  if (inDemoMode()) return;
  if (state.mode === 'connected') return;
  const detail = state.message || getPocketBaseConfigError() || '未知錯誤';
  throw new Error(`PocketBase 尚未連線。${detail}`);
}
