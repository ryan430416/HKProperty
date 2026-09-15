import { startCameraScan, stopCameraScan, parseScanPayload } from './scanner.js';
import { categoryIcon } from './format.js';
import { PRIVACY_NOTICE, collapse, validateName, validatePhone, validateUnit } from '../services/privacy.js';
import {
  cancelReservation,
  listGuestAssets,
  lookupBorrow,
  submitBorrow,
  submitReservation,
  submitReturn
} from '../services/publicBorrow.js';

const MODE_LABEL = {
  reserve: '我要預借',
  borrow: '我要借用',
  return: '我要歸還',
  lookup: '查詢申請'
};

let mode = 'search';
let selected = null;
let cameraOn = false;
let submitting = false;
let searchTimer = 0;

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

function validatePortalPerson({ requireUnit = true } = {}) {
  clearFieldErrors();
  const checks = [];
  if (requireUnit) checks.push(['portalUnit', validateUnit($('portalUnit')?.value)]);
  checks.push(['portalName', validateName($('portalName')?.value)]);
  checks.push(['portalPhone', validatePhone($('portalPhone')?.value)]);
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

function renderAssets(items) {
  const list = $('portalResults');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<p class="muted">找不到可顯示的財產。</p>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="portal-card">
      ${categoryIcon(item.name, item.specification)}
      <div class="portal-card-body">
        <strong class="portal-name">${esc(item.name)}</strong>
        <p class="pid">${esc(item.propertyId)}</p>
        <p class="portal-meta">${item.available ? '可借用' : '目前不可借用'} · ${esc(item.location || '未填位置')}</p>
        <div class="portal-actions">
          <button type="button" class="secondary" data-pick="${esc(item.id)}" data-mode="reserve" ${item.available ? '' : 'disabled'}>預借</button>
          <button type="button" class="primary" data-pick="${esc(item.id)}" data-mode="borrow" ${item.available ? '' : 'disabled'}>借用</button>
        </div>
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = items.find((item) => item.id === btn.dataset.pick) || null;
      openForm(btn.dataset.mode);
    });
  });
}

async function search(query) {
  showMessage('');
  try {
    const items = await listGuestAssets(query);
    renderAssets(items);
  } catch (error) {
    $('portalResults').innerHTML = '';
    showMessage(error.message || '無法搜尋財產', 'error');
  }
}

function scheduleSearch(query) {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => search(query), 280);
}

function openForm(next) {
  mode = next;
  clearFieldErrors();
  showMessage('');
  $('portalFormTitle').textContent = MODE_LABEL[next] || '借用';
  $('portalPrivacyText').textContent = PRIVACY_NOTICE;
  const reserve = next === 'reserve';
  const borrow = next === 'borrow';
  const returning = next === 'return' || next === 'lookup';
  $('portalAssetBox').hidden = returning || !selected;
  $('portalReserveFields').hidden = !reserve;
  $('portalBorrowFields').hidden = !borrow;
  $('portalReturnFields').hidden = !returning;
  $('portalUnitWrap').hidden = next === 'lookup';
  $('portalPrivacyWrap').hidden = returning;
  if ($('portalReturnCondition')) $('portalReturnCondition').closest('.field').hidden = next !== 'return';
  if (selected && !returning) {
    $('portalAssetBox').innerHTML = `${categoryIcon(selected.name)} <span><strong class="portal-name">${esc(selected.name)}</strong><br><span class="pid">${esc(selected.propertyId)}</span> · ${esc(selected.location || '未填位置')}</span>`;
  }
  setStep('form');
}

async function stopPortalCamera() {
  if (!cameraOn) return;
  cameraOn = false;
  await stopCameraScan();
  if ($('portalCamera')) $('portalCamera').hidden = true;
}

