/**
 * Phase-2 public & staff API client.
 * Public flows go through Vercel /api/* — never query hkp_assets(_guest) from the browser.
 */

function apiBase() {
  return '';
}

async function parse(res) {
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = new Error(body.error || 'request_failed');
    err.status = res.status;
    err.code = body.error;
    throw err;
  }
  return body;
}

export async function listPublicAssets({ q = '', location = '', available = true, page = 1, perPage = 20 } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage)
  });
  if (q) params.set('q', q);
  if (location) params.set('location', location);
  if (available) params.set('available', '1');
  return parse(await fetch(`${apiBase()}/api/public/assets?${params}`));
}

export async function createReservation(payload) {
  return parse(await fetch(`${apiBase()}/api/reservations/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
}

export async function lookupReservation(requestNo, verificationCode) {
  return parse(await fetch(`${apiBase()}/api/reservations/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestNo, verificationCode })
  }));
}

export async function cancelReservationApi(requestNo, verificationCode) {
  return parse(await fetch(`${apiBase()}/api/reservations/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestNo, verificationCode })
  }));
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

export async function staffListReservations(token, status = '') {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return parse(await fetch(`${apiBase()}/api/staff/reservations${q}`, {
    headers: { Authorization: `Bearer ${token}` }
  }));
}

export async function staffApprove(token, id, note = '') {
  return parse(await fetch(`${apiBase()}/api/staff/approve`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ id, note })
  }));
}

export async function staffReject(token, id, reason = '') {
  return parse(await fetch(`${apiBase()}/api/staff/reject`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ id, reason })
  }));
}

export async function staffCheckout(token, id, { condition = '', idempotencyKey = '' } = {}) {
  return parse(await fetch(`${apiBase()}/api/staff/checkout`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ id, condition, idempotencyKey: idempotencyKey || id })
  }));
}

export async function staffReturn(token, id, { condition = '', note = '', action = 'confirm' } = {}) {
  return parse(await fetch(`${apiBase()}/api/staff/return`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ id, condition, note, action })
  }));
}

export async function inventoryListSessions(token) {
  return parse(await fetch(`${apiBase()}/api/inventory/sessions`, {
    headers: { Authorization: `Bearer ${token}` }
  }));
}

export async function inventoryCreateSession(token, title, note = '') {
  return parse(await fetch(`${apiBase()}/api/inventory/sessions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title, note })
  }));
}

export async function inventoryGetRecords(token, sessionId) {
  return parse(await fetch(`${apiBase()}/api/inventory/records?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  }));
}

export async function inventorySaveRecord(token, payload) {
  return parse(await fetch(`${apiBase()}/api/inventory/records`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  }));
}

export async function adminListOperationLogs(token, {
  page = 1,
  perPage = 20,
  action = '',
  from = '',
  to = ''
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage)
  });
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return parse(await fetch(`${apiBase()}/api/admin/operation-logs?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  }));
}
