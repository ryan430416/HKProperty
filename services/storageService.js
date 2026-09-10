import { requireClient, throwIfError } from './supabaseClient.js';
import { isStaff } from './authService.js';

const BUCKET = 'asset-images';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function extOf(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function publicImageUrl(path) {
  if (!path) return '';
  const client = requireClient();
  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || '';
}

export async function listAssetImages(assetId) {
  const client = requireClient();
  const { data, error } = await client
    .from('asset_images')
    .select('*')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false });
  throwIfError(error, '無法載入圖片');
  return (data || []).map((row) => ({
    ...row,
    url: publicImageUrl(row.storage_path)
  }));
}

export async function uploadAssetImage(assetId, file) {
  if (!isStaff()) throw new Error('只有經辦人員或管理者可以上傳圖片');
  if (!file) throw new Error('請先選擇圖片');
  if (!ALLOWED.includes(file.type)) throw new Error('僅支援 JPG、PNG、WebP');
  if (file.size > MAX_BYTES) throw new Error('檔案大小不可超過 5 MB');

  const client = requireClient();
  const ext = extOf(file.type);
  const path = `assets/${assetId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type
  });
  throwIfError(uploadError, '圖片上傳失敗');

  const { error: dbError } = await client.from('asset_images').insert({
    asset_id: assetId,
    storage_path: path,
    is_primary: true,
    mime_type: file.type
  });
  if (dbError) {
    await client.storage.from(BUCKET).remove([path]);
    throwIfError(dbError, '圖片紀錄寫入失敗');
  }
  return publicImageUrl(path);
}

export async function deleteAssetImage(imageRow) {
  if (!isStaff()) throw new Error('只有經辦人員或管理者可以刪除圖片');
  const client = requireClient();
  if (imageRow.storage_path) {
    const { error } = await client.storage.from(BUCKET).remove([imageRow.storage_path]);
    throwIfError(error, '無法刪除圖片檔案');
  }
  const { error } = await client.from('asset_images').delete().eq('id', imageRow.id);
  throwIfError(error, '無法刪除圖片紀錄');
}
