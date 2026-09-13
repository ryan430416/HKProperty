import { AVAILABILITY, getItem, listItems } from '../services/inventoryService.js';
import {
  CHECKOUT_METHOD,
  checkin,
  checkout,
  displayLoanStatus,
  isLoanOverdue,
  isOpenLoan,
  lookupSelfServiceLoans,
  overdueDuration,
  verifySelfServiceLoan
} from '../services/loanService.js';
import { displayValue, esc, formatDateTime, toInputDateTime } from './format.js';
import { getProfile } from '../services/authService.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 24;

const state = {
  mode: 'home',
  borrowStep: 1,
  returnStep: 1,
  item: null,
  loan: null,
  lastLoanId: '',
  lastBorrowerId: '',
  submitting: false,
  availableLimit: PAGE_SIZE,
  availableMatches: []
};

let onChanged = () => {};

function show(el, on = true) {
  if (el) el.hidden = !on;
}

function setError(id, message = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
}

function clearErrors(ids) {
  ids.forEach((id) => setError(id, ''));
}

function kv(rows) {
  return rows.map(([k, v]) => `<div><strong>${esc(k)}：</strong>${esc(v)}</div>`).join('');
}

function setBorrowStep(step) {
  state.borrowStep = step;
  document.querySelectorAll('#ssBorrow [data-ss-step]').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.ssStep) <= step);
  });
  show($('ssBorrowStep1'), step === 1);
  show($('ssBorrowForm'), step === 2);
  show($('ssBorrowConfirm'), step === 3);
  show($('ssBorrowSuccess'), step === 4);
}

function setReturnStep(step) {
  state.returnStep = step;
  document.querySelectorAll('#ssReturn [data-ss-step]').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.ssStep) <= Math.min(step, 3));
  });
  show($('ssReturnLookupForm'), step === 1);
  show($('ssReturnPreview'), step === 1.5);
  show($('ssReturnForm'), step === 2);
  show($('ssReturnConfirm'), step === 3);
  show($('ssReturnSuccess'), step === 4);
}

function showHome() {
  state.mode = 'home';
  show($('ssHome'), true);
  show($('ssBorrow'), false);
  show($('ssReturn'), false);
  show($('ssLookup'), false);
}

export function openSelfMode(mode) {
  if (mode === 'home' || !mode) {
    showHome();
    return;
  }
  state.mode = mode;
  show($('ssHome'), false);
  show($('ssBorrow'), mode === 'borrow');
  show($('ssReturn'), mode === 'return');
  show($('ssLookup'), mode === 'lookup');
  if (mode === 'borrow') {
    if (state.borrowStep >= 4) {
      state.borrowStep = 1;
      state.item = null;
    }
    if ((state.borrowStep || 1) === 1) {
      state.availableLimit = PAGE_SIZE;
      renderAvailableBorrowList();
    }
    setBorrowStep(state.borrowStep || 1);
  }
  if (mode === 'return') {
    if (state.returnStep >= 4) {
      state.returnStep = 1;
      state.loan = null;
    }
    setReturnStep(state.returnStep || 1);
  }
  if (mode === 'lookup') {
    show($('ssLookupForm'), true);
    show($('ssLookupResult'), false);
    if (state.lastLoanId) $('ssLookupCode').value = state.lastLoanId;
    if (state.lastBorrowerId) $('ssLookupBorrowerId').value = state.lastBorrowerId;
  }
}

function canStartBorrow(item) {
  if (!item) return { ok: false, message: '找不到可借用物品' };
  if (item.isActive === false) return { ok: false, message: '此財產已停用' };
  if (item.isBorrowable === false) return { ok: false, message: '此財產不可借用' };
  if (item.availabilityStatus === AVAILABILITY.AVAILABLE) return { ok: true, message: '' };
  if (item.availabilityStatus === AVAILABILITY.MAINTENANCE) return { ok: false, message: '此財產維修中，無法辦理借出' };
  if (item.availabilityStatus === AVAILABILITY.LOST) return { ok: false, message: '此財產狀態為異常，無法辦理借出' };
  if (item.availabilityStatus === AVAILABILITY.CHECKED_OUT || item.availabilityStatus === AVAILABILITY.OVERDUE) {
    return { ok: false, message: '此財產目前已借出，不可再次借出' };
  }
  if (item.availabilityStatus === AVAILABILITY.RESERVED || item.availabilityStatus === 'pending') {
    return { ok: false, message: '此財產已有預借或待處理申請' };
  }
  return { ok: false, message: '僅可借用狀態的財產才能辦理借出' };
}

