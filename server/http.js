export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res) {
  return json(res, 405, { error: 'method_not_allowed' });
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export function clientError(res, status, code) {
  return json(res, status, { error: code });
}

export function safeError(res, error) {
  const status = error?.status || 500;
  const code = status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
      : status === 404 ? 'not_found'
        : status === 409 ? 'conflict'
          : status === 429 ? 'rate_limited'
            : 'request_failed';
  return json(res, status >= 400 && status < 600 ? status : 500, { error: code });
}

const buckets = new Map();

export function rateLimit(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const row = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > row.reset) {
    row.count = 0;
    row.reset = now + windowMs;
  }
  row.count += 1;
  buckets.set(key, row);
  if (row.count > limit) {
    const err = new Error('rate_limited');
    err.status = 429;
    throw err;
  }
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}
