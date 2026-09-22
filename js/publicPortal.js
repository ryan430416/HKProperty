import { startCameraScan, stopCameraScan } from './scanner.js';
import { categoryIcon } from './format.js';
import { FEATURES } from '../shared/features.js';
import { PRIVACY_NOTICE, collapse, validateName, validatePhone, validateUnit } from '../services/privacy.js';
import {
  cancelReservationApi,
  createReservation,
  listPublicAssets,
  lookupReservation
} from '../services/v2Api.js';

let selected = null;
let cameraOn = false;
let submitting = false;
let searchTimer = 0;
let currentPage = 1;
const failWindow = { count: 0, at: 0 };

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function showMessage(text, kind = '') {
  const el = $('portalMessage');
  if (!el) return;
  el.hidden = !text;
  el.dataset.kind = kind;
  el.textContent = text || '';
}

function noteFail() {
  const now = Date.now();
  if (now - failWindow.at > 10 * 60 * 1000) {
    failWindow.count = 0;
    failWindow.at = now;
  }
  failWindow.count += 1;
  failWindow.at = now;
}

function tooManyFails() {
  const now = Date.now();
  if (now - failWindow.at > 10 * 60 * 1000) {
    failWindow.count = 0;
    failWindow.at = now;
  }
  return failWindow.count >= 8;
}

function clearFieldErrors() {
  ['portalUnit', 'portalName', 'portalPhone'].forEach((id) => {
    const input = $(id);
    const err = $(`${id}Error`);
    if (input) input.removeAttribute('aria-invalid');
    if (err) err.textContent = '';
  });
}

function setFieldError(id, message) {
  const input = $(id);
  const err = $(`${id}Error`);
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (err) err.textContent = message || '';
}

function validatePortalPerson() {
  clearFieldErrors();
  const checks = [
    ['portalUnit', validateUnit($('portalUnit')?.value)],
    ['portalName', validateName($('portalName')?.value)],
    ['portalPhone', validatePhone($('portalPhone')?.value)]
  ];
  let first = null;
  for (const [id, message] of checks) {
    if (message) {
      setFieldError(id, message);
      if (!first) first = $(id);
    }
  }
  if (first) {
    first.focus({ preventScroll: false });
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return false;
  }
  return true;
}

function setStep(name) {
  document.querySelectorAll('[data-portal-step]').forEach((el) => {
    el.hidden = el.dataset.portalStep !== name;
  });
  if (name !== 'scan') stopPortalCamera();
}

export function showPublicPortal() {
  const portal = $('publicPortal');
  const app = document.querySelector('.app');
  if (portal) portal.hidden = false;
  if (app) app.hidden = true;
  document.body.classList.add('public-mode');
  setStep('home');
  showMessage('');
}

export function hidePublicPortal() {
  const portal = $('publicPortal');
  const app = document.querySelector('.app');
  if (portal) portal.hidden = true;
  if (app) app.hidden = false;
  document.body.classList.remove('public-mode');
  stopPortalCamera();
}

function showSkeleton() {
  const list = $('portalResults');
  if (!list) return;
  list.innerHTML = Array.from({ length: 4 }, () => `
    <article class="portal-card portal-skeleton" aria-hidden="true">
      <div class="asset-glyph"></div>
      <div class="portal-card-body">
        <div class="sk-line"></div>
        <div class="sk-line short"></div>
        <div class="sk-line mid"></div>
      </div>
    </article>
  `).join('');
  if ($('portalResultMeta')) $('portalResultMeta').textContent = '財產資料載入中…';
  if ($('portalPager')) $('portalPager').innerHTML = '';
}

function showLoadError(message) {
  const list = $('portalResults');
  if (!list) return;
  list.innerHTML = `
    <div class="portal-empty">
      <p>${esc(message || '無法載入財產資料')}</p>
      <button type="button" class="primary" id="portalReloadBtn">重新載入</button>
    </div>
  `;
  if ($('portalResultMeta')) $('portalResultMeta').textContent = '';
  if ($('portalPager')) $('portalPager').innerHTML = '';
  $('portalReloadBtn')?.addEventListener('click', () => loadAssets(currentPage));
}

