import fs from 'node:fs';
function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}
const env = readEnv('.env');
const PocketBase = (await import('pocketbase')).default;
const pb = new PocketBase('https://db.keson.pro');

const out = { markers: {} };
try {
  await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
  out.markers.superusers_auth = true;
} catch (error) {
  out.markers.superusers_auth = false;
  out.superusers_error = error.status || error.message;
}
try {
  const legacy = await fetch('https://db.keson.pro/api/admins/auth-with-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'x', password: 'y' })
  });
  out.markers.legacy_admins_route = legacy.status;
  out.legacy_body = (await legacy.text()).slice(0, 120);
} catch (error) {
  out.markers.legacy_admins_route = String(error.message);
}
try {
  const html = await (await fetch('https://db.keson.pro/_/')).text();
  out.markers.admin_ui = true;
  out.admin_hints = [...html.matchAll(/(\d+\.\d+\.\d+)/g)].map((m) => m[1]).slice(0, 20);
  out.has_vite = /vite|assets\/index-/i.test(html);
} catch (error) {
  out.markers.admin_ui = false;
}
out.conclusion = out.markers.superusers_auth && out.markers.legacy_admins_route === 404
  ? 'PocketBase >= 0.23 (uses _superusers; legacy /api/admins gone)'
  : 'version inconclusive';
console.log(JSON.stringify(out, null, 2));
