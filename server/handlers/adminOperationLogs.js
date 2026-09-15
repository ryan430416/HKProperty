import { requireAdmin } from '../pb.js';
import { clientError, json, methodNotAllowed, safeError } from '../http.js';

const SENSITIVE_KEY = /pass|token|secret|hash|verification|phone|password|credential/i;

function sanitizeDetail(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDetail(item, depth + 1));
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 200)}…`;
    return value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = sanitizeDetail(item, depth + 1);
  }
  return out;
}

function publicLogFields(row) {
  return {
    id: row.id,
    action: row.action || '',
    entityType: row.entity_type || '',
    entityId: row.entity_id || '',
    assetId: row.asset || '',
    actorName: row.actor_name || '',
    detail: sanitizeDetail(row.detail || {}),
    createdAt: row.created || row.created_at || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  try {
    const { client } = await requireAdmin(req.headers.authorization);
    const url = new URL(req.url, 'http://localhost');
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('perPage') || 20)));
    const action = String(url.searchParams.get('action') || '').trim().replace(/"/g, '');
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();

    const filters = [];
    if (action) filters.push(`action ~ "${action}"`);
    if (from) {
      const fromDate = new Date(from);
      if (!(fromDate.getTime() > 0)) return clientError(res, 400, 'from_invalid');
      filters.push(`created >= "${fromDate.toISOString().replace('T', ' ')}"`);
    }
    if (to) {
      const toDate = new Date(to);
      if (!(toDate.getTime() > 0)) return clientError(res, 400, 'to_invalid');
      filters.push(`created <= "${toDate.toISOString().replace('T', ' ')}"`);
    }

    const query = {
      fields: 'id,action,entity_type,entity_id,asset,actor_name,detail,created'
    };
    if (filters.length) query.filter = filters.join(' && ');
    const list = await client.collection('hkp_operation_logs').getList(page, perPage, query);

    return json(res, 200, {
      page: list.page,
      perPage: list.perPage,
      totalItems: list.totalItems,
      totalPages: list.totalPages,
      items: list.items.map(publicLogFields)
    });
  } catch (error) {
    return safeError(res, error);
  }
}