export function bindPublicPortal(onStaffLogin) {
  $('staffLoginOpen')?.addEventListener('click', onStaffLogin);
  $('portalHomeBorrow')?.addEventListener('click', () => { mode = 'search'; setStep('search'); search(''); });
  $('portalHomeReserve')?.addEventListener('click', () => { mode = 'search'; setStep('search'); search(''); });
  $('portalHomeReturn')?.addEventListener('click', () => openForm('return'));
  $('portalScanBtn')?.addEventListener('click', async () => {
    setStep('home');
    $('portalCamera').hidden = false;
    cameraOn = true;
    try {
      await startCameraScan($('portalCameraVideo'), async (raw) => {
        const code = parseScanPayload(raw);
        await stopPortalCamera();
        $('portalQuery').value = code;
        setStep('search');
        await search(code);
      });
    } catch (error) {
      await stopPortalCamera();
      showMessage(error.message || '無法開啟相機，請改用財產編號搜尋', 'error');
    }
  });
  $('portalSearchForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    setStep('search');
    search($('portalQuery').value);
  });
  $('portalQuery')?.addEventListener('input', () => {
    if (document.querySelector('[data-portal-step="search"]')?.hidden === false) {
      scheduleSearch($('portalQuery').value);
    }
  });
  $('portalBack')?.addEventListener('click', () => { showMessage(''); setStep('home'); });
  $('portalFormBack')?.addEventListener('click', () => { showMessage(''); setStep(mode === 'return' || mode === 'lookup' ? 'home' : 'search'); });
  $('portalForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const btn = $('portalSubmit');
    const requireUnit = mode !== 'lookup';
    if (!validatePortalPerson({ requireUnit })) return;
    if ((mode === 'borrow' || mode === 'reserve') && !selected?.id) {
      showMessage('請先選擇財產', 'error');
      return;
    }
    submitting = true;
    btn.disabled = true;
    showMessage('');
    const common = {
      unit: $('portalUnit').value,
      name: $('portalName').value,
      phone: $('portalPhone').value,
      privacyAck: $('portalPrivacy').checked,
      notes: $('portalNote').value
    };
    try {
      if (mode === 'borrow') {
        const result = await submitBorrow({
          ...common,
          assetId: selected?.id,
          purpose: $('portalPurpose').value,
          expectedReturnAt: $('portalReturnAt').value,
          condition: $('portalCondition').value
        });
        showIssued(result);
      } else if (mode === 'reserve') {
        const result = await submitReservation({
          ...common,
          assetId: selected?.id,
          purpose: $('portalReservePurpose').value,
          startAt: $('portalStart').value,
          endAt: $('portalEnd').value
        });
        showIssued(result);
      } else if (mode === 'lookup') {
        const data = await lookupBorrow({
          requestNumber: $('portalRequestNumber').value,
          token: $('portalToken').value,
          name: common.name,
          phone: common.phone
        });
        showMessage(`申請 ${data.requestNumber} 狀態：${data.status}。電話 ${data.phoneMasked || ''}`);
      } else {
        await submitReturn({
          ...common,
          requestNumber: $('portalRequestNumber').value,
          token: $('portalToken').value,
          propertyId: $('portalReturnProperty').value,
          condition: $('portalReturnCondition').value
        });
        showMessage('歸還申請已送出，請等待經辦人員確認。', 'ok');
        $('portalForm').reset();
        clearFieldErrors();
      }
    } catch (error) {
      showMessage(error.message || '送出失敗', 'error');
    } finally {
      submitting = false;
      btn.disabled = false;
    }
  });
  $('portalLookupBtn')?.addEventListener('click', () => openForm('lookup'));
  $('portalDone')?.addEventListener('click', () => { showMessage(''); setStep('home'); });
  $('portalCancelForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await cancelReservation({
        requestNumber: $('cancelNumber').value,
        token: $('cancelToken').value,
        name: $('cancelName').value,
        phone: $('cancelPhone').value
      });
      showMessage('尚未核准的預借已取消。', 'ok');
    } catch (error) {
      showMessage(error.message || '取消失敗', 'error');
    }
  });
}

function showIssued(result) {
  setStep('issued');
  $('issuedNumber').textContent = result.requestNumber;
  $('issuedToken').textContent = result.token;
  $('portalForm').reset();
  clearFieldErrors();
  selected = null;
}

export function openPortalFromScan(code) {
  showPublicPortal();
  $('portalQuery').value = collapse(code);
  setStep('search');
  search(code);
}
