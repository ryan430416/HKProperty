let toastTimer = 0;

export function toast(message, type = 'ok') {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2800);
}

export function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
}

export function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

export function closeTopDialog() {
  const openDialogs = [...document.querySelectorAll('dialog[open]')];
  const top = openDialogs.at(-1);
  top?.close();
  return Boolean(top);
}

export function setLoading(on, text = '資料載入中…') {
  const el = document.querySelector('#loading');
  if (!el) return;
  el.hidden = !on;
  const label = el.querySelector('p');
  if (label) label.textContent = text;
}

export function fillSelect(select, blankLabel, values, current = '') {
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
