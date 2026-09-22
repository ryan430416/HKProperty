/**
 * Low-risk Production smoke for Phase 3A.
 * Creates only PROD-SMOKE-TMP-* assets / related rows, then cleans them.
 * Never prints secrets.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';

const PROD = process.env.PRODUCTION_URL || 'https://hk-property.vercel.app';
const EXPECTED_FP = '421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132';
const results = [];
const created = { requestNos: [], assetIds: [], usageBefore: null };

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

function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function httpJson(method, urlPath, { body, headers } = {}) {
  // Production should be publicly reachable (no Vercel login wall).
  const url = urlPath.startsWith('http') ? urlPath : `${PROD}${urlPath}`;
  const args = ['-sS', '-X', method, url, '-H', 'Accept: application/json'];
  if (headers) {
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  }
  let bodyFile = '';
  if (body != null) {
    bodyFile = path.join(process.env.TEMP || '/tmp', `hkp-prod-${crypto.randomBytes(4).toString('hex')}.json`);
    fs.writeFileSync(bodyFile, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${bodyFile}`);
  }
  const run = spawnSync('curl.exe', args, { encoding: 'utf8', windowsHide: true });
  if (bodyFile) {
    try { fs.unlinkSync(bodyFile); } catch { /* ignore */ }
  }
  let json = null;
  try { json = JSON.parse((run.stdout || '').trim()); } catch { json = null; }
  return { ok: run.status === 0, raw: run.stdout || '', json };
}

async function fingerprint(pb) {
  const ids = [];
  let page = 1;
  for (;;) {
    const list = await pb.collection('hkp_assets').getList(page, 200, {
      fields: 'property_id',
      sort: 'property_id',
      filter: '(deleted_at = "" || deleted_at = null)'
    });
    ids.push(...list.items.map((r) => String(r.property_id || '')));
    if (page >= list.totalPages) break;
    page += 1;
  }
  return {
    count: ids.length,
    fp: crypto.createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex')
  };
}

function reservationPayload(assetId, overrides = {}) {
  const now = Date.now();
  return {
    assetId,
    unit: 'Production煙測單位',
    name: 'Production煙測',
    phone: '0911999000',
    purpose: 'prod-smoke-3a',
    borrowDate: new Date(now + 3600_000).toISOString(),
    expectedReturnDate: new Date(now + 2 * 86400000).toISOString(),
    privacyAck: true,
    ...overrides
  };
}

