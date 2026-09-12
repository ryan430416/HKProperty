/**
 * QR / 深連結解析與相機掃描。
 * 優先 BarcodeDetector，否則動態載入 html5-qrcode；權限拒絕時由呼叫端保留手動輸入。
 */

let activeStop = null;

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

export async function stopCameraScan() {
  const stop = activeStop;
  activeStop = null;
  if (!stop) return;
  try {
    await stop();
  } catch {
    // ignore stop errors
  }
}

function cameraDeniedError() {
  const err = new Error('無法使用相機，請允許相機權限或改用手動輸入財產編號。');
  err.code = 'permission_denied';
  return err;
}

function preferBackCamera(devices) {
  const list = Array.isArray(devices) ? devices : [];
  return list.find((d) => /back|rear|environment|後|后/i.test(d.label || '')) || list[0] || null;
}

async function startWithBarcodeDetector(videoEl, onDetected) {
  const formats = [
    'qr_code',
    ...(typeof BarcodeDetector !== 'undefined' && BarcodeDetector.getSupportedFormats
      ? (await BarcodeDetector.getSupportedFormats()).filter((f) => f !== 'qr_code')
      : [])
  ];
  const detector = new BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } }
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.setAttribute('autoplay', 'true');
  videoEl.muted = true;
  await videoEl.play();

  let closed = false;
  let raf = 0;
  const stop = async () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((track) => track.stop());
    videoEl.srcObject = null;
  };
  activeStop = stop;

  const tick = async () => {
    if (closed) return;
    try {
      if (videoEl.readyState >= 2) {
        const codes = await detector.detect(videoEl);
        if (codes?.length) {
          const raw = codes[0].rawValue != null ? String(codes[0].rawValue) : '';
          const propertyId = parseScanPayload(raw);
          if (propertyId) {
            await stopCameraScan();
            onDetected(propertyId, raw);
            return;
          }
        }
      }
    } catch {
      // keep scanning
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { engine: 'BarcodeDetector', stop };
}

async function startWithHtml5Qrcode(containerId, onDetected) {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
  const scanner = new Html5Qrcode(containerId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    verbose: false
  });
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // ignore
    }
    try {
      scanner.clear();
    } catch {
      // ignore
    }
  };
  activeStop = stop;

  const config = {
    fps: 8,
    qrbox: { width: 240, height: 240 },
    aspectRatio: 1,
    videoConstraints: { facingMode: { ideal: 'environment' }, audio: false }
  };
  const onSuccess = async (decoded) => {
    const propertyId = parseScanPayload(decoded);
    if (!propertyId || closed) return;
    await stopCameraScan();
    onDetected(propertyId, decoded);
  };
  try {
    await scanner.start({ facingMode: 'environment' }, config, onSuccess, () => {});
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') throw error;
    const cameras = await Html5Qrcode.getCameras();
    const preferred = preferBackCamera(cameras);
    if (!preferred?.id) throw error;
    await scanner.start(preferred.id, config, onSuccess, () => {});
  }
  document.querySelectorAll(`#${containerId} video`).forEach((video) => {
    video.setAttribute('autoplay', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('playsinline', 'true');
    video.muted = true;
  });
  return { engine: 'html5-qrcode', stop };
}

/**
 * @param {{
 *   videoEl: HTMLVideoElement,
 *   fallbackContainerId: string,
 *   onDetected: (propertyId: string, raw: string) => void
 * }} options
 */
export async function startCameraScan({ videoEl, fallbackContainerId, onDetected }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('此瀏覽器不支援相機掃描，請改以手動輸入財產編號。');
  }
  await stopCameraScan();

  const emit = (propertyId, raw) => {
    onDetected(String(propertyId).trim(), String(raw || propertyId));
  };

  if (typeof BarcodeDetector !== 'undefined') {
    try {
      return await startWithBarcodeDetector(videoEl, emit);
    } catch (error) {
      await stopCameraScan();
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        throw cameraDeniedError();
      }
      // fall through to html5-qrcode
    }
  }

  try {
    if (videoEl) {
      videoEl.hidden = true;
      videoEl.srcObject = null;
    }
    return await startWithHtml5Qrcode(fallbackContainerId, emit);
  } catch (error) {
    await stopCameraScan();
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError' || /Permission|permission|NotAllowed/i.test(error?.message || '')) {
      throw cameraDeniedError();
    }
    throw new Error(error?.message || '無法啟動相機掃描');
  }
}
