/**
 * Phase 3A.1 visual / overflow QA against Production.
 * Screenshots → docs/exports/phase3a1/screenshots/
 * Results → docs/exports/phase3a1/visual-qa-results.json
 * Never prints secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...readEnv('.env.service.local') };
const BASE = process.env.PROD_URL || 'https://hk-property.vercel.app/';
const OUT = 'docs/exports/phase3a1';
const SHOT = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOT, { recursive: true });

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '412x915', width: 412, height: 915, mobile: true },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '1366x768', width: 1366, height: 768, mobile: false }
];

async function measure(page, label) {
  return page.evaluate((lbl) => {
    const clientW = document.documentElement.clientWidth;
    const scrollW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const overflowers = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement) || el.hidden || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > clientW + 2 || r.left < -2) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: String(el.className || '').slice(0, 80),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width)
        });
        if (overflowers.length >= 12) break;
      }
    }
    const visibleInputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter((el) => !el.closest('[hidden]') && el.offsetParent !== null)
      .map((el) => ({ id: el.id || el.name || el.type, fs: getComputedStyle(el).fontSize }));
    const smallInputs = visibleInputs.filter((i) => parseFloat(i.fs) < 16);
    // long-name probe
    const host = document.querySelector('.portal-results, .portal-shell, main, .panel') || document.body;
    const probe = document.createElement('div');
    probe.className = 'wrap-cell portal-name';
    probe.textContent = `超長財產名稱測試_${'測試項目名稱'.repeat(10)}／位置：${'教學大樓A棟B區C室'.repeat(5)}／單位：${'某某學系學生自治會器材組'.repeat(4)}`;
    host.appendChild(probe);
    const pr = probe.getBoundingClientRect();
    const longNameOk = pr.right <= clientW + 2;
    probe.remove();
    return {
      label: lbl,
      bodyOverflow: scrollW > clientW + 1,
      scrollW,
      clientW,
      overflowCount: overflowers.length,
      overflowers,
      smallInputs,
      longNameOk,
      step: document.querySelector('[data-portal-step]:not([hidden])')?.dataset.portalStep || null,
      view: document.querySelector('.view:not([hidden])')?.id || null,
      portalHidden: document.getElementById('publicPortal')?.hidden ?? null,
      appHidden: document.querySelector('.app')?.hidden ?? null,
      navVisible: [...document.querySelectorAll('.nav-item')].filter((b) => !b.hidden && getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim())
    };
  }, label);
}

async function shot(page, vp, slug) {
  const file = `${vp}-${slug}.png`;
  await page.screenshot({ path: path.join(SHOT, file), fullPage: false });
  return `docs/exports/phase3a1/screenshots/${file}`;
}

async function login(page, email, password) {
  await page.locator('#staffLoginOpen').click();
  await page.locator('#staffEmail').fill(email);
  await page.locator('#staffPassword').fill(password);
  await page.locator('#staffLoginBtn').click();
  await page.waitForTimeout(2500);
  const appVisible = await page.evaluate(() => {
    const app = document.querySelector('.app');
    return app && !app.hidden && getComputedStyle(app).display !== 'none';
  });
  return appVisible;
}

async function logoutIfPossible(page) {
  const logout = page.locator('#logoutBtn, [data-logout], button:has-text("登出")');
  if (await logout.count()) {
    try {
      await logout.first().click({ timeout: 2000 });
      await page.waitForTimeout(800);
    } catch {
      // ignore
    }
  }
  await page.goto(BASE, { waitUntil: 'networkidle' });
}

async function runPublicFlow(page, vp) {
  const records = [];
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  let m = await measure(page, '01-public-home');
  records.push({ ...m, screenshot: await shot(page, vp, '01-public-home') });

  await page.locator('#portalHomeReserve').click();
  await page.waitForTimeout(1200);
  m = await measure(page, '02-search');
  records.push({ ...m, screenshot: await shot(page, vp, '02-search') });

  // open reserve form from first card if present
  const reserveBtn = page.locator('#portalResults button.primary, #portalResults button:has-text("預借")').first();
  if (await reserveBtn.count()) {
    await reserveBtn.click();
    await page.waitForTimeout(700);
    m = await measure(page, '03-reserve-form');
    records.push({ ...m, screenshot: await shot(page, vp, '03-reserve-form') });
    await page.locator('#portalFormBack').click().catch(() => {});
    await page.waitForTimeout(300);
  } else {
    records.push({ label: '03-reserve-form', skipped: true, reason: 'no asset card button' });
  }

  // back to home then scan
  if (await page.locator('#portalBack').count()) await page.locator('#portalBack').click().catch(() => {});
  await page.waitForTimeout(300);
  // ensure home
  if (!(await page.locator('#portalScanBtn').isVisible().catch(() => false))) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  }
  await page.locator('#portalScanBtn').click();
  await page.waitForTimeout(500);
  m = await measure(page, '05-scan');
  records.push({ ...m, screenshot: await shot(page, vp, '05-scan') });

  // camera permission prompt check (automated env — expect fail or prompt)
  let cameraNote = 'not_attempted';
  try {
    await page.locator('#portalStartCamera').click();
    await page.waitForTimeout(1200);
    const msg = await page.locator('#portalMessage').textContent().catch(() => '');
    cameraNote = msg || 'clicked_start_camera';
  } catch (e) {
    cameraNote = `camera_click_error:${String(e.message || e).slice(0, 80)}`;
  }
  records.push({
    label: '05-scan-camera',
    cameraNote,
    manualRequired: true,
    note: '真實鏡頭／權限拒絕／stream 停止需人工手機測試'
  });
  m = await measure(page, '05-scan-after-camera-click');
  records.push({ ...m, screenshot: await shot(page, vp, '05-scan-after-camera') });

  await page.locator('#portalScanBack').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('#portalManageOpen').click();
  await page.waitForTimeout(500);
  m = await measure(page, '04-manage');
  records.push({ ...m, screenshot: await shot(page, vp, '04-manage') });

  await page.locator('#staffLoginOpen').click();
  await page.waitForTimeout(400);
  m = await measure(page, '06-staff-login');
  records.push({ ...m, screenshot: await shot(page, vp, '06-staff-login') });
  // close dialog
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#staffLoginClose').click().catch(() => {});

  return records;
}

async function runStaffViews(page, vp, role) {
  const records = [];
  const views = role === 'admin'
    ? [
        ['staffDesk', '07-staff-desk'],
        ['audit', '11-audit'],
        ['dashboard', '12-admin-dashboard'],
        ['inventory', '13-inventory'],
        ['logs', '16-logs'],
        ['users', '15-users'],
        ['settings', '12b-settings']
      ]
    : [
        ['staffDesk', '07-staff-desk'],
        ['audit', '11-audit']
      ];

  for (const [view, slug] of views) {
    const nav = page.locator(`.nav-item[data-view="${view}"]`);
    if (!(await nav.count()) || !(await nav.isVisible().catch(() => false))) {
      records.push({ label: slug, skipped: true, reason: `nav ${view} not visible for ${role}` });
      continue;
    }
    await nav.click();
    await page.waitForTimeout(900);
    // open add asset dialog on inventory for admin
    if (view === 'inventory' && role === 'admin') {
      const addBtn = page.locator('#addAssetBtn, button:has-text("新增財產")').first();
      if (await addBtn.count()) {
        await addBtn.click().catch(() => {});
        await page.waitForTimeout(500);
        const mForm = await measure(page, '14-asset-form');
        records.push({ ...mForm, screenshot: await shot(page, vp, '14-asset-form') });
        await page.keyboard.press('Escape').catch(() => {});
        await page.locator('dialog[open] button:has-text("取消"), dialog[open] .ghost-btn').first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    const m = await measure(page, slug);
    records.push({ ...m, screenshot: await shot(page, vp, `${slug}-${role}`) });
  }

  // desk sub-panels: confirm / loan / return if buttons exist
  await page.locator('.nav-item[data-view="staffDesk"]').click().catch(() => {});
  await page.waitForTimeout(600);
  for (const [desk, slug] of [
    ['pending', '08-confirm'],
    ['out', '09-loan'],
    ['overdue', '10-return-or-overdue']
  ]) {
    const btn = page.locator(`[data-desk="${desk}"]`);
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(500);
      const m = await measure(page, slug);
      records.push({ ...m, screenshot: await shot(page, vp, `${slug}-${role}`) });
    }
  }

  return records;
}

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  viewports: {},
  roles: {},
  issues: [],
  qr: {
    status: '需人工手機測試',
    notes: [
      '自動化環境無法驗證真實鏡頭',
      '程式碼：portalStartCamera 才呼叫 getUserMedia；關閉 scan 會 stopPortalCamera',
      '手動輸入財產編號可用'
    ]
  }
};

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      deviceScaleFactor: vp.mobile ? 2 : 1,
      locale: 'zh-TW'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const vpRecords = [];
    try {
      vpRecords.push(...(await runPublicFlow(page, vp.name)));
    } catch (e) {
      report.issues.push({ viewport: vp.name, where: 'public', error: String(e.message || e).slice(0, 200) });
    }

    // Admin login on first mobile + desktop representative sizes to limit time
    if (['375x667', '768x1024', '1366x768'].includes(vp.name)) {
      try {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        const ok = await login(page, env.HKP_FORMAL_ADMIN_EMAIL, env.HKP_FORMAL_PASSWORD);
        report.roles.adminLogin = ok ? 'ok' : 'failed';
        if (ok) {
          const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-item')]
            .filter((b) => !b.hidden && getComputedStyle(b).display !== 'none')
            .map((b) => ({ text: b.textContent.trim(), view: b.dataset.view, min: b.dataset.minRole })));
          report.roles.adminNav = nav;
          vpRecords.push(...(await runStaffViews(page, vp.name, 'admin')));
        }
      } catch (e) {
        report.issues.push({ viewport: vp.name, where: 'admin', error: String(e.message || e).slice(0, 200) });
      }

      try {
        await logoutIfPossible(page);
        await page.goto(BASE, { waitUntil: 'networkidle' });
        const ok = await login(page, env.HKP_FORMAL_STAFF_EMAIL, env.HKP_FORMAL_PASSWORD);
        report.roles.staffLogin = ok ? 'ok' : 'failed';
        if (ok) {
          const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-item')]
            .filter((b) => !b.hidden && getComputedStyle(b).display !== 'none')
            .map((b) => ({ text: b.textContent.trim(), view: b.dataset.view, min: b.dataset.minRole })));
          report.roles.staffNav = nav;
          // borrower-forbidden checks on staff: should not see users/inventory/logs admin
          const forbidden = nav.filter((n) => ['users', 'inventory', 'logs', 'settings', 'dashboard'].includes(n.view));
          report.roles.staffForbiddenVisible = forbidden;
          vpRecords.push(...(await runStaffViews(page, vp.name, 'staff')));
        }
      } catch (e) {
        report.issues.push({ viewport: vp.name, where: 'staff', error: String(e.message || e).slice(0, 200) });
      }
    }

    report.viewports[vp.name] = vpRecords;
    const bad = vpRecords.filter((r) => r.bodyOverflow || (r.overflowCount > 0) || r.longNameOk === false || (r.smallInputs && r.smallInputs.length));
    for (const b of bad) {
      report.issues.push({
        viewport: vp.name,
        label: b.label,
        bodyOverflow: b.bodyOverflow,
        overflowCount: b.overflowCount,
        overflowers: b.overflowers,
        smallInputs: b.smallInputs,
        longNameOk: b.longNameOk
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'visual-qa-results.json'), JSON.stringify(report, null, 2));
const summary = {
  issueCount: report.issues.length,
  roles: report.roles,
  perViewport: Object.fromEntries(Object.entries(report.viewports).map(([k, v]) => [k, {
    pages: v.filter((x) => !x.skipped && x.label).length,
    overflowIssues: v.filter((x) => x.bodyOverflow || x.overflowCount > 0).length,
    smallFont: v.filter((x) => x.smallInputs?.length).length
  }])),
  issuesPreview: report.issues.slice(0, 20)
};
console.log(JSON.stringify(summary, null, 2));
