/**
 * Browser smoke against production build (vite preview).
 * Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4173 &
 *        npx playwright test tools/smoke_preview.spec.mjs  (or run this file)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4173;
const base = `http://127.0.0.1:${PORT}/`;

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let ready = false;
preview.stdout.on('data', (buf) => {
  if (String(buf).includes(String(PORT))) ready = true;
});
preview.stderr.on('data', (buf) => {
  if (String(buf).includes(String(PORT))) ready = true;
});

for (let i = 0; i < 40 && !ready; i += 1) await sleep(250);
if (!ready) {
  // try fetch anyway
  try {
    await fetch(base);
    ready = true;
  } catch {
    preview.kill();
    throw new Error('vite preview failed to start');
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror:${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console:${msg.text()}`);
});

const scenarios = [
  {
    role: 'borrower',
    btn: '#demoBorrowerBtn',
    views: ['selfService', 'inventory', 'loanHistory']
  },
  {
    role: 'staff',
    btn: '#demoStaffBtn',
    views: ['dashboard', 'selfService', 'inventory', 'loans', 'loanHistory', 'usage']
  },
  {
    role: 'admin',
    btn: '#demoAdminBtn',
    views: ['dashboard', 'selfService', 'inventory', 'loans', 'loanHistory', 'usage']
  }
];

const results = [];
try {
  for (const scenario of scenarios) {
    errors.length = 0;
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click(scenario.btn);
    await page.waitForSelector('#main:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(400);
    for (const view of scenario.views) {
      await page.locator(`.nav-item[data-view="${view}"]`).click();
      await page.waitForTimeout(350);
      const viewEl = page.locator(`#view-${view}`);
      await viewEl.waitFor({ state: 'visible', timeout: 10000 });
    }
    const status = (await page.textContent('#backendStatusText')) || '';
    const mapErrors = errors.filter((e) => /map/i.test(e));
    results.push({
      role: scenario.role,
      status,
      errorCount: errors.length,
      mapErrors,
      sampleErrors: errors.slice(0, 5)
    });
    if (mapErrors.length) throw new Error(`${scenario.role} still has .map errors: ${mapErrors.join(' | ')}`);
    await page.click('#logoutBtn');
    await page.waitForSelector('#authGate:not([hidden])', { timeout: 10000 });
  }
} finally {
  await browser.close();
  preview.kill();
}

const failed = results.filter((r) => r.errorCount > 0);
console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
if (failed.length) process.exit(1);