function renderAssets(payload) {
  const list = $('portalResults');
  if (!list) return;
  const items = payload.items || [];
  if (!items.length) {
    list.innerHTML = '<div class="portal-empty"><p>目前沒有符合條件的財產。</p></div>';
    if ($('portalResultMeta')) $('portalResultMeta').textContent = '共 0 筆';
    if ($('portalPager')) $('portalPager').innerHTML = '';
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="portal-card">
      ${categoryIcon(item.name)}
      <div class="portal-card-body">
        <strong class="portal-name">${esc(item.name)}</strong>
        <p class="pid">${esc(item.propertyId)}</p>
        <p class="portal-meta">${esc(item.availabilityLabel)} · ${esc(item.location || '未填位置')}</p>
        <div class="portal-actions">
          <button type="button" class="primary" data-pick="${esc(item.id)}" ${item.available ? '' : 'disabled'}>預借</button>
        </div>
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = items.find((item) => item.id === btn.dataset.pick) || null;
      openForm();
    });
  });
  if ($('portalResultMeta')) {
    $('portalResultMeta').textContent = `共 ${payload.totalItems} 筆，第 ${payload.page} / ${payload.totalPages} 頁`;
  }
  const pager = $('portalPager');
  if (!pager) return;
  pager.innerHTML = `
    <button type="button" class="secondary" id="portalPrevPage" ${payload.page <= 1 ? 'disabled' : ''}>上一頁</button>
    <button type="button" class="secondary" id="portalNextPage" ${payload.page >= payload.totalPages ? 'disabled' : ''}>下一頁</button>
  `;
  $('portalPrevPage')?.addEventListener('click', () => loadAssets(payload.page - 1));
  $('portalNextPage')?.addEventListener('click', () => loadAssets(payload.page + 1));
}

async function loadAssets(page = 1) {
  currentPage = Math.max(1, page);
  showMessage('');
  showSkeleton();
  try {
    const payload = await listPublicAssets({
      q: $('portalQuery')?.value || '',
      location: $('portalLocationFilter')?.value || '',
      available: ($('portalAvailFilter')?.value || 'available') !== 'unavailable',
      page: currentPage,
      perPage: 12
    });
    renderAssets(payload);
  } catch (error) {
    const msg = error.code === 'service_unavailable'
      ? '公開服務尚未設定完成，請稍後再試'
      : (error.message || '無法載入財產資料');
    showLoadError(msg);
  }
}

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => loadAssets(1), 280);
}

function openSearch(presetQuery = '') {
  selected = null;
  if ($('portalSearchTitle')) $('portalSearchTitle').textContent = '選擇要預借的財產';
  if (presetQuery && $('portalQuery')) $('portalQuery').value = presetQuery;
  setStep('search');
  loadAssets(1);
}

function openForm() {
  clearFieldErrors();
  showMessage('');
  if ($('portalFormTitle')) $('portalFormTitle').textContent = '預借申請';
  if ($('portalPrivacyText')) $('portalPrivacyText').textContent = PRIVACY_NOTICE;
  if ($('portalAssetBox')) $('portalAssetBox').hidden = !selected;
  if ($('portalReserveFields')) $('portalReserveFields').hidden = false;
  if ($('portalBorrowFields')) $('portalBorrowFields').hidden = true;
  if ($('portalReturnFields')) $('portalReturnFields').hidden = true;
  if ($('portalUnitWrap')) $('portalUnitWrap').hidden = false;
  if ($('portalPrivacyWrap')) $('portalPrivacyWrap').hidden = false;
  if (selected && $('portalAssetBox')) {
    $('portalAssetBox').innerHTML = `${categoryIcon(selected.name)} <span><strong class="portal-name">${esc(selected.name)}</strong><br><span class="pid">${esc(selected.propertyId)}</span> · ${esc(selected.location || '未填位置')}</span>`;
  }
  setStep('form');
}

async function stopPortalCamera() {
  cameraOn = false;
  await stopCameraScan();
  if ($('portalCamera')) $('portalCamera').hidden = true;
  if ($('portalStopCamera')) $('portalStopCamera').hidden = true;
}

async function startPortalCamera() {
  if (!FEATURES.qrScanner) {
    showMessage('相機掃描功能暫緩開放，請改以搜尋或手動輸入財產編號', 'error');
    return;
  }
  showMessage('');
  $('portalCamera').hidden = false;
  $('portalStopCamera').hidden = false;
  cameraOn = true;
  try {
    await startCameraScan({
      videoEl: $('portalCameraVideo'),
      fallbackContainerId: 'portalCameraFallback',
      onDetected: async (propertyId) => {
        await stopPortalCamera();
        openSearch(propertyId);
      }
    });
  } catch (error) {
    await stopPortalCamera();
    showMessage(error.message || '無法開啟相機，請改用手動輸入財產編號', 'error');
  }
}

function showIssued(result) {
  setStep('issued');
  if ($('issuedNumber')) $('issuedNumber').textContent = result.requestNo;
  if ($('issuedToken')) $('issuedToken').textContent = result.verificationCode;
  $('portalForm')?.reset();
  clearFieldErrors();
  selected = null;
}

