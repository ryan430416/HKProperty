import {
  AUDIT_STATUS,
  PAGE_SIZE,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  PLACEHOLDER_IMAGE,
  displayValue,
  esc,
  formatDate,
  formatDateTime,
  formatPrice,
  toInputDateTime,
  auditStatusClass
} from './format.js';
import { closeDialog, fillSelect, openDialog, setLoading, toast } from './ui.js';
import { parseScanPayload, startCameraScan } from './scanner.js';
import {
  findByPropertyId,
  getFilterOptions,
  getItem,
  getStats,
  listItems,
  loadCatalog,
  locationRanking,
  saveImage
} from '../services/inventoryService.js';
import { addUsage, listUsage, monthUsageCount } from '../services/usageService.js';
import { addAudit, confirmLocationUpdate, listAudits, listLocationChanges } from '../services/auditService.js';

const PAGE_META = {
  dashboard: ['財產管理', '系統總覽'],
  inventory: ['財產查詢', '財產清冊'],
  audit: ['盤點作業', '盤點作業'],
  usage: ['使用管理', '使用紀錄'],
  locations: ['位置資料', '位置管理'],
  settings: ['系統維護', '系統設定']
};

const state = {
  view: 'dashboard',
  page: 1,
  auditPage: 1,
  usagePage: 1,
  historyTab: 'usage',
  historyId: '',
  pendingImage: ''
};

function $(id) {
  return document.getElementById(id);
}

function currentFilters() {
  return {
    q: $('filterQuery').value.trim().toLowerCase(),
    location: $('filterLocation').value,
    status: $('filterStatus').value,
    auditStatus: $('filterAudit').value,
    department: $('filterDept').value,
    sort: $('filterSort').value
  };
}

function matchesFilters(item, filters) {
  const haystack = [
    item.propertyId,
    item.name,
    item.location,
    item.custodian,
    item.department,
    item.specification
  ].join(' ').toLowerCase();
  const hit = !filters.q || haystack.includes(filters.q);
  return hit
    && (!filters.location || item.location === filters.location)
    && (!filters.status || item.status === filters.status)
    && (!filters.auditStatus || item.auditStatus === filters.auditStatus)
    && (!filters.department || item.department === filters.department);
}

function sortItems(list, sort) {
  const copy = list.slice();
  copy.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-Hant') || a.propertyId.localeCompare(b.propertyId);
    if (sort === 'useCount') return b.useCount - a.useCount || a.propertyId.localeCompare(b.propertyId);
    if (sort === 'lastAuditAt') return String(b.lastAuditAt || '').localeCompare(String(a.lastAuditAt || '')) || a.propertyId.localeCompare(b.propertyId);
    return a.propertyId.localeCompare(b.propertyId, undefined, { numeric: true });
  });
  return copy;
}

function filteredItems(extra = {}) {
  const filters = { ...currentFilters(), ...extra };
  return sortItems(listItems().filter((item) => matchesFilters(item, filters)), filters.sort);
}

function paginate(list, page) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE_SIZE;
  return {
    total,
    pages,
    page: current,
    start: total ? start + 1 : 0,
    end: Math.min(start + PAGE_SIZE, total),
    rows: list.slice(start, start + PAGE_SIZE)
  };
}

function pagerHTML(id, data) {
  if (!data.total) return `<p class="muted">目前顯示 0 筆，共 0 筆</p>`;
  const buttons = [];
  buttons.push(`<button type="button" data-page-target="${id}" data-page="prev" ${data.page === 1 ? 'disabled' : ''}>上一頁</button>`);
  const windowSize = 5;
  let from = Math.max(1, data.page - 2);
  let to = Math.min(data.pages, from + windowSize - 1);
  from = Math.max(1, to - windowSize + 1);
  if (from > 1) buttons.push(`<button type="button" data-page-target="${id}" data-page="1">1</button>`);
  for (let i = from; i <= to; i += 1) {
    buttons.push(`<button type="button" class="${i === data.page ? 'active' : ''}" data-page-target="${id}" data-page="${i}">${i}</button>`);
  }
  if (to < data.pages) buttons.push(`<button type="button" data-page-target="${id}" data-page="${data.pages}">${data.pages}</button>`);
  buttons.push(`<button type="button" data-page-target="${id}" data-page="next" ${data.page === data.pages ? 'disabled' : ''}>下一頁</button>`);
  return `<p class="muted">目前顯示 ${data.start}–${data.end} 筆，共 ${data.total} 筆</p><div class="pager-pages">${buttons.join('')}</div>`;
}

