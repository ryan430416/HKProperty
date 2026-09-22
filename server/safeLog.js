/**
 * Safe structured logging for Vercel Serverless API.
 * Never log PII, tokens, cookies, request bodies, or env values.
 */

const SENSITIVE_KEY = /pass(word)?|token|authorization|cookie|secret|phone|name|unit|email|body|payload|header/i;

function scrub(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => scrub(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = scrub(item, depth + 1);
  }
  return out;
}

/**
 * @param {{
 *   requestId?: string,
 *   path?: string,
 *   method?: string,
 *   status?: number,
 *   securityCode?: string|null,
 *   durationMs?: number,
 *   roleType?: string
 * }} entry
 */
export function logApiRequest(entry = {}) {
  const payload = {
    requestId: entry.requestId || null,
    path: entry.path || null,
    method: entry.method || null,
    status: entry.status ?? null,
    securityCode: entry.securityCode || null,
    durationMs: entry.durationMs ?? null,
    roleType: entry.roleType || 'unknown'
  };
  if (payload.status >= 400) console.error('[HKProperty API]', payload);
  else console.log('[HKProperty API]', payload);
}

export function logSafeError(scope, error, extra = {}) {
  const payload = scrub({
    scope,
    status: error?.status || error?.data?.code || null,
    message: error?.message || 'error',
    code: error?.code || null,
    ...extra
  });
  console.error('[HKProperty]', payload);
  return payload;
}
