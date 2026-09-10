/**
 * 預留手機相機掃描 QR Code 的接點。
 * 目前雛形改由手動輸入財產編號完成查找。
 */
export function startCameraScan() {
  return Promise.reject(new Error('相機掃描功能尚未啟用，請改以手動輸入財產編號。'));
}

export function parseScanPayload(raw) {
  return String(raw ?? '').trim();
}
