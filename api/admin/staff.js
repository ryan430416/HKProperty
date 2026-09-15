import { requireAdmin } from '../_lib/pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../_lib/http.js';

function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, Math.min(2, at))}***@${value.slice(at + 1)}`;
}

export default async function handler(req, res) {
  try {
    const { client, user } = await requireAdmin(req.headers.authorization);
    if (req.method === 'GET') {
      const rows = await client.collection('hkp_staff_users').getFullList({ sort: '-created' });
      return json(res, 200, {
        items: rows
          .filter((r) => r.role !== 'service')
          .map((r) => ({
            id: r.id,
            name: r.name,
            emailMasked: maskEmail(r.email),
            role: r.role,
            active: r.active !== false && r.is_active !== false,
            department: r.department || '',
            lastLoginAt: r.last_login_at || null
          }))
      });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!email || !password || !name) return clientError(res, 400, 'fields_required');
      if (body.role && body.role !== 'staff') return clientError(res, 400, 'role_must_be_staff');
      const row = await client.collection('hkp_staff_users').create({
        email,
        password,
        passwordConfirm: password,
        name,
        role: 'staff',
        active: true,
        is_active: true,
        employee_number: String(body.employeeNumber || `S${Date.now().toString(36)}`).trim(),
        department: String(body.department || '').trim(),
        created_by: user.id
      });
      return json(res, 200, { id: row.id, name: row.name, role: row.role });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      if (!body.id) return clientError(res, 400, 'id_required');
      if (body.id === user.id && body.active === false) return clientError(res, 400, 'cannot_disable_self');
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.active !== undefined) {
        patch.active = !!body.active;
        patch.is_active = !!body.active;
      }
      if (body.role !== undefined) {
        if (!['staff', 'admin'].includes(body.role)) return clientError(res, 400, 'role_invalid');
        patch.role = body.role;
      }
      const updated = await client.collection('hkp_staff_users').update(body.id, patch);
      return json(res, 200, { id: updated.id, role: updated.role, active: updated.active });
    }
    return methodNotAllowed(res);
  } catch (error) {
    return safeError(res, error);
  }
}
