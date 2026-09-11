/**
 * QR / 深連結解析。
 * 支援：
 * - 純財產編號
 * - https://hk-property.vercel.app/?action=asset&propertyId=820091001
 */
export function startCameraScan() {
  return Promise.reject(new Error('相機掃描功能尚未啟用，請改以手動輸入財產編號，或使用手機相機掃描 QR 後開啟連結。'));
}

export function parseScanPayload(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    if (text.includes('://') || text.startsWith('?') || text.includes('propertyId=')) {
      const url = text.includes('://') ? new URL(text) : new URL(text, 'https://hk-property.vercel.app/');
      const id = url.searchParams.get('propertyId') || url.searchParams.get('id') || '';
      if (id) return id.trim();
    }
  } catch {
    // fall through
  }
  const match = text.match(/propertyId=([^&\s#]+)/i);
  if (match) return decodeURIComponent(match[1]).trim();
  return text;
}

export function buildAssetQrUrl(propertyId, base = 'https://hk-property.vercel.app/') {
  const url = new URL(base);
  url.searchParams.set('action', 'asset');
  url.searchParams.set('propertyId', String(propertyId));
  return url.toString();
}

export function readAssetDeepLink(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  const action = params.get('action');
  const propertyId = params.get('propertyId') || params.get('id');
  if (action === 'asset' && propertyId) {
    return { action: 'asset', propertyId: String(propertyId).trim() };
  }
  return null;
}
