import { clientError } from '../server/http.js';
import { logApiRequest } from '../server/safeLog.js';
import publicAssets from '../server/handlers/publicAssets.js';
import reservationsCreate from '../server/handlers/reservationsCreate.js';
import reservationsLookup from '../server/handlers/reservationsLookup.js';
import reservationsCancel from '../server/handlers/reservationsCancel.js';
import staffApprove from '../server/handlers/staffApprove.js';
import staffReject from '../server/handlers/staffReject.js';
import staffCheckout from '../server/handlers/staffCheckout.js';
import staffReturn from '../server/handlers/staffReturn.js';
import staffReservations from '../server/handlers/staffReservations.js';
import inventorySessions from '../server/handlers/inventorySessions.js';
import inventoryRecords from '../server/handlers/inventoryRecords.js';
import adminAssets from '../server/handlers/adminAssets.js';
import adminStaff from '../server/handlers/adminStaff.js';
import adminOperationLogs from '../server/handlers/adminOperationLogs.js';

const routes = new Map([
  ['/api/public/assets', publicAssets],
  ['/api/reservations/create', reservationsCreate],
  ['/api/reservations/lookup', reservationsLookup],
  ['/api/reservations/cancel', reservationsCancel],
  ['/api/staff/approve', staffApprove],
  ['/api/staff/reject', staffReject],
  ['/api/staff/checkout', staffCheckout],
  ['/api/staff/return', staffReturn],
  ['/api/staff/reservations', staffReservations],
  ['/api/inventory/sessions', inventorySessions],
  ['/api/inventory/records', inventoryRecords],
  ['/api/admin/assets', adminAssets],
  ['/api/admin/staff', adminStaff],
  ['/api/admin/operation-logs', adminOperationLogs]
]);

function requestId(req) {
  return String(req.headers['x-vercel-id'] || req.headers['x-request-id'] || '').trim()
    || `hkp-${Date.now().toString(36)}`;
}

function roleTypeFromAuth(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth) return 'anonymous';
  return 'authenticated';
}

export default async function handler(req, res) {
  const started = Date.now();
  const rid = requestId(req);
  const headerPath = req.headers['x-forwarded-uri'] || req.headers['x-invoke-path'] || '';
  const raw = String(headerPath || req.url || '/');
  const url = new URL(raw, 'http://localhost');
  // Preserve query string from the inbound request when rewrite strips path-only destination.
  if (!url.search && req.url && req.url.includes('?')) {
    url.search = req.url.slice(req.url.indexOf('?'));
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  // Ensure downstream handlers see the original public path + query.
  req.url = `${pathname}${url.search}`;
  const route = routes.get(pathname);
  if (!route) {
    logApiRequest({
      requestId: rid,
      path: pathname,
      method: req.method,
      status: 404,
      securityCode: 'not_found',
      durationMs: Date.now() - started,
      roleType: roleTypeFromAuth(req)
    });
    return clientError(res, 404, 'not_found');
  }

  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    const status = res.statusCode || 200;
    let securityCode = null;
    if (status >= 400) {
      try {
        const body = args[0];
        const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : '';
        if (text) securityCode = JSON.parse(text)?.error || `http_${status}`;
      } catch {
        securityCode = `http_${status}`;
      }
    }
    logApiRequest({
      requestId: rid,
      path: pathname,
      method: req.method,
      status,
      securityCode,
      durationMs: Date.now() - started,
      roleType: roleTypeFromAuth(req)
    });
    return originalEnd(...args);
  };

  return route(req, res);
}