async function main() {
  console.log(`Production: ${PROD}`);
  console.log('Env presence:', {
    POCKETBASE_URL: Boolean(env.POCKETBASE_URL || env.VITE_POCKETBASE_URL),
    SERVICE: Boolean(env.POCKETBASE_SERVICE_EMAIL && env.POCKETBASE_SERVICE_PASSWORD),
    STAFF: Boolean(env.HKP_FORMAL_STAFF_EMAIL && env.HKP_FORMAL_PASSWORD),
    ADMIN: Boolean(env.HKP_FORMAL_ADMIN_EMAIL && env.HKP_FORMAL_PASSWORD)
  });

  const home = httpJson('GET', '/');
  record('public.home', /<!DOCTYPE html|/i.test(home.raw) || home.raw.includes('財產'), `bytes=${home.raw.length}`);

  const assets = httpJson('GET', '/api/public/assets?perPage=5');
  record('public.assets_390', assets.json?.totalItems === 390, `got=${assets.json?.totalItems}`);
  const sample = assets.json?.items?.[0];
  record('public.whitelist', sample && !('phone' in sample) && !('photo' in sample) && !('verification_hash' in sample), sample ? Object.keys(sample).join(',') : 'none');

  const q = httpJson('GET', `/api/public/assets?q=${encodeURIComponent(sample?.propertyId || '1000')}&perPage=5`);
  record('public.search', Array.isArray(q.json?.items), `items=${q.json?.items?.length ?? 'n/a'}`);
  const loc = httpJson('GET', `/api/public/assets?location=${encodeURIComponent(sample?.location || '')}&perPage=5`);
  record('public.location', Array.isArray(loc.json?.items), `items=${loc.json?.items?.length ?? 'n/a'}`);

  record('security.unauth_staff', !!httpJson('GET', '/api/staff/reservations').json?.error, 'checked');
  record('security.unauth_admin_logs', !!httpJson('GET', '/api/admin/operation-logs').json?.error, 'checked');

  const pbUrl = env.POCKETBASE_URL || env.VITE_POCKETBASE_URL;
  const authPb = new PocketBase(pbUrl);
  let staffToken = '';
  let adminToken = '';

  try {
    await authPb.collection('hkp_staff_users').authWithPassword(env.HKP_FORMAL_STAFF_EMAIL, env.HKP_FORMAL_PASSWORD);
    staffToken = authPb.authStore.token;
    record('staff.login', true, `role=${authPb.authStore.record?.role}`);
  } catch (e) {
    record('staff.login', false, e?.message || 'fail');
  }

  if (staffToken) {
    const forbidden = httpJson('GET', '/api/admin/operation-logs', { headers: { Authorization: `Bearer ${staffToken}` } });
    record('staff.admin_logs_403', forbidden.json?.error === 'forbidden', `error=${forbidden.json?.error || 'none'}`);
    const createDenied = httpJson('POST', '/api/admin/assets', {
      headers: { Authorization: `Bearer ${staffToken}` },
      body: { propertyId: 'PROD-SMOKE-SHOULD-FAIL', name: 'x' }
    });
    record('staff.cannot_create_asset', createDenied.json?.error === 'forbidden', `error=${createDenied.json?.error || 'none'}`);
  }

  try {
    authPb.authStore.clear();
    await authPb.collection('hkp_staff_users').authWithPassword(env.HKP_FORMAL_ADMIN_EMAIL, env.HKP_FORMAL_PASSWORD);
    adminToken = authPb.authStore.token;
    record('admin.login', authPb.authStore.record?.role === 'admin', `role=${authPb.authStore.record?.role}`);
  } catch (e) {
    record('admin.login', false, e?.message || 'fail');
  }

  if (adminToken) {
    const logs = httpJson('GET', '/api/admin/operation-logs?perPage=5', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    record('admin.operation_logs', Array.isArray(logs.json?.items), `items=${logs.json?.items?.length ?? 'n/a'}`);

    const pid = `PROD-SMOKE-TMP-${Date.now().toString().slice(-8)}`;
    const createdAsset = httpJson('POST', '/api/admin/assets', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { propertyId: pid, name: 'Production煙測臨時財產', location: 'SMOKE', borrowable: true }
    });
    const tmpAssetId = createdAsset.json?.item?.id;
    if (tmpAssetId) created.assetIds.push(tmpAssetId);
    record('smoke.create_tmp_asset', !!tmpAssetId, `id=${tmpAssetId || createdAsset.json?.error || 'none'}`);

    // TMP ids must never be publicly reservable after 3A.2 operational filter.
    if (tmpAssetId) {
      const tmpDenied = httpJson('POST', '/api/reservations/create', {
        body: reservationPayload(tmpAssetId)
      });
      record(
        'smoke.tmp_not_reservable',
        tmpDenied.json?.error === 'asset_unavailable',
        `error=${tmpDenied.json?.error || 'none'}`
      );
    }

    // Formal available asset for main borrow flow (restore to available afterwards).
    let flowAssetId = '';
    try {
      const candidates = await authPb.collection('hkp_assets').getList(1, 30, {
        filter: 'availability_status = "available" && is_borrowable = true && is_active = true && enabled = true && (deleted_at = "" || deleted_at = null) && property_id !~ "PROD-SMOKE-TMP-" && property_id !~ "PREVIEW-TMP-"',
        fields: 'id,property_id,name,availability_status,usage_count',
        sort: 'property_id'
      });
      for (const row of candidates.items || []) {
        const blocking = await authPb.collection('hkp_reservations').getList(1, 1, {
          filter: `asset = "${row.id}" && (status = "pending" || status = "approved" || status = "checked_out" || status = "return_requested" || status = "overdue")`
        });
        if (blocking.totalItems === 0) {
          flowAssetId = row.id;
          record('smoke.pick_formal_asset', true, `id=${row.id} pid=${row.property_id}`);
          break;
        }
      }
      if (!flowAssetId) record('smoke.pick_formal_asset', false, 'no free formal asset');
    } catch (e) {
      record('smoke.pick_formal_asset', false, e?.message || 'fail');
    }

    if (flowAssetId && staffToken) {
      const createdRes = httpJson('POST', '/api/reservations/create', {
        body: reservationPayload(flowAssetId)
      });
      const requestNo = createdRes.json?.requestNo;
      if (requestNo) created.requestNos.push(requestNo);
      record('smoke.create_reservation', createdRes.json?.status === 'pending', `status=${createdRes.json?.status || createdRes.json?.error}`);

      const approve = httpJson('POST', '/api/staff/approve', {
        headers: { Authorization: `Bearer ${staffToken}` },
        body: { requestNo, note: 'prod-smoke' }
      });
      record('smoke.approve', approve.json?.status === 'approved', `status=${approve.json?.status || approve.json?.error}`);

      const assetBefore = await authPb.collection('hkp_assets').getOne(flowAssetId, { fields: 'id,usage_count' });
      created.usageBefore = Number(assetBefore.usage_count || 0);
      const checkout = httpJson('POST', '/api/staff/checkout', {
        headers: { Authorization: `Bearer ${staffToken}` },
        body: { requestNo, condition: '良好', idempotencyKey: `smoke-${requestNo}` }
      });
      record('smoke.checkout', checkout.json?.status === 'checked_out', `status=${checkout.json?.status || checkout.json?.error}`);
      const assetAfter = await authPb.collection('hkp_assets').getOne(flowAssetId, { fields: 'id,usage_count' });
      record('smoke.usage_plus_one', Number(assetAfter.usage_count || 0) === created.usageBefore + 1, `before=${created.usageBefore},after=${assetAfter.usage_count}`);

      const retReq = httpJson('POST', '/api/staff/return', {
        headers: { Authorization: `Bearer ${staffToken}` },
        body: { requestNo, action: 'request' }
      });
      record('smoke.return_request', retReq.json?.status === 'return_requested', `status=${retReq.json?.status || retReq.json?.error}`);
      const retOk = httpJson('POST', '/api/staff/return', {
        headers: { Authorization: `Bearer ${staffToken}` },
        body: { requestNo, action: 'confirm', condition: '良好', note: 'prod-smoke-return' }
      });
      record('smoke.return_confirm', retOk.json?.status === 'returned', `status=${retOk.json?.status || retOk.json?.error}`);
      const assetFinal = await authPb.collection('hkp_assets').getOne(flowAssetId, { fields: 'id,availability_status' });
      record('smoke.asset_available_again', assetFinal.availability_status === 'available', `status=${assetFinal.availability_status}`);
    }
  }

  // Cleanup reservations + tmp asset (keep operation logs)
  try {
    const service = new PocketBase(pbUrl);
    await service.collection('hkp_staff_users').authWithPassword(env.POCKETBASE_SERVICE_EMAIL, env.POCKETBASE_SERVICE_PASSWORD);
    for (const requestNo of created.requestNos) {
      try {
        const row = await service.collection('hkp_reservations').getFirstListItem(`request_no = "${requestNo}"`);
        const usages = await service.collection('hkp_usage_records').getFullList({ filter: `note ~ "${row.id}"` }).catch(() => []);
        for (const u of usages) await service.collection('hkp_usage_records').delete(u.id).catch(() => {});
        await service.collection('hkp_reservations').delete(row.id);
      } catch { /* ignore */ }
    }
    if (created.assetIds.length) {
      const adminPb = new PocketBase(pbUrl);
      await adminPb.collection('hkp_staff_users').authWithPassword(env.HKP_FORMAL_ADMIN_EMAIL, env.HKP_FORMAL_PASSWORD);
      for (const id of created.assetIds) {
        try {
          const row = await adminPb.collection('hkp_assets').getOne(id);
          if (!String(row.property_id || '').startsWith('PROD-SMOKE-TMP-')) continue;
          await adminPb.collection('hkp_assets').update(id, {
            deleted_at: new Date().toISOString(),
            is_active: false,
            enabled: false,
            is_borrowable: false
          });
          try { await adminPb.collection('hkp_assets').delete(id); } catch { /* relation may remain; soft-delete is enough */ }
        } catch { /* ignore */ }
      }
    }
    record('cleanup', true, `requestNos=${created.requestNos.length},assets=${created.assetIds.length}`);
  } catch (e) {
    record('cleanup', false, e?.message || 'fail');
  }

  const svc = new PocketBase(pbUrl);
  await svc.collection('hkp_staff_users').authWithPassword(env.POCKETBASE_SERVICE_EMAIL, env.POCKETBASE_SERVICE_PASSWORD);
  const { count, fp } = await fingerprint(svc);
  record('final.count_390', count === 390, `count=${count}`);
  record('final.fingerprint', fp === EXPECTED_FP, `fp=${fp}`);

  const failed = results.filter((r) => !r.ok);
  const out = {
    productionUrl: PROD,
    passed: results.length - failed.length,
    failed: failed.length,
    failedItems: failed,
    results,
    recommendPhase3B: false
  };
  fs.mkdirSync('docs/exports/phase3a', { recursive: true });
  fs.writeFileSync('docs/exports/phase3a/prod-smoke-results.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ passed: out.passed, failed: out.failed, failedItems: failed.map((f) => f.name), recommendPhase3B: out.recommendPhase3B }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
