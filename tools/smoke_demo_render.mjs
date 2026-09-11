/**
 * Smoke-test demo data shape + filter options (the production .map crash).
 * Usage: npm run build && npx vite-node tools/smoke_demo_render.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear()
};
globalThis.localStorage = globalThis.sessionStorage;

const { enterDemo, exitDemo, demoAssets, demoLoans, demoUsage, demoUsers, demoAudits } = await import('../services/demoStore.js');
const { loadCatalog, getFilterOptions, listItems, getStats } = await import('../services/inventoryService.js');
const { loadLoans, listLoans, getLoanDashboardStats } = await import('../services/loanService.js');
const { loadUsage, listUsage } = await import('../services/usageService.js');
const { loadAudits, listAudits } = await import('../services/auditService.js');

function assertArray(name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be array, got ${value === undefined ? 'undefined' : typeof value}`);
  }
}

function fillSelect(values) {
  if (!Array.isArray(values)) {
    throw new Error(`fillSelect 需要陣列，實際收到：${values === undefined ? 'undefined' : typeof values}`);
  }
  return values.map((v) => String(v));
}

const roleResults = [];
for (const role of ['borrower', 'staff', 'admin']) {
  store.clear();
  enterDemo(role);
  await loadCatalog();
  await loadLoans();
  await loadUsage();
  await loadAudits();

  const options = getFilterOptions();
  assertArray('locations', options.locations);
  assertArray('departments', options.departments);
  assertArray('statuses', options.statuses);
  assertArray('auditStatuses', options.auditStatuses);
  fillSelect(options.locations);
  fillSelect(options.statuses);
  fillSelect(options.auditStatuses);
  fillSelect(options.departments);

  assertArray('listItems', listItems());
  assertArray('listLoans', listLoans());
  assertArray('listUsage', listUsage());
  assertArray('listAudits', listAudits());
  assertArray('demoAssets', demoAssets());
  assertArray('demoLoans', demoLoans());
  assertArray('demoUsage', demoUsage());
  assertArray('demoUsers', demoUsers());
  assertArray('demoAudits', demoAudits());

  const stats = getStats();
  if (typeof stats.pending !== 'number') throw new Error('stats.pending missing');
  getLoanDashboardStats();

  roleResults.push({ role, assets: listItems().length, auditStatuses: options.auditStatuses });
  exitDemo();
}

const root = join(process.cwd(), 'dist');
const indexPath = join(root, 'index.html');
if (!existsSync(indexPath)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}
const html = readFileSync(indexPath, 'utf8');
const scriptMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
if (!html.includes('backendStatusBanner')) {
  throw new Error('dist index missing backendStatusBanner');
}
if (!scriptMatch) throw new Error('dist entry missing');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml'
};
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(root, decodeURIComponent(rel));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const home = await fetch(`http://127.0.0.1:${port}/`);
const asset = await fetch(`http://127.0.0.1:${port}${scriptMatch[1]}`);
const bundle = await asset.text();
server.close();

if (!home.ok || !asset.ok) throw new Error('dist serve failed');
if (!bundle.includes('auditStatuses')) throw new Error('built bundle missing auditStatuses');
if (!bundle.includes('backendStatusBanner') && !bundle.includes('PocketBase 已連線')) {
  throw new Error('built bundle missing backend status UI strings');
}

console.log(JSON.stringify({
  ok: true,
  rootCause: 'getFilterOptions() omitted auditStatuses → fillSelect(undefined).map',
  distEntry: scriptMatch[1],
  roles: roleResults
}, null, 2));
