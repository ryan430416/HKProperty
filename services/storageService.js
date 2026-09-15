/**
 * Asset photo upload/display is disabled in the UI.
 * Existing PocketBase `photo` / `image` files are left untouched on purpose.
 * Do not re-enable uploads without an explicit product decision.
 */

export function publicImageUrl() {
  return '';
}

export async function uploadAssetImage() {
  throw new Error('財產圖片上傳功能已停用');
}
