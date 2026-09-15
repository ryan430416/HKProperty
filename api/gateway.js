import { clientError } from '../server/http.js';
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

export default async function handler(req, res) {
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
  if (!route) return clientError(res, 404, 'not_found');
  return route(req, res);
}