function imageOf(item) {
  return item.image || PLACEHOLDER_IMAGE;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((el) => {
    el.hidden = el.id !== `view-${view}`;
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const [eyebrow, title] = PAGE_META[view] || PAGE_META.dashboard;
  $('pageEyebrow').textContent = eyebrow;
  $('pageTitle').textContent = title;
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').hidden = true;
  render();
}

function refreshFilterOptions() {
  const options = getFilterOptions();
  fillSelect($('filterLocation'), '全部地點', options.locations, $('filterLocation').value);
  fillSelect($('filterStatus'), '全部狀態', options.statuses, $('filterStatus').value);
  fillSelect($('filterAudit'), '全部盤點狀態', options.auditStatuses, $('filterAudit').value);
  fillSelect($('filterDept'), '全部單位', options.departments, $('filterDept').value);
}

function renderDashboard() {
  const stats = getStats();
  const monthUses = monthUsageCount();
  $('statGrid').innerHTML = [
    ['財產總數', stats.total, '件'],
    ['已完成盤點', stats.done, '件'],
    ['待盤點', stats.pending, '件'],
    ['位置異常', stats.mismatch, '件'],
    ['本月使用次數', monthUses, '次']
  ].map(([label, value, unit]) => `
    <article class="stat-card"><small>${label}</small><strong>${value}</strong><em>${unit}</em></article>
  `).join('');

  const ranks = locationRanking(10);
  const max = ranks[0]?.count || 1;
  $('locationRank').innerHTML = ranks.length
    ? ranks.map((row) => `
      <div class="rank-row">
        <b>${esc(row.location)}</b>
        <div class="bar"><i style="width:${Math.round((row.count / max) * 100)}%"></i></div>
        <span>${row.count}</span>
      </div>
    `).join('')
    : '<div class="empty">尚無位置資料</div>';

  const audits = listAudits().slice(0, 5);
  $('recentAudits').innerHTML = audits.length
    ? audits.map((log) => {
      const item = getItem(log.propertyId);
      return `<div class="feed-item"><strong>${esc(item?.name || '財產')} · ${esc(log.propertyId)}</strong><span>${esc(log.result)} · ${esc(formatDateTime(log.auditedAt))}</span></div>`;
    }).join('')
    : '<div class="empty">尚無盤點紀錄</div>';

  const usages = listUsage().slice(0, 5);
  $('recentUsage').innerHTML = usages.length
    ? usages.map((log) => {
      const item = getItem(log.propertyId);
      return `<div class="feed-item"><strong>${esc(item?.name || '財產')} · ${esc(log.propertyId)}</strong><span>${esc(log.userName)} · ${esc(formatDateTime(log.usedAt))}</span></div>`;
    }).join('')
    : '<div class="empty">尚無使用紀錄</div>';
}

function renderInventory() {
  const data = paginate(filteredItems(), state.page);
  state.page = data.page;
  if (!data.total) {
    $('inventoryBody').innerHTML = '<tr><td colspan="10"><div class="empty">找不到符合條件的財產</div></td></tr>';
    $('inventoryCards').innerHTML = '<div class="empty">找不到符合條件的財產</div>';
    $('inventoryPager').innerHTML = pagerHTML('inventory', data);
    return;
  }

  $('inventoryBody').innerHTML = data.rows.map((item) => `
    <tr>
      <td><div class="thumb"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div></td>
      <td>${esc(item.name)}</td>
      <td class="pid">${esc(item.propertyId)}</td>
      <td>${esc(displayValue(item.location))}</td>
      <td>${esc(displayValue(item.department))}</td>
      <td>${esc(displayValue(item.custodian))}</td>
      <td>${item.useCount}</td>
      <td><span class="badge">${esc(displayValue(item.status))}</span></td>
      <td><span class="badge ${auditStatusClass(item.auditStatus)}">${esc(item.auditStatus)}</span></td>
      <td><button type="button" class="link-btn" data-open-item="${esc(item.propertyId)}">查看</button></td>
    </tr>
  `).join('');

  $('inventoryCards').innerHTML = data.rows.map((item) => `
    <article class="asset-card">
      <div class="photo"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
      <div class="body">
        <h3>${esc(item.name)}</h3>
        <div class="pid">${esc(item.propertyId)}</div>
        <div class="meta-row"><span>${esc(displayValue(item.location))}</span><span class="badge ${auditStatusClass(item.auditStatus)}">${esc(item.auditStatus)}</span></div>
        <div class="meta-row"><span>${esc(displayValue(item.custodian))}</span><span>使用 ${item.useCount} 次</span></div>
        <div class="card-actions">
          <button type="button" class="link-btn" data-open-item="${esc(item.propertyId)}">查看資料</button>
        </div>
      </div>
    </article>
  `).join('');

  $('inventoryPager').innerHTML = pagerHTML('inventory', data);
}

function renderAuditPage() {
  const stats = getStats();
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  $('auditSummary').textContent = `已完成 ${stats.done} 件，待盤點 ${stats.pending} 件，完成率 ${percent}%`;
  $('auditProgressBar').style.width = `${percent}%`;

  const pending = sortItems(
    listItems().filter((item) => item.auditStatus === AUDIT_STATUS.PENDING),
    'propertyId'
  );
  const data = paginate(pending, state.auditPage);
  state.auditPage = data.page;
  $('auditList').innerHTML = data.rows.length
    ? `<div class="panel">${data.rows.map((item) => `
        <div class="audit-item">
          <div>
            <strong>${esc(item.name)}</strong>
            <div class="pid">${esc(item.propertyId)}</div>
            <div class="muted">登記位置 ${esc(displayValue(item.location))}</div>
          </div>
          <button type="button" class="primary" data-audit="${esc(item.propertyId)}">執行盤點</button>
        </div>
      `).join('')}</div>`
    : '<div class="empty">目前沒有待盤點財產</div>';
  $('auditPager').innerHTML = pagerHTML('audit', data);
}

function renderUsagePage() {
  const logs = listUsage();
  const data = paginate(logs, state.usagePage);
  state.usagePage = data.page;
  $('usageList').innerHTML = data.rows.length
    ? data.rows.map((log) => {
      const item = getItem(log.propertyId);
      return `<div class="log-item">
        <div>
          <strong>${esc(item?.name || '財產')} · ${esc(log.propertyId)}</strong>
          <div class="muted">${esc(log.userName)}／${esc(log.department)} · ${esc(formatDateTime(log.usedAt))}</div>
          <div>${esc(log.purpose)}</div>
        </div>
        <button type="button" class="link-btn" data-open-item="${esc(log.propertyId)}">查看財產</button>
      </div>`;
    }).join('')
    : '<div class="empty">尚無使用紀錄</div>';
  $('usagePager').innerHTML = pagerHTML('usage', data);
}

function renderLocations() {
  const rows = locationRanking(99);
  const max = rows[0]?.count || 1;
  $('locationManage').innerHTML = rows.map((row) => `
    <button type="button" class="loc-row" data-goto-location="${esc(row.location)}">
      <div>
        <strong>${esc(row.location)}</strong>
        <div class="bar" style="width:min(280px,60vw)"><i style="width:${Math.round((row.count / max) * 100)}%"></i></div>
      </div>
      <span>${row.count} 件</span>
    </button>
  `).join('');
}

function renderNotify() {
  const mismatch = listItems().filter((item) => item.auditStatus === AUDIT_STATUS.MISMATCH || item.auditStatus === AUDIT_STATUS.MISSING);
  const pending = getStats().pending;
  $('notifyDot').hidden = mismatch.length === 0 && pending === 0;
  if (!mismatch.length && pending === 0) {
    $('notifyList').innerHTML = '<p class="muted">目前沒有待處理通知</p>';
    return;
  }
  const items = mismatch.slice(0, 5).map((item) => `
    <div class="notify-item">
      <button type="button" data-open-item="${esc(item.propertyId)}">${esc(item.name)} · ${esc(item.propertyId)}</button>
      <div class="muted">${esc(item.auditStatus)}</div>
    </div>
  `).join('');
  $('notifyList').innerHTML = `<p class="muted">待盤點 ${pending} 件，位置異常 ${mismatch.length} 件</p>${items || ''}`;
}

function render() {
  refreshFilterOptions();
  renderNotify();
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'inventory') renderInventory();
  if (state.view === 'audit') renderAuditPage();
  if (state.view === 'usage') renderUsagePage();
  if (state.view === 'locations') renderLocations();
}

function openItem(propertyId) {
  const item = getItem(propertyId);
  if (!item) {
    toast('找不到對應財產', 'error');
    return;
  }
  $('detailTitle').textContent = item.name;
  $('detailBody').innerHTML = `
    <div class="detail-photo"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
    <dl>
      ${[
        ['財產名稱', item.name],
        ['財產編號', item.propertyId],
        ['目前位置', displayValue(item.location)],
        ['保管單位', displayValue(item.department)],
        ['保管人', displayValue(item.custodian)],
        ['規格', displayValue(item.specification)],
        ['單位', displayValue(item.unit)],
        ['單價', formatPrice(item.price)],
        ['購買日期', formatDate(item.purchaseDate)],
        ['使用年限', isFiniteNumber(item.serviceLife) ? `${item.serviceLife} 年` : '未提供'],
        ['廠商', displayValue(item.supplier)],
        ['廠牌', displayValue(item.brand)],
        ['型號', displayValue(item.model)],
        ['財產狀態', displayValue(item.status)],
        ['使用次數', String(item.useCount)],
        ['最後盤點時間', item.lastAuditAt ? formatDateTime(item.lastAuditAt) : '尚未盤點'],
        ['盤點狀態', item.auditStatus],
        ['備註', displayValue(item.note)]
      ].map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    <div class="action-grid">
      <button type="button" class="primary" data-usage="${esc(item.propertyId)}">登記使用</button>
      <button type="button" class="primary" data-audit="${esc(item.propertyId)}">執行盤點</button>
      <button type="button" class="secondary" data-location="${esc(item.propertyId)}">更新位置</button>
      <button type="button" class="secondary" data-image="${esc(item.propertyId)}">上傳圖片</button>
      <button type="button" class="secondary" data-history="${esc(item.propertyId)}">查看紀錄</button>
    </div>
  `;
  openDialog('detailDialog');
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function openUsage(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  $('usagePropertyId').value = item.propertyId;
  $('usageEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('usageUser').value = '';
  $('usageDept').value = item.department || '';
  $('usageAt').value = toInputDateTime();
  $('usagePurpose').value = '';
  $('usageNote').value = '';
  openDialog('usageDialog');
}

function openAudit(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  $('auditPropertyId').value = item.propertyId;
  $('auditEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('auditRegistered').value = item.location || '';
  $('auditActual').value = item.location || '';
  $('auditPerson').value = '';
  $('auditAt').value = toInputDateTime();
  $('auditNote').value = '';
  document.querySelectorAll('input[name="auditResult"]').forEach((el) => { el.checked = false; });
  openDialog('auditDialog');
}

function openLocation(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  $('locationPropertyId').value = item.propertyId;
  $('locationEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('locationCurrent').value = item.location || '';
  $('locationNext').value = '';
  $('locationOperator').value = '管理者';
  $('locationReason').value = '';
  openDialog('locationDialog');
}

function openImage(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  state.pendingImage = '';
  $('imagePropertyId').value = item.propertyId;
  $('imageEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('imagePreview').src = imageOf(item);
  $('imageFile').value = '';
  $('imageError').textContent = '';
  $('imageSaveBtn').disabled = true;
  openDialog('imageDialog');
}

function historyListHTML(rows, emptyText, line) {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  return rows.map((row) => `<div class="feed-item">${line(row)}</div>`).join('');
}

function renderHistory() {
  const id = state.historyId;
  if (state.historyTab === 'usage') {
    $('historyBody').innerHTML = historyListHTML(listUsage(id), '尚無使用紀錄', (log) => `
      <strong>${esc(formatDateTime(log.usedAt))}</strong>
      <div>${esc(log.userName)}／${esc(log.department)}</div>
      <div>${esc(log.purpose)}${log.note ? ` · ${esc(log.note)}` : ''}</div>
    `);
    return;
  }
  if (state.historyTab === 'audit') {
    $('historyBody').innerHTML = historyListHTML(listAudits(id), '尚無盤點紀錄', (log) => `
      <strong>${esc(log.result)} · ${esc(formatDateTime(log.auditedAt))}</strong>
      <div>盤點人 ${esc(log.auditor)}</div>
      <div>登記 ${esc(log.registeredLocation)} → 實際 ${esc(log.actualLocation)}</div>
    `);
    return;
  }
  $('historyBody').innerHTML = historyListHTML(listLocationChanges(id), '尚無位置異動紀錄', (log) => `
    <strong>${esc(formatDateTime(log.changedAt))}</strong>
    <div>${esc(log.fromLocation)} → ${esc(log.toLocation)}</div>
    <div>${esc(log.operator)} · ${esc(log.reason)}</div>
  `);
}

function openHistory(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  state.historyId = item.propertyId;
  state.historyTab = 'usage';
  $('historyEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  document.querySelectorAll('[data-history-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.historyTab === 'usage');
  });
  renderHistory();
  openDialog('historyDialog');
}

function askLocationConfirm(propertyId, fromLocation, toLocation) {
  $('confirmPropertyId').value = propertyId;
  $('confirmFrom').value = fromLocation;
  $('confirmTo').value = toLocation;
  $('confirmText').textContent = `系統登記位置為 ${fromLocation}，本次實際位置為 ${toLocation}。原位置不會自動覆蓋，是否確認更新？`;
  openDialog('confirmDialog');
}

function openScan() {
  $('scanCode').value = '';
  $('scanError').textContent = '';
  openDialog('scanDialog');
}

function lookupScan(raw) {
  const code = parseScanPayload(raw);
  const item = findByPropertyId(code);
  if (!item) {
    $('scanError').textContent = `找不到財產編號「${code}」，請確認後再試。`;
    toast('找不到對應財產', 'error');
    return;
  }
  closeDialog('scanDialog');
  $('filterQuery').value = code;
  state.page = 1;
  setView('inventory');
  openItem(item.propertyId);
  toast(`已找到「${item.name}」`);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) {
      closeDialog(closer.dataset.close);
      return;
    }
    const nav = event.target.closest('[data-view]');
    if (nav) {
      setView(nav.dataset.view);
      return;
    }
    const openBtn = event.target.closest('[data-open-item]');
    if (openBtn) {
      $('notifyPanel').hidden = true;
      openItem(openBtn.dataset.openItem);
      return;
    }
    const usageBtn = event.target.closest('[data-usage]');
    if (usageBtn) {
      openUsage(usageBtn.dataset.usage);
      return;
    }
    const auditBtn = event.target.closest('[data-audit]');
    if (auditBtn) {
      openAudit(auditBtn.dataset.audit);
      return;
    }
    const locBtn = event.target.closest('[data-location]');
    if (locBtn) {
      openLocation(locBtn.dataset.location);
      return;
    }
    const imageBtn = event.target.closest('[data-image]');
    if (imageBtn) {
      openImage(imageBtn.dataset.image);
      return;
    }
    const historyBtn = event.target.closest('[data-history]');
    if (historyBtn) {
      openHistory(historyBtn.dataset.history);
      return;
    }
    const tab = event.target.closest('[data-history-tab]');
    if (tab) {
      state.historyTab = tab.dataset.historyTab;
      document.querySelectorAll('[data-history-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn === tab);
      });
      renderHistory();
      return;
    }
    const locFilter = event.target.closest('[data-goto-location]');
    if (locFilter) {
      $('filterLocation').value = locFilter.dataset.gotoLocation;
      state.page = 1;
      setView('inventory');
      return;
    }
    const pageBtn = event.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      const target = pageBtn.dataset.pageTarget;
      const key = target === 'audit' ? 'auditPage' : target === 'usage' ? 'usagePage' : 'page';
      const current = state[key];
      if (pageBtn.dataset.page === 'prev') state[key] = current - 1;
      else if (pageBtn.dataset.page === 'next') state[key] = current + 1;
      else state[key] = Number(pageBtn.dataset.page);
      render();
    }
  });

  $('menuBtn').addEventListener('click', () => {
    const open = $('sidebar').classList.toggle('open');
    $('sidebarBackdrop').hidden = !open;
  });
  $('sidebarBackdrop').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').hidden = true;
  });
  $('scanBtn').addEventListener('click', openScan);
  $('scanBtnMobile').addEventListener('click', openScan);
  $('notifyBtn').addEventListener('click', () => {
    const panel = $('notifyPanel');
    panel.hidden = !panel.hidden;
    $('notifyBtn').setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.notify-wrap')) $('notifyPanel').hidden = true;
  });

  $('globalSearchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    $('filterQuery').value = $('globalSearch').value.trim();
    state.page = 1;
    setView('inventory');
  });
  $('filterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.page = 1;
    renderInventory();
  });
  $('filterForm').addEventListener('input', () => {
    state.page = 1;
    renderInventory();
  });
  $('filterForm').addEventListener('change', () => {
    state.page = 1;
    renderInventory();
  });
  $('clearFilters').addEventListener('click', () => {
    $('filterQuery').value = '';
    $('globalSearch').value = '';
    $('filterLocation').value = '';
    $('filterStatus').value = '';
    $('filterAudit').value = '';
    $('filterDept').value = '';
    $('filterSort').value = 'propertyId';
    state.page = 1;
    renderInventory();
    toast('已清除篩選');
  });

  $('usageForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const { item } = addUsage({
        propertyId: $('usagePropertyId').value,
        userName: $('usageUser').value,
        department: $('usageDept').value,
        usedAt: $('usageAt').value,
        purpose: $('usagePurpose').value,
        note: $('usageNote').value
      });
      closeDialog('usageDialog');
      render();
      openItem(item.propertyId);
      toast('已登記使用，使用次數已更新');
    } catch (error) {
      toast(error.message || '登記使用失敗', 'error');
    }
  });

  $('auditForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const result = document.querySelector('input[name="auditResult"]:checked')?.value;
      const outcome = addAudit({
        propertyId: $('auditPropertyId').value,
        registeredLocation: $('auditRegistered').value,
        actualLocation: $('auditActual').value,
        result,
        auditor: $('auditPerson').value,
        auditedAt: $('auditAt').value,
        note: $('auditNote').value
      });
      closeDialog('auditDialog');
      render();
      openItem(outcome.item.propertyId);
      toast('盤點結果已儲存');
      if (outcome.needsLocationConfirm) {
        askLocationConfirm(outcome.item.propertyId, outcome.entry.registeredLocation, outcome.entry.actualLocation);
      }
    } catch (error) {
      toast(error.message || '盤點失敗', 'error');
    }
  });

  $('locationForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const { item } = confirmLocationUpdate({
        propertyId: $('locationPropertyId').value,
        fromLocation: $('locationCurrent').value,
        toLocation: $('locationNext').value,
        operator: $('locationOperator').value,
        reason: $('locationReason').value
      });
      closeDialog('locationDialog');
      render();
      openItem(item.propertyId);
      toast('位置已更新，並已建立異動紀錄');
    } catch (error) {
      toast(error.message || '位置更新失敗', 'error');
    }
  });

  $('confirmForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      confirmLocationUpdate({
        propertyId: $('confirmPropertyId').value,
        fromLocation: $('confirmFrom').value,
        toLocation: $('confirmTo').value,
        operator: '管理者',
        reason: '盤點後確認更新位置'
      });
      closeDialog('confirmDialog');
      render();
      openItem($('confirmPropertyId').value);
      toast('已確認更新位置');
    } catch (error) {
      toast(error.message || '位置更新失敗', 'error');
    }
  });
  $('confirmKeep').addEventListener('click', () => {
    closeDialog('confirmDialog');
    toast('已維持原位置');
  });

  $('imageFile').addEventListener('change', () => {
    const file = $('imageFile').files[0];
    $('imageError').textContent = '';
    $('imageSaveBtn').disabled = true;
    state.pendingImage = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      $('imageError').textContent = '僅支援 JPG、PNG、WebP';
      toast('圖片格式不正確', 'error');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      $('imageError').textContent = '檔案大小不可超過 1.5 MB';
      toast('檔案過大，請重新選擇', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingImage = String(reader.result || '');
      $('imagePreview').src = state.pendingImage;
      $('imageSaveBtn').disabled = false;
    };
    reader.onerror = () => {
      $('imageError').textContent = '讀取圖片失敗，請再試一次';
      toast('讀取圖片失敗', 'error');
    };
    reader.readAsDataURL(file);
  });

  $('imageForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.pendingImage) {
      $('imageError').textContent = '請先選擇圖片';
      return;
    }
    try {
      const item = saveImage($('imagePropertyId').value, state.pendingImage);
      closeDialog('imageDialog');
      render();
      openItem(item.propertyId);
      toast('圖片已儲存');
    } catch (error) {
      toast(error.message || '圖片儲存失敗', 'error');
    }
  });

  $('scanForm').addEventListener('submit', (event) => {
    event.preventDefault();
    lookupScan($('scanCode').value);
  });
  $('cameraScanBtn').addEventListener('click', async () => {
    try {
      await startCameraScan();
    } catch (error) {
      $('scanError').textContent = error.message;
      toast(error.message, 'error');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('notifyPanel').hidden = true;
      $('sidebar').classList.remove('open');
      $('sidebarBackdrop').hidden = true;
    }
  });
}

async function init() {
  bindEvents();
  setLoading(true, '正在載入財產清冊…');
  try {
    await loadCatalog();
    refreshFilterOptions();
    setView('dashboard');
    toast(`已載入 ${listItems().length} 筆財產`);
  } catch (error) {
    $('main').insertAdjacentHTML('afterbegin', `<div class="empty">載入失敗：${esc(error.message)}。請以本機伺服器開啟網站後再試。</div>`);
    toast(error.message || '載入失敗', 'error');
  } finally {
    setLoading(false);
  }
}

init();