export function bindPublicPortal(onStaffLogin) {
  $('staffLoginOpen')?.addEventListener('click', onStaffLogin);
  $('portalHomeReserve')?.addEventListener('click', () => openSearch());
  $('portalHomeBorrow')?.addEventListener('click', () => openSearch());
  $('portalManageOpen')?.addEventListener('click', () => { showMessage(''); setStep('manage'); });
  $('portalManageBack')?.addEventListener('click', () => { showMessage(''); setStep('home'); });
  if (FEATURES.qrScanner) {
    $('portalScanBtn')?.addEventListener('click', () => { showMessage(''); setStep('scan'); });
    $('portalStartCamera')?.addEventListener('click', () => startPortalCamera());
  } else if ($('portalScanBtn')) {
    $('portalScanBtn').hidden = true;
    $('portalScanBtn').setAttribute('aria-hidden', 'true');
  }
  $('portalScanBack')?.addEventListener('click', async () => { await stopPortalCamera(); showMessage(''); setStep('home'); });
  $('portalStopCamera')?.addEventListener('click', () => stopPortalCamera());
  $('portalManualScanForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = collapse($('portalManualCode')?.value);
    if (!code) {
      showMessage('請輸入財產編號', 'error');
      return;
    }
    await stopPortalCamera();
    openSearch(code);
  });
  $('portalFilterForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadAssets(1);
  });
  $('portalClearFilters')?.addEventListener('click', () => {
    if ($('portalQuery')) $('portalQuery').value = '';
    if ($('portalLocationFilter')) $('portalLocationFilter').value = '';
    if ($('portalAvailFilter')) $('portalAvailFilter').value = 'available';
    loadAssets(1);
  });
  $('portalQuery')?.addEventListener('input', scheduleSearch);
  $('portalLocationFilter')?.addEventListener('change', () => loadAssets(1));
  $('portalAvailFilter')?.addEventListener('change', () => loadAssets(1));
  $('portalBack')?.addEventListener('click', () => { showMessage(''); setStep('home'); });
  $('portalFormBack')?.addEventListener('click', () => { showMessage(''); setStep('search'); });
  $('portalForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const btn = $('portalSubmit');
    if (!validatePortalPerson()) return;
    if (!selected?.id) {
      showMessage('請先選擇財產', 'error');
      return;
    }
    if (!$('portalPrivacy')?.checked) {
      showMessage('請先勾選個資使用告知', 'error');
      return;
    }
    submitting = true;
    if (btn) btn.disabled = true;
    showMessage('');
    try {
      const result = await createReservation({
        assetId: selected.id,
        unit: $('portalUnit').value,
        name: $('portalName').value,
        phone: $('portalPhone').value,
        purpose: $('portalReservePurpose')?.value || $('portalPurpose')?.value,
        borrowDate: $('portalStart')?.value,
        expectedReturnDate: $('portalEnd')?.value,
        privacyAck: true,
        notes: $('portalNote')?.value || ''
      });
      showIssued(result);
    } catch (error) {
      const map = {
        asset_unavailable: '此財產目前不可預借',
        asset_already_reserved: '此財產已有進行中的預借',
        dates_required: '請填寫預計借用與歸還日期',
        return_before_borrow: '歸還日期必須晚於借用日期',
        purpose_required: '請填寫借用用途',
        privacy_required: '請勾選個資使用告知',
        service_unavailable: '公開服務尚未設定完成'
      };
      showMessage(map[error.code] || error.message || '送出失敗', 'error');
    } finally {
      submitting = false;
      if (btn) btn.disabled = false;
    }
  });
  $('portalDone')?.addEventListener('click', () => { showMessage(''); setStep('home'); });
  $('portalLookupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (tooManyFails()) {
      showMessage('嘗試次數過多，請稍後再試。', 'error');
      return;
    }
    const btn = $('lookupSubmit');
    if (btn) btn.disabled = true;
    try {
      const data = await lookupReservation($('lookupNumber')?.value, $('lookupToken')?.value);
      showMessage(`申請 ${data.requestNo} 狀態：${data.statusLabel || data.status}`, 'ok');
    } catch {
      noteFail();
      showMessage('查詢失敗，請確認申請編號與驗證碼。', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $('portalCancelForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (tooManyFails()) {
      showMessage('嘗試次數過多，請稍後再試。', 'error');
      return;
    }
    const btn = $('cancelSubmit');
    if (btn) btn.disabled = true;
    try {
      await cancelReservationApi($('cancelNumber')?.value, $('cancelToken')?.value);
      showMessage('尚未核准的預借已取消。', 'ok');
    } catch {
      noteFail();
      showMessage('取消失敗，請確認申請編號與驗證碼，且狀態仍為等待確認。', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

export function openPortalFromScan(code) {
  showPublicPortal();
  openSearch(collapse(code));
}
