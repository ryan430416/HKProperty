let toastTimer = 0;
let switching = false;

export function toast(message, type = 'ok') {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2800);
}

export function isSwitchingDialogs() {
  return switching;
}

export function syncBodyScrollLock() {
  const anyOpen = Boolean(document.querySelector('dialog[open]'));
  document.body.classList.toggle('modal-open', anyOpen);
}

function focusable(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

function focusFirst(dialog) {
  const list = focusable(dialog);
  const target = list.find((el) => el.tagName !== 'BUTTON' || el.type === 'submit') || list[0];
  target?.focus();
}

function trapTab(event, dialog) {
  if (event.key !== 'Tab' || !dialog.open) return;
  const list = focusable(dialog);
  if (!list.length) {
    event.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

export function closeDialog(id, { silent = false } = {}) {
  const dialog = document.getElementById(id);
  if (!dialog?.open) {
    syncBodyScrollLock();
    return;
  }
  switching = silent;
  dialog.close();
  switching = false;
  syncBodyScrollLock();
}

export function closeAllDialogs({ silent = true } = {}) {
  switching = silent;
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  switching = false;
  syncBodyScrollLock();
}

export function openDialog(id) {
  openExclusiveDialog(id);
}

export function openExclusiveDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  switching = true;
  document.querySelectorAll('dialog[open]').forEach((open) => {
    if (open !== dialog) open.close();
  });
  if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  switching = false;
  syncBodyScrollLock();
  queueMicrotask(() => focusFirst(dialog));
}

export function closeTopDialog() {
  const openDialogs = [...document.querySelectorAll('dialog[open]')];
  const top = openDialogs.at(-1);
  top?.close();
  syncBodyScrollLock();
  return Boolean(top);
}

export function bindDialogBehavior(onClosed) {
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('cancel', () => {
      /* native ESC still closes; restore is handled on close */
    });
    dialog.addEventListener('close', () => {
      syncBodyScrollLock();
      if (!switching) onClosed?.(dialog.id);
    });
    dialog.addEventListener('keydown', (event) => trapTab(event, dialog));
  });
}

export function setLoading(on, text = '資料載入中…') {
  const el = document.querySelector('#loading');
  if (!el) return;
  el.hidden = !on;
  const label = el.querySelector('p');
  if (label) label.textContent = text;
}

export function fillSelect(select, blankLabel, values, current = '') {
  if (!select) return;
  if (!Array.isArray(values)) {
    throw new Error(`fillSelect 需要陣列，實際收到：${values === undefined ? 'undefined' : typeof values}（label=${blankLabel}）`);
  }
  const options = [`<option value="">${blankLabel}</option>`]
    .concat(values.map((value) => `<option value="${escapeAttr(value)}">${escapeAttr(value)}</option>`));
  select.innerHTML = options.join('');
  if (values.includes(current)) select.value = current;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

let confirmResolver = null;

function settleConfirm(ok) {
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(ok);
}

export function bindConfirmDialog() {
  const form = document.getElementById('appConfirmForm');
  const dialog = document.getElementById('appConfirmDialog');
  if (!form || !dialog) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    closeDialog('appConfirmDialog', { silent: true });
    settleConfirm(true);
  });
  form.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => {
    closeDialog('appConfirmDialog', { silent: true });
    settleConfirm(false);
  });
  dialog.addEventListener('close', () => {
    if (confirmResolver) settleConfirm(false);
  });
}

export function confirmAction({
  title = '請確認',
  text = '',
  confirmLabel = '確認',
  cancelLabel = '取消'
} = {}) {
  const dialog = document.getElementById('appConfirmDialog');
  if (!dialog) return Promise.resolve(false);
  document.getElementById('appConfirmTitle').textContent = title;
  document.getElementById('appConfirmText').textContent = text;
  document.getElementById('appConfirmOk').textContent = confirmLabel;
  const cancel = dialog.querySelector('[data-confirm-cancel]');
  if (cancel) cancel.textContent = cancelLabel;
  return new Promise((resolve) => {
    confirmResolver = resolve;
    openExclusiveDialog('appConfirmDialog');
  });
}