function listAvailableForBorrow() {
  return listItems()
    .filter((item) => item.isActive !== false && item.isBorrowable !== false && item.availabilityStatus === AVAILABILITY.AVAILABLE)
    .sort((a, b) => {
      const byName = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
      if (byName) return byName;
      return String(a.propertyId || '').localeCompare(String(b.propertyId || ''), 'zh-Hant');
    });
}

function filteredAvailableItems() {
  const q = String($('ssBorrowSearch')?.value || '').trim().toLowerCase();
  const location = String($('ssBorrowLocation')?.value || '').trim();
  return listAvailableForBorrow().filter((item) => {
    if (location && item.location !== location) return false;
    if (!q) return true;
    const hay = `${item.name || ''} ${item.location || ''} ${item.propertyId || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function fillBorrowLocationOptions(items) {
  const select = $('ssBorrowLocation');
  if (!select) return;
  const current = select.value;
  const locations = [...new Set(items.map((item) => item.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  select.innerHTML = `<option value="">全部地點</option>${locations.map((loc) => (
    `<option value="${esc(loc)}">${esc(loc)}</option>`
  )).join('')}`;
  if (locations.includes(current)) select.value = current;
}

function renderAvailableBorrowList() {
  const list = $('ssBorrowAvailableList');
  const meta = $('ssBorrowListMeta');
  const moreBtn = $('ssBorrowMoreBtn');
  if (!list || !meta) return;
  const allAvailable = listAvailableForBorrow();
  fillBorrowLocationOptions(allAvailable);
  state.availableMatches = filteredAvailableItems();
  const visible = state.availableMatches.slice(0, state.availableLimit);
  meta.textContent = state.availableMatches.length
    ? `目前可借用 ${state.availableMatches.length} 件${visible.length < state.availableMatches.length ? `，先顯示 ${visible.length} 件` : ''}`
    : '目前沒有符合條件的可借用物品';
  list.innerHTML = visible.length
    ? visible.map((item) => `
      <button type="button" class="ss-available-item" role="listitem" data-borrow-pick="${esc(item.propertyId)}">
        <img src="${esc(item.image)}" alt="">
        <span class="ss-available-body">
          <strong>${esc(item.name)}</strong>
          <span class="muted">${esc(displayValue(item.location))}</span>
          <span class="badge ok">可借用</span>
        </span>
      </button>
    `).join('')
    : `<div class="empty">請調整搜尋條件，或稍後再試</div>`;
  if (moreBtn) {
    moreBtn.hidden = visible.length >= state.availableMatches.length;
  }
}

function selectBorrowItem(propertyId) {
  const item = getItem(propertyId);
  const check = canStartBorrow(item);
  if (!check.ok) {
    toast(check.message, 'error');
    renderAvailableBorrowList();
    return;
  }
  state.item = item;
  fillBorrowDefaults();
  setBorrowStep(2);
}

function readBorrowForm() {
  return {
    propertyId: state.item?.propertyId,
    borrowerName: $('ssBorrowerName').value,
    borrowerId: $('ssBorrowerId').value,
    borrowerDepartment: $('ssBorrowerDept').value,
    purpose: $('ssBorrowPurpose').value,
    checkedOutAt: $('ssBorrowAt').value,
    expectedReturnAt: $('ssBorrowDue').value,
    contact: $('ssBorrowContact').value,
    checkoutCondition: $('ssBorrowCondition').value,
    note: $('ssBorrowNote').value,
    borrowerConfirmed: $('ssBorrowConfirm').checked,
    checkoutMethod: CHECKOUT_METHOD.SELF,
    checkoutOperator: '自助借用'
  };
}

function validateBorrowForm(data) {
  const errors = {};
  if (!data.borrowerName.trim()) errors.ssBorrowerNameError = '請填寫借用人姓名';
  if (!data.borrowerId.trim()) errors.ssBorrowerIdError = '請填寫學號或教職員編號';
  else if (data.borrowerId.trim().length < 4) errors.ssBorrowerIdError = '學號或教職員編號至少 4 個字元';
  if (!data.borrowerDepartment.trim()) errors.ssBorrowerDeptError = '請填寫借用單位、系所或社團';
  if (!data.purpose.trim()) errors.ssBorrowPurposeError = '請填寫借用用途';
  if (!data.checkedOutAt) errors.ssBorrowAtError = '請填寫借出日期與時間';
  if (!data.expectedReturnAt) errors.ssBorrowDueError = '請填寫預計歸還日期與時間';
  if (data.checkedOutAt && data.expectedReturnAt && new Date(data.expectedReturnAt) < new Date(data.checkedOutAt)) {
    errors.ssBorrowDueError = '預計歸還時間不得早於借出時間';
  }
  if (!data.borrowerConfirmed) errors.ssBorrowConfirmError = '請勾選借用人確認';
  return errors;
}

function fillBorrowDefaults() {
  $('ssBorrowFormHint').textContent = `${state.item.name} · ${displayValue(state.item.location)}`;
  const profile = getProfile();
  if (profile) {
    if (!$('ssBorrowerName').value) $('ssBorrowerName').value = profile.display_name || '';
    if (!$('ssBorrowerId').value) $('ssBorrowerId').value = profile.school_number || '';
    if (!$('ssBorrowerDept').value) $('ssBorrowerDept').value = profile.department || '';
  }
  if (!$('ssBorrowAt').value) $('ssBorrowAt').value = toInputDateTime();
  if (!$('ssBorrowDue').value) {
    const due = new Date();
    due.setDate(due.getDate() + 1);
    $('ssBorrowDue').value = toInputDateTime(due);
  }
}

function showBorrowConfirm(data) {
  $('ssBorrowSummary').innerHTML = kv([
    ['物品名稱', state.item.name],
    ['財產編號', state.item.propertyId],
    ['借用人', data.borrowerName],
    ['借用單位', data.borrowerDepartment],
    ['借用用途', data.purpose],
    ['借出時間', formatDateTime(new Date(data.checkedOutAt).toISOString())],
    ['預計歸還時間', formatDateTime(new Date(data.expectedReturnAt).toISOString())]
  ]);
}

async function submitBorrow() {
  if (state.submitting) return;
  const btn = $('ssBorrowSubmitBtn');
  state.submitting = true;
  btn.disabled = true;
  btn.textContent = '處理中';
  try {
    const data = readBorrowForm();
    const result = await checkout(data);
    state.lastLoanId = result.entry.id;
    state.lastBorrowerId = result.entry.borrowerId;
    $('ssBorrowSuccessBody').innerHTML = `
      <div class="ss-loan-id">${esc(result.entry.id)}</div>
      ${kv([
        ['物品名稱', result.item.name],
        ['財產編號', result.item.propertyId],
        ['借用人', result.entry.borrowerName],
        ['預計歸還時間', formatDateTime(result.entry.expectedReturnAt)]
      ])}
    `;
    setBorrowStep(4);
    await onChanged();
    toast(result.entry.rawStatus === 'pending' ? '已送出借用申請，請等待管理者核准' : '借用成功，請保存借用編號');
  } catch (error) {
    toast(error.message || '借出失敗', 'error');
  } finally {
    state.submitting = false;
    btn.disabled = false;
    btn.textContent = '確認借出';
  }
}

function showReturnPreview(loan, item) {
  $('ssReturnPreviewBody').innerHTML = kv([
    ['物品名稱', item.name],
    ['財產編號', item.propertyId],
    ['借用人姓名', loan.borrowerName],
    ['借出時間', formatDateTime(loan.checkedOutAt)],
    ['預計歸還時間', formatDateTime(loan.expectedReturnAt)],
    ['是否逾期', isLoanOverdue(loan) ? (overdueDuration(loan) || '已逾期') : '否'],
    ['借用用途', loan.purpose]
  ]);
}

function selectedReturnResult() {
  return document.querySelector('input[name="ssReturnResult"]:checked')?.value || '';
}

function updateIssueRequired() {
  const result = selectedReturnResult();
  const required = result && result !== '正常';
  $('ssReturnIssueReq').hidden = !required;
}

function readReturnForm() {
  return {
    loanId: state.loan?.id,
    propertyId: state.loan?.propertyId,
    returnedAt: $('ssReturnAt').value,
    returnLocation: $('ssReturnLocation').value,
    returnResult: selectedReturnResult(),
    issueNote: $('ssReturnIssue').value,
    note: $('ssReturnNote').value,
    returnConfirmed: $('ssReturnConfirm').checked,
    selfService: true
  };
}

function validateReturnForm(data) {
  const errors = {};
  if (!data.returnedAt) errors.ssReturnAtError = '請填寫實際歸還時間';
  if (!data.returnLocation.trim()) errors.ssReturnLocationError = '請填寫歸還後存放地點';
  if (!data.returnResult) errors.ssReturnResultError = '請選擇物品歸還狀況';
  if (data.returnResult && data.returnResult !== '正常' && !data.issueNote.trim()) {
    errors.ssReturnIssueError = '請填寫問題說明';
  }
  if (!data.returnConfirmed) errors.ssReturnConfirmError = '請勾選歸還人確認';
  return errors;
}

async function submitReturn() {
  if (state.submitting) return;
  const btn = $('ssReturnSubmitBtn');
  state.submitting = true;
  btn.disabled = true;
  btn.textContent = '處理中';
  try {
    const data = readReturnForm();
    const result = await checkin(data);
    $('ssReturnSuccessBody').innerHTML = kv([
      ['物品名稱', result.item.name],
      ['財產編號', result.item.propertyId],
      ['借用編號', result.entry.id],
      ['實際歸還時間', formatDateTime(result.entry.returnedAt)],
      ['歸還後存放地點', result.entry.returnLocation],
      ['物品狀況', result.entry.returnResult],
      ['目前狀態', result.item.availabilityLabel]
    ]);
    state.loan = null;
    setReturnStep(4);
    await onChanged();
    toast('歸還成功');
  } catch (error) {
    toast(error.message || '歸還失敗', 'error');
  } finally {
    state.submitting = false;
    btn.disabled = false;
    btn.textContent = '確認歸還';
  }
}

function renderLookupRows(rows) {
  $('ssLookupResultBody').innerHTML = rows.map((loan) => {
    const overdue = isLoanOverdue(loan);
    return `
      <article class="lookup-card">
        <div><strong>借用編號</strong> <span class="pid">${esc(loan.id)}</span></div>
        <div><strong>財產名稱</strong> ${esc(loan.propertyName)}</div>
        <div><strong>財產編號</strong> ${esc(loan.propertyId)}</div>
        <div><strong>借出時間</strong> ${esc(formatDateTime(loan.checkedOutAt))}</div>
        <div><strong>預計歸還時間</strong> ${esc(formatDateTime(loan.expectedReturnAt))}</div>
        <div><strong>實際歸還時間</strong> ${esc(loan.returnedAt ? formatDateTime(loan.returnedAt) : '尚未歸還')}</div>
        <div><strong>借用狀態</strong> <span class="badge ${overdue ? 'alert' : isOpenLoan(loan) ? 'loan' : 'ok'}">${esc(displayLoanStatus(loan))}</span></div>
        <div><strong>是否逾期</strong> ${esc(overdue ? (overdueDuration(loan) || '是') : '否')}</div>
        ${isOpenLoan(loan) ? `<button type="button" class="primary" data-ss-return-loan="${esc(loan.id)}">辦理歸還</button>` : ''}
      </article>
    `;
  }).join('');
}

async function startReturnFromLoan(code, borrowerId) {
  $('ssReturnCode').value = code;
  $('ssReturnBorrowerId').value = borrowerId;
  openSelfMode('return');
  try {
    const { loan, item } = await verifySelfServiceLoan(code, borrowerId);
    state.loan = loan;
    state.item = item;
    showReturnPreview(loan, item);
    setReturnStep(1.5);
  } catch (error) {
    setReturnStep(1);
    toast(error.message || '查無符合的借用資料', 'error');
  }
}

export function bindSelfService(handlers = {}) {
  onChanged = handlers.onChanged || onChanged;

  $('ssBorrowBackToItem').addEventListener('click', () => {
    state.availableLimit = PAGE_SIZE;
    setBorrowStep(1);
    renderAvailableBorrowList();
  });
  $('ssBorrowSearch')?.addEventListener('input', () => {
    state.availableLimit = PAGE_SIZE;
    renderAvailableBorrowList();
  });
  $('ssBorrowLocation')?.addEventListener('change', () => {
    state.availableLimit = PAGE_SIZE;
    renderAvailableBorrowList();
  });
  $('ssBorrowMoreBtn')?.addEventListener('click', () => {
    state.availableLimit += PAGE_SIZE;
    renderAvailableBorrowList();
  });
  $('ssBorrowAvailableList')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-borrow-pick]');
    if (!btn) return;
    selectBorrowItem(btn.dataset.borrowPick);
  });
  $('ssBorrowForm').addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors([
      'ssBorrowerNameError', 'ssBorrowerIdError', 'ssBorrowerDeptError', 'ssBorrowPurposeError',
      'ssBorrowAtError', 'ssBorrowDueError', 'ssBorrowConfirmError'
    ]);
    const data = readBorrowForm();
    const errors = validateBorrowForm(data);
    const keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach((id) => setError(id, errors[id]));
      toast(errors[keys[0]], 'error');
      return;
    }
    showBorrowConfirm(data);
    setBorrowStep(3);
  });
  $('ssBorrowEditBtn').addEventListener('click', () => setBorrowStep(2));
  $('ssBorrowSubmitBtn').addEventListener('click', submitBorrow);
  $('ssCopyLoanIdBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.lastLoanId);
      toast('已複製借用編號');
    } catch {
      toast('請手動複製借用編號', 'error');
    }
  });
  $('ssBorrowViewStatusBtn').addEventListener('click', () => openSelfMode('lookup'));

  $('ssReturnLookupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(['ssReturnCodeError', 'ssReturnBorrowerIdError']);
    try {
      const { loan, item } = await verifySelfServiceLoan($('ssReturnCode').value, $('ssReturnBorrowerId').value);
      state.loan = loan;
      state.item = item;
      showReturnPreview(loan, item);
      setReturnStep(1.5);
    } catch (error) {
      const message = error.message || '查無符合的借用資料';
      if (message.includes('學號')) setError('ssReturnBorrowerIdError', message);
      else setError('ssReturnCodeError', message);
      toast(message, 'error');
    }
  });
  $('ssReturnBackLookup').addEventListener('click', () => setReturnStep(1));
  $('ssReturnFillBtn').addEventListener('click', () => {
    if (!$('ssReturnAt').value) $('ssReturnAt').value = toInputDateTime();
    if (!$('ssReturnLocation').value) $('ssReturnLocation').value = state.item?.location || '';
    setReturnStep(2);
  });
  $('ssReturnForm').addEventListener('change', updateIssueRequired);
  $('ssReturnBackPreview').addEventListener('click', () => setReturnStep(1.5));
  $('ssReturnForm').addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(['ssReturnAtError', 'ssReturnLocationError', 'ssReturnResultError', 'ssReturnIssueError', 'ssReturnConfirmError']);
    const data = readReturnForm();
    const errors = validateReturnForm(data);
    const keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach((id) => setError(id, errors[id]));
      toast(errors[keys[0]], 'error');
      return;
    }
    $('ssReturnSummary').innerHTML = kv([
      ['物品名稱', state.item.name],
      ['財產編號', state.item.propertyId],
      ['借用編號', state.loan.id],
      ['借用人', state.loan.borrowerName],
      ['實際歸還時間', formatDateTime(new Date(data.returnedAt).toISOString())],
      ['歸還後存放地點', data.returnLocation],
      ['物品歸還狀況', data.returnResult],
      ['問題說明', data.issueNote || '無']
    ]);
    setReturnStep(3);
  });
  $('ssReturnEditBtn').addEventListener('click', () => setReturnStep(2));
  $('ssReturnSubmitBtn').addEventListener('click', submitReturn);

  $('ssLookupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(['ssLookupCodeError', 'ssLookupBorrowerIdError']);
    try {
      const rows = await lookupSelfServiceLoans($('ssLookupCode').value, $('ssLookupBorrowerId').value);
      state.lastLoanId = $('ssLookupCode').value.trim();
      state.lastBorrowerId = $('ssLookupBorrowerId').value.trim();
      renderLookupRows(rows);
      show($('ssLookupForm'), false);
      show($('ssLookupResult'), true);
    } catch (error) {
      const message = error.message || '查無符合的借用資料';
      if (message.includes('學號')) setError('ssLookupBorrowerIdError', message);
      else setError('ssLookupCodeError', message);
      toast(message, 'error');
    }
  });
  $('ssLookupAgainBtn').addEventListener('click', () => {
    show($('ssLookupResult'), false);
    show($('ssLookupForm'), true);
  });
  $('ssLookupResult').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-ss-return-loan]');
    if (!btn) return;
    startReturnFromLoan(btn.dataset.ssReturnLoan, $('ssLookupBorrowerId').value);
  });
}

export { showHome };
