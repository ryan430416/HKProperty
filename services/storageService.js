import { PB } from '../pocketbase/schema.mjs';
import { pbMessage, requireClient } from './pocketbaseClient.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export function publicImageUrl(record, filename) {
  if (!record || !filename) return '';
  const client = requireClient();
  return client.files.getURL(record, filename);
}

export async function uploadAssetImage(assetId, file) {
  if (!file) throw new Error('請先選擇圖片');
  if (!ALLOWED.includes(file.type)) throw new Error('僅支援 JPG、PNG、WebP');
  if (file.size > MAX_BYTES) throw new Error('檔案大小不可超過 5 MB');
  const client = requireClient();
  const form = new FormData();
  form.append('image', file);
  try {
    const row = await client.collection(PB.assets).update(assetId, form);
    const name = Array.isArray(row.image) ? row.image[0] : row.image;
    return publicImageUrl(row, name);
  } catch (error) {
    throw new Error(pbMessage(error, '圖片上傳失敗'));
  }
}
