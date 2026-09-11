import { pbMessage, requireClient } from './pocketbaseClient.js';
import { hkpDirect } from './hkpDirect.js';

export async function hkpPost(path, body = {}) {
  const client = requireClient();
  try {
    return await client.send(path, {
      method: 'POST',
      body
    });
  } catch (error) {
    const status = error?.status || error?.data?.code;
    if (status === 404) return hkpDirect(path, body);
    throw new Error(pbMessage(error));
  }
}

export function relationId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.id || '';
}

export function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function getFullList(collection, options = {}) {
  const client = requireClient();
  try {
    const data = await client.collection(collection).getFullList(options);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch (error) {
    throw new Error(pbMessage(error, `無法載入 ${collection}`));
  }
}
