import crypto from 'node:crypto';

export function collapse(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

export function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function assertPerson({ unit, name, phone }) {
  if (!collapse(unit)) throw Object.assign(new Error('validation'), { status: 400, code: 'unit_required' });
  if (!collapse(name)) throw Object.assign(new Error('validation'), { status: 400, code: 'name_required' });
  const digits = normalizePhone(phone);
  if (digits.length < 8 || digits.length > 15) {
    throw Object.assign(new Error('validation'), { status: 400, code: 'phone_invalid' });
  }
  return { unit: collapse(unit), name: collapse(name), phone: digits };
}

export function createRequestNo() {
  return `RQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createVerificationCode() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function maskPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
