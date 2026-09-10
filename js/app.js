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
  auditStatusClass,
  availabilityClass
} from './format.js';
import { bindConfirmDialog, bindDialogBehavior, closeDialog, confirmAction, fillSelect, isSwitchingDialogs, openExclusiveDialog, setLoading, toast } from './ui.js';
import { bindSelfService, openSelfMode, showHome } from './selfService.js';
import { parseScanPayload, startCameraScan } from './scanner.js';
import {
  AVAILABILITY,
  findByPropertyId,
  getFilterOptions,
  getItem,
  getStats,
  listItems,
  loadCatalog,
  locationRanking,
  saveImage
} from '../services/inventoryService.js';
import { addUsage, listUsage } from '../services/usageService.js';
import { addAudit, confirmLocationUpdate, listAudits, listLocationChanges } from '../services/auditService.js';
import { runLoanLifecycleTest } from '../services/loanFlowTest.js';
import { runSelfServiceFlowTest } from '../services/selfServiceFlowTest.js';
import {
  CHECKOUT_METHOD,
  RETURN_RESULT,
  checkin,
  checkout,
  checkoutMethodLabel,
  currentLoanOf,
  displayLoanStatus,
  exportLoansCsv,
  getLoan,
  getLoanDashboardStats,
  getOpenLoan,
  isDueToday,
  isDueWithinHours,
  isLoanOverdue,
  isOpenLoan,
  listLoans,
  overdueDuration,
  refreshOverdueStatus
} from '../services/loanService.js';
import {
  clearOperationalData,
  exportOperationalJson,
  importOperationalJson,
  storageUsageBytes
} from '../services/storageService.js';

const PAGE_META = {
  dashboard: ['財產管理', '系統總覽'],
  selfService: ['自助服務', '自助借還'],
  inventory: ['財產查詢', '財產清冊'],
  loans: ['借用作業', '借出管理'],
  loanHistory: ['借用作業', '借用紀錄'],
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
  loanPage: 1,
  loanHistoryPage: 1,
  historyTab: 'usage',
  historyId: '',
  pendingImage: '',
  pendingCheckout: null,
  returnToDetailId: null
};

function $(id) {
  return document.getElementById(id);
}

function imageOf(item) {
  return item?.image || PLACEHOLDER_IMAGE;
}

function currentFilters() {
  return {
    q: $('filterQuery').value.trim().toLowerCase(),
    location: $('filterLocation').value,
    status: $('filterStatus').value,
    auditStatus: $('filterAudit').value,
    availability: $('filterAvailability').value,
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
    && (!filters.availability || item.availabilityStatus === filters.availability)
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

function filteredItems() {
  const filters = currentFilters();
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

function availabilityBadge(item) {
  return `<span class="badge ${availabilityClass(item.availabilityStatus)}">${esc(item.availabilityLabel)}</span>`;
}

function loanBorrowerText(item) {
  const loan = currentLoanOf(item);
  return loan && isOpenLoan(loan) ? loan.borrowerName : '—';
}

function loanDueText(item) {
  const loan = currentLoanOf(item);
  return loan && isOpenLoan(loan) ? formatDateTime(loan.expectedReturnAt) : '—';
}

function setView(view) {
  refreshOverdueStatus();
  const previous = state.view;
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
  if (view === 'selfService' && previous !== 'selfService') showHome();
  render();
}

function refreshFilterOptions() {
  const options = getFilterOptions();
  fillSelect($('filterLocation'), '全部地點', options.locations, $('filterLocation').value);
  fillSelect($('filterStatus'), '全部狀態', options.statuses, $('filterStatus').value);
  fillSelect($('filterAudit'), '全部盤點狀態', options.auditStatuses, $('filterAudit').value);
  fillSelect($('filterDept'), '全部單位', options.departments, $('filterDept').value);
}

function feedHTML(rows, emptyText, line) {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  return rows.map((row) => `<div class="feed-item">${line(row)}</div>`).join('');
}

function renderDashboard() {
  const stats = getStats();
  const loanStats = getLoanDashboardStats();
  $('statGrid').innerHTML = [
    ['財產總數', stats.total, '件'],
    ['可借用', stats.available, '件'],
    ['已借出', stats.checkedOut, '件'],
    ['今日應歸還', loanStats.dueToday, '件'],
    ['逾期未還', loanStats.overdue, '件'],
    ['待盤點', stats.pending, '件']
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

  const checkouts = listLoans().slice(0, 5);
  $('recentCheckouts').innerHTML = feedHTML(checkouts, '尚無借出紀錄', (loan) => `
    <strong>${esc(loan.propertyName)} · ${esc(loan.propertyId)}</strong>
    <span>${esc(loan.borrowerName)} · ${esc(formatDateTime(loan.checkedOutAt))}</span>
  `);

  const returns = listLoans()
    .filter((loan) => loan.returnedAt)
    .sort((a, b) => new Date(b.returnedAt) - new Date(a.returnedAt))
    .slice(0, 5);
  $('recentReturns').innerHTML = feedHTML(returns, '尚無歸還紀錄', (loan) => `
    <strong>${esc(loan.propertyName)} · ${esc(loan.propertyId)}</strong>
    <span>${esc(loan.borrowerName)} · ${esc(formatDateTime(loan.returnedAt))}</span>
  `);

  const overdue = listLoans().filter((loan) => isLoanOverdue(loan));
  $('overdueList').innerHTML = overdue.length
    ? overdue.slice(0, 8).map((loan) => `
      <div class="feed-item">
        <strong>${esc(loan.propertyName)} · ${esc(loan.propertyId)}</strong>
        <span class="badge alert">${esc(overdueDuration(loan))}</span>
        <div class="muted">${esc(loan.borrowerName)} · 應於 ${esc(formatDateTime(loan.expectedReturnAt))} 歸還</div>
        <button type="button" class="link-btn" data-checkin="${esc(loan.propertyId)}">辦理歸還</button>
      </div>
    `).join('')
    : '<div class="empty">目前沒有逾期未還財產</div>';
}

function renderInventory() {
  const data = paginate(filteredItems(), state.page);
  state.page = data.page;
  if (!data.total) {
    $('inventoryBody').innerHTML = '<tr><td colspan="13"><div class="empty">找不到符合條件的財產</div></td></tr>';
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
      <td>${availabilityBadge(item)}</td>
      <td>${esc(loanBorrowerText(item))}</td>
      <td>${esc(loanDueText(item))}</td>
      <td><button type="button" class="link-btn" data-open-item="${esc(item.propertyId)}">查看</button></td>
    </tr>
  `).join('');

  $('inventoryCards').innerHTML = data.rows.map((item) => `
    <article class="asset-card">
      <div class="photo"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
      <div class="body">
        <h3>${esc(item.name)}</h3>
        <div class="pid">${esc(item.propertyId)}</div>
        <div class="meta-row"><span>${esc(displayValue(item.location))}</span>${availabilityBadge(item)}</div>
        <div class="meta-row"><span>${esc(displayValue(item.custodian))}</span><span>使用 ${item.useCount} 次</span></div>
        <div class="card-actions">
          <button type="button" class="link-btn" data-open-item="${esc(item.propertyId)}">查看資料</button>
        </div>
      </div>
    </article>
  `).join('');
  $('inventoryPager').innerHTML = pagerHTML('inventory', data);
}

function loanRowHTML(loan) {
  const item = getItem(loan.propertyId);
  const overdue = isLoanOverdue(loan);
  return `
    <div class="audit-item ${overdue ? 'overdue-box' : ''}">
      <div class="thumb"><img src="${esc(imageOf(item))}" alt="${esc(loan.propertyName)}"></div>
      <div>
        <strong>${esc(loan.propertyName)}</strong>
        <div class="pid">${esc(loan.propertyId)}</div>
        <div class="muted">${esc(loan.borrowerName)}／${esc(loan.borrowerDepartment)}</div>
        <div class="muted">借出 ${esc(formatDateTime(loan.checkedOutAt))} · 應還 ${esc(formatDateTime(loan.expectedReturnAt))}</div>
        ${overdue ? `<div class="badge alert">${esc(overdueDuration(loan))}</div>` : ''}
      </div>
      <div>
        <span class="badge ${overdue ? 'alert' : 'loan'}">${esc(displayLoanStatus(loan))}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="link-btn" data-open-item="${esc(loan.propertyId)}">查看</button>
        <button type="button" class="primary" data-checkin="${esc(loan.propertyId)}">辦理歸還</button>
      </div>
    </div>
  `;
}

function renderLoans() {
  refreshOverdueStatus();
  const stats = getStats();
  const loanStats = getLoanDashboardStats();
  $('loanStatGrid').innerHTML = [
    ['可借用財產', stats.available, '件'],
    ['已借出', stats.checkedOut, '件'],
    ['今日應歸還', loanStats.dueToday, '件'],
    ['逾期未還', loanStats.overdue, '件'],
    ['維修中', stats.maintenance, '件']
  ].map(([label, value, unit]) => `
    <article class="stat-card"><small>${label}</small><strong>${value}</strong><em>${unit}</em></article>
  `).join('');

  const q = $('loanQuery').value.trim().toLowerCase();
  const mode = $('loanStatusFilter').value;
  let title = '目前借出中';
  let rows = [];

  if (mode === 'available' || mode === 'maintenance') {
    title = mode === 'available' ? '可借用財產' : '維修中財產';
    rows = listItems().filter((item) => item.availabilityStatus === mode).filter((item) => {
      if (!q) return true;
      return [item.propertyId, item.name, item.location].join(' ').toLowerCase().includes(q);
    });
    const data = paginate(rows, state.loanPage);
    state.loanPage = data.page;
    $('loanSectionTitle').textContent = title;
    $('loanBoard').innerHTML = data.rows.length
      ? data.rows.map((item) => `
        <div class="audit-item">
          <div class="thumb"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
          <div>
            <strong>${esc(item.name)}</strong>
            <div class="pid">${esc(item.propertyId)}</div>
            <div class="muted">${esc(displayValue(item.location))}</div>
          </div>
          ${availabilityBadge(item)}
          <div class="card-actions">
            <button type="button" class="link-btn" data-open-item="${esc(item.propertyId)}">查看</button>
            ${mode === 'available' ? `<button type="button" class="primary" data-checkout="${esc(item.propertyId)}">辦理借出</button>` : ''}
          </div>
        </div>
      `).join('')
      : '<div class="empty">找不到符合條件的財產</div>';
    $('loanPager').innerHTML = pagerHTML('loans', data);
    return;
  }

  let loans = listLoans().filter((loan) => isOpenLoan(loan));
  if (mode === 'checked_out') {
    title = '已借出';
    loans = loans.filter((loan) => !isLoanOverdue(loan));
  } else if (mode === 'overdue') {
    title = '逾期未還';
    loans = loans.filter((loan) => isLoanOverdue(loan));
  } else if (mode === 'dueSoon') {
    title = '即將到期（24 小時內）';
    loans = loans.filter((loan) => isDueWithinHours(loan, 24) || isDueToday(loan));
  } else {
    title = '目前借出中';
  }
  if (q) {
    loans = loans.filter((loan) => [loan.propertyId, loan.propertyName, loan.borrowerName, loan.borrowerDepartment, loan.id].join(' ').toLowerCase().includes(q));
  }
  const data = paginate(loans, state.loanPage);
  state.loanPage = data.page;
  $('loanSectionTitle').textContent = title;
  $('loanBoard').innerHTML = data.rows.length
    ? data.rows.map(loanRowHTML).join('')
    : '<div class="empty">目前沒有符合條件的借用資料</div>';
  $('loanPager').innerHTML = pagerHTML('loans', data);
}

function filteredHistoryLoans() {
  const q = $('histQuery').value.trim().toLowerCase();
  const propertyId = $('histProperty').value.trim();
  const borrower = $('histBorrower').value.trim().toLowerCase();
  const status = $('histStatus').value;
  const from = $('histFrom').value ? new Date(`${$('histFrom').value}T00:00:00`) : null;
  const to = $('histTo').value ? new Date(`${$('histTo').value}T23:59:59`) : null;
  return listLoans().filter((loan) => {
    const hay = [loan.id, loan.propertyName, loan.propertyId, loan.borrowerName, loan.borrowerId, loan.purpose, loan.note].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (propertyId && loan.propertyId !== propertyId) return false;
    if (borrower && !loan.borrowerName.toLowerCase().includes(borrower)) return false;
    const shown = displayLoanStatus(loan);
    if (status === 'checked_out' && shown !== '借用中') return false;
    if (status === 'overdue' && shown !== '已逾期') return false;
    if (status === 'returned' && shown !== '已歸還') return false;
    if (status === 'cancelled' && shown !== '已取消') return false;
    const at = new Date(loan.checkedOutAt);
    if (from && at < from) return false;
    if (to && at > to) return false;
    return true;
  });
}

function renderLoanHistory() {
  const rows = filteredHistoryLoans();
  const data = paginate(rows, state.loanHistoryPage);
  state.loanHistoryPage = data.page;
  if (!data.total) {
    $('loanHistoryBody').innerHTML = '<tr><td colspan="16"><div class="empty">找不到符合條件的借用紀錄</div></td></tr>';
    $('loanHistoryCards').innerHTML = '<div class="empty">找不到符合條件的借用紀錄</div>';
    $('loanHistoryPager').innerHTML = pagerHTML('loanHistory', data);
    return;
  }
  $('loanHistoryBody').innerHTML = data.rows.map((loan) => `
    <tr>
      <td class="pid">${esc(loan.id)}</td>
      <td>${esc(loan.propertyName)}</td>
      <td class="pid">${esc(loan.propertyId)}</td>
      <td>${esc(loan.borrowerName)}</td>
      <td>${esc(loan.borrowerId)}</td>
      <td>${esc(loan.borrowerDepartment)}</td>
      <td>${esc(formatDateTime(loan.checkedOutAt))}</td>
      <td>${esc(formatDateTime(loan.expectedReturnAt))}</td>
      <td>${esc(loan.returnedAt ? formatDateTime(loan.returnedAt) : '尚未歸還')}</td>
      <td>${esc(loan.purpose)}</td>
      <td>${esc(loan.returnOperator || loan.checkoutOperator)}</td>
      <td>${esc(checkoutMethodLabel(loan))}</td>
      <td><span class="badge ${displayLoanStatus(loan) === '已逾期' ? 'alert' : displayLoanStatus(loan) === '借用中' ? 'loan' : 'ok'}">${esc(displayLoanStatus(loan))}</span></td>
      <td>${esc(loan.returnResult || '—')}</td>
      <td>${esc(loan.note || '—')}</td>
      <td><button type="button" class="link-btn" data-loan-detail="${esc(loan.id)}">查看完整紀錄</button></td>
    </tr>
  `).join('');
  $('loanHistoryCards').innerHTML = data.rows.map((loan) => `
    <article class="asset-card">
      <div class="body">
        <h3>${esc(loan.propertyName)}</h3>
        <div class="pid">${esc(loan.id)}</div>
        <div class="meta-row"><span>${esc(loan.borrowerName)}</span><span class="badge ${displayLoanStatus(loan) === '已逾期' ? 'alert' : 'loan'}">${esc(displayLoanStatus(loan))}</span></div>
        <div class="muted">${esc(checkoutMethodLabel(loan))} · ${esc(formatDateTime(loan.checkedOutAt))} → ${esc(loan.returnedAt ? formatDateTime(loan.returnedAt) : '尚未歸還')}</div>
        <button type="button" class="link-btn" data-loan-detail="${esc(loan.id)}">查看完整紀錄</button>
      </div>
    </article>
  `).join('');
  $('loanHistoryPager').innerHTML = pagerHTML('loanHistory', data);
}

function renderAuditPage() {
  const stats = getStats();
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  $('auditSummary').textContent = `已完成 ${stats.done} 件，待盤點 ${stats.pending} 件，完成率 ${percent}%`;
  $('auditProgressBar').style.width = `${percent}%`;
  const pending = sortItems(listItems().filter((item) => item.auditStatus === AUDIT_STATUS.PENDING), 'propertyId');
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

function renderSettings() {
  const usage = storageUsageBytes();
  const kb = (usage.bytes / 1024).toFixed(1);
  $('storageUsageText').textContent = `目前 localStorage 約使用 ${kb} KB（瀏覽器上限通常約 5 MB）。原始 390 筆財產清冊不在此儲存空間內。`;
}

function renderNotify() {
  const mismatch = listItems().filter((item) => item.auditStatus === AUDIT_STATUS.MISMATCH || item.auditStatus === AUDIT_STATUS.MISSING);
  const overdue = listItems().filter((item) => item.availabilityStatus === AVAILABILITY.OVERDUE);
  const pending = getStats().pending;
  $('notifyDot').hidden = mismatch.length === 0 && pending === 0 && overdue.length === 0;
  if (!mismatch.length && pending === 0 && !overdue.length) {
    $('notifyList').innerHTML = '<p class="muted">目前沒有待處理通知</p>';
    return;
  }
  const items = [...overdue, ...mismatch].slice(0, 6).map((item) => `
    <div class="notify-item">
      <button type="button" data-open-item="${esc(item.propertyId)}">${esc(item.name)} · ${esc(item.propertyId)}</button>
      <div class="muted">${esc(item.availabilityLabel)} · ${esc(item.auditStatus)}</div>
    </div>
  `).join('');
  $('notifyList').innerHTML = `<p class="muted">待盤點 ${pending} 件，逾期未還 ${overdue.length} 件，位置異常 ${mismatch.length} 件</p>${items || ''}`;
}

function render() {
  refreshOverdueStatus();
  refreshFilterOptions();
  renderNotify();
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'inventory') renderInventory();
  if (state.view === 'loans') renderLoans();
  if (state.view === 'loanHistory') renderLoanHistory();
  if (state.view === 'audit') renderAuditPage();
  if (state.view === 'usage') renderUsagePage();
  if (state.view === 'locations') renderLocations();
  if (state.view === 'settings') renderSettings();
}

function loanActionButtons(item) {
  if (item.availabilityStatus === AVAILABILITY.MAINTENANCE) {
    return `<button type="button" class="primary" disabled>辦理借出</button><p class="muted">此財產維修中</p>`;
  }
  if (item.availabilityStatus === AVAILABILITY.LOST) {
    return `<button type="button" class="primary" disabled>辦理借出</button><p class="muted">此財產狀態為異常，不可再次借出</p>`;
  }
  if (item.availabilityStatus === AVAILABILITY.CHECKED_OUT || item.availabilityStatus === AVAILABILITY.OVERDUE) {
    return `<button type="button" class="primary" data-checkin="${esc(item.propertyId)}">辦理歸還</button>`;
  }
  return `<button type="button" class="primary" data-checkout="${esc(item.propertyId)}">辦理借出</button>`;
}

function openItem(propertyId) {
  const item = getItem(propertyId);
  if (!item) {
    toast('找不到對應財產', 'error');
    return;
  }
  const loan = currentLoanOf(item);
  const alert = item.returnAlert === 'damaged'
    ? '<div class="warn-banner danger">此財產最近歸還時有損壞，請管理者後續處理。</div>'
    : item.returnAlert === 'missing_parts'
      ? '<div class="warn-banner">此財產最近歸還時配件缺少，請管理者後續處理。</div>'
      : '';
  $('detailTitle').textContent = item.name;
  $('detailBody').innerHTML = `
    <div class="detail-photo"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
    ${alert}
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
        ['使用年限', Number.isFinite(item.serviceLife) ? `${item.serviceLife} 年` : '未提供'],
        ['廠商', displayValue(item.supplier)],
        ['廠牌', displayValue(item.brand)],
        ['型號', displayValue(item.model)],
        ['財產狀態', item.availabilityStatus === AVAILABILITY.LOST ? '異常' : displayValue(item.status)],
        ['借用狀態', item.availabilityLabel],
        ['目前借用人', loan && isOpenLoan(loan) ? loan.borrowerName : '—'],
        ['借出時間', loan && isOpenLoan(loan) ? formatDateTime(loan.checkedOutAt) : '—'],
        ['預計歸還時間', loan && isOpenLoan(loan) ? formatDateTime(loan.expectedReturnAt) : '—'],
        ['借用用途', loan && isOpenLoan(loan) ? loan.purpose : '—'],
        ['使用次數', String(item.useCount)],
        ['最後盤點時間', item.lastAuditAt ? formatDateTime(item.lastAuditAt) : '尚未盤點'],
        ['盤點狀態', item.auditStatus],
        ['備註', displayValue(item.note)]
      ].map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    <div class="action-grid">
      ${loanActionButtons(item)}
      <button type="button" class="secondary" data-usage="${esc(item.propertyId)}">現場使用登記</button>
      <button type="button" class="primary" data-audit="${esc(item.propertyId)}">執行盤點</button>
      <button type="button" class="secondary" data-location="${esc(item.propertyId)}">更新位置</button>
      <button type="button" class="secondary" data-image="${esc(item.propertyId)}">上傳圖片</button>
      <button type="button" class="secondary" data-history="${esc(item.propertyId)}">查看紀錄</button>
    </div>
    <div class="action-hint">
      <p><strong>辦理借出：</strong>物品會離開原存放地點，需要辦理歸還。</p>
      <p><strong>現場使用登記：</strong>物品未借離，只記錄一次使用。</p>
    </div>
  `;
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('detailDialog');
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
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('usageDialog');
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
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('auditDialog');
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
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('locationDialog');
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
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('imageDialog');
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
  if (state.historyTab === 'loan') {
    $('historyBody').innerHTML = historyListHTML(listLoans(id), '尚無借用紀錄', (log) => `
      <strong>${esc(log.id)} · ${esc(displayLoanStatus(log))}</strong>
      <div>${esc(log.borrowerName)}／${esc(log.borrowerDepartment)}</div>
      <div>${esc(formatDateTime(log.checkedOutAt))} → ${esc(log.returnedAt ? formatDateTime(log.returnedAt) : '尚未歸還')}</div>
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
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('historyDialog');
}

function readCheckoutForm() {
  return {
    propertyId: $('checkoutPropertyId').value,
    propertyName: $('checkoutPropertyName').value,
    borrowerName: $('checkoutBorrower').value,
    borrowerId: $('checkoutBorrowerId').value,
    borrowerDepartment: $('checkoutDept').value,
    checkedOutAt: $('checkoutAt').value,
    expectedReturnAt: $('checkoutDue').value,
    purpose: $('checkoutPurpose').value,
    checkoutOperator: $('checkoutOperator').value,
    checkoutCondition: $('checkoutCondition').value,
    note: $('checkoutNote').value
  };
}

function openCheckout(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  if (item.availabilityStatus !== AVAILABILITY.AVAILABLE) {
    toast(item.availabilityStatus === AVAILABILITY.MAINTENANCE ? '此財產維修中' : '此財產目前不可借用', 'error');
    return;
  }
  if (getOpenLoan(item.propertyId)) {
    toast('此財產已有未歸還紀錄，不可重複借出', 'error');
    return;
  }
  $('checkoutEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('checkoutPropertyId').value = item.propertyId;
  $('checkoutPropertyName').value = item.name;
  $('checkoutBorrower').value = '';
  $('checkoutBorrowerId').value = '';
  $('checkoutDept').value = '';
  $('checkoutAt').value = toInputDateTime();
  const due = new Date();
  due.setDate(due.getDate() + 1);
  $('checkoutDue').value = toInputDateTime(due);
  $('checkoutPurpose').value = '';
  $('checkoutOperator').value = '管理者';
  $('checkoutCondition').value = '';
  $('checkoutNote').value = '';
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('checkoutDialog');
}

function openCheckin(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  const loan = getOpenLoan(item.propertyId);
  if (!loan) {
    toast('找不到未歸還的借用紀錄', 'error');
    return;
  }
  $('checkinEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('checkinPropertyId').value = item.propertyId;
  $('checkinSummary').innerHTML = [
    ['財產名稱', item.name],
    ['財產編號', item.propertyId],
    ['借用人', loan.borrowerName],
    ['借出時間', formatDateTime(loan.checkedOutAt)],
    ['原定歸還時間', formatDateTime(loan.expectedReturnAt)],
    ['借用用途', loan.purpose]
  ].map(([k, v]) => `<div><strong>${esc(k)}：</strong>${esc(v)}</div>`).join('');
  $('checkinAt').value = toInputDateTime();
  $('checkinOperator').value = '管理者';
  $('checkinCondition').value = '';
  $('checkinLocation').value = item.location || '';
  $('checkinNote').value = '';
  document.querySelectorAll('input[name="checkinResult"]').forEach((el) => { el.checked = false; });
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('checkinDialog');
}

function openLoanDetail(loanId) {
  const loan = getLoan(loanId);
  if (!loan) {
    toast('找不到借用紀錄', 'error');
    return;
  }
  $('loanDetailTitle').textContent = loan.id;
  $('loanDetailBody').innerHTML = `<dl>${[
    ['借用編號', loan.id],
    ['財產名稱', loan.propertyName],
    ['財產編號', loan.propertyId],
    ['借用人', loan.borrowerName],
    ['學號或教職員編號', loan.borrowerId],
    ['借用單位', loan.borrowerDepartment],
    ['借出時間', formatDateTime(loan.checkedOutAt)],
    ['預計歸還時間', formatDateTime(loan.expectedReturnAt)],
    ['實際歸還時間', loan.returnedAt ? formatDateTime(loan.returnedAt) : '尚未歸還'],
    ['借用用途', loan.purpose],
    ['借出方式', checkoutMethodLabel(loan)],
    ['借出經手人', loan.checkoutOperator],
    ['歸還經手人', loan.returnOperator || '—'],
    ['借出時狀況', displayValue(loan.checkoutCondition)],
    ['歸還時狀況', displayValue(loan.returnCondition)],
    ['借用狀態', displayLoanStatus(loan)],
    ['歸還結果', loan.returnResult || '—'],
    ['歸還位置', loan.returnLocation || '—'],
    ['備註', displayValue(loan.note)]
  ].map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  openExclusiveDialog('loanDetailDialog');
}

function askLocationConfirm(propertyId, fromLocation, toLocation) {
  $('confirmPropertyId').value = propertyId;
  $('confirmFrom').value = fromLocation;
  $('confirmTo').value = toLocation;
  $('confirmText').textContent = `系統登記位置為 ${fromLocation}，本次實際位置為 ${toLocation}。原位置不會自動覆蓋，是否確認更新？`;
  openExclusiveDialog('confirmDialog');
}

function openScan() {
  $('scanCode').value = '';
  $('scanError').textContent = '';
  openExclusiveDialog('scanDialog');
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
  toast(`已找到「${item.name}」，目前狀態：${item.availabilityLabel}`);
}

function afterMutation(propertyId, message) {
  render();
  if (propertyId) {
    state.returnToDetailId = propertyId;
    openItem(propertyId);
  }
  toast(message);
}

function restoreDetailAfterClose(closedId) {
  if (isSwitchingDialogs()) return;
  if (closedId === 'detailDialog' || closedId === 'scanDialog' || closedId === 'loanDetailDialog' || closedId === 'appConfirmDialog') return;
  if (closedId === 'checkoutConfirmDialog') {
    if (state.pendingCheckout) openExclusiveDialog('checkoutDialog');
    else if (state.returnToDetailId) openItem(state.returnToDetailId);
    return;
  }
  const shouldRestore = [
    'checkoutDialog', 'checkinDialog', 'usageDialog', 'auditDialog',
    'locationDialog', 'imageDialog', 'historyDialog', 'confirmDialog'
  ].includes(closedId);
  if (shouldRestore && state.returnToDetailId) openItem(state.returnToDetailId);
}

function downloadCsv() {
  const csv = exportLoansCsv(filteredHistoryLoans());
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `借用紀錄-${formatDate(new Date().toISOString())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('已匯出借用紀錄 CSV');
}

function bindEvents() {
  bindDialogBehavior(restoreDetailAfterClose);
  bindConfirmDialog();
  bindSelfService({ onChanged: () => render() });
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) {
      closeDialog(closer.dataset.close);
      return;
    }
    const selfBtn = event.target.closest('[data-self]');
    if (selfBtn) {
      setView('selfService');
      openSelfMode(selfBtn.dataset.self);
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
    const checkoutBtn = event.target.closest('[data-checkout]');
    if (checkoutBtn) {
      openCheckout(checkoutBtn.dataset.checkout);
      return;
    }
    const checkinBtn = event.target.closest('[data-checkin]');
    if (checkinBtn) {
      openCheckin(checkinBtn.dataset.checkin);
      return;
    }
    const loanDetailBtn = event.target.closest('[data-loan-detail]');
    if (loanDetailBtn) {
      openLoanDetail(loanDetailBtn.dataset.loanDetail);
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
      const key = {
        audit: 'auditPage',
        usage: 'usagePage',
        loans: 'loanPage',
        loanHistory: 'loanHistoryPage',
        inventory: 'page'
      }[target] || 'page';
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
  $('reloadBtn').addEventListener('click', () => window.location.reload());

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
    $('filterAvailability').value = '';
    $('filterDept').value = '';
    $('filterSort').value = 'propertyId';
    state.page = 1;
    renderInventory();
    toast('已清除篩選');
  });

  $('loanFilterForm').addEventListener('submit', (event) => event.preventDefault());
  $('loanFilterForm').addEventListener('input', () => { state.loanPage = 1; renderLoans(); });
  $('loanFilterForm').addEventListener('change', () => { state.loanPage = 1; renderLoans(); });
  $('clearLoanFilters').addEventListener('click', () => {
    $('loanQuery').value = '';
    $('loanStatusFilter').value = 'open';
    state.loanPage = 1;
    renderLoans();
    toast('已清除篩選');
  });

  $('loanHistoryForm').addEventListener('submit', (event) => event.preventDefault());
  $('loanHistoryForm').addEventListener('input', () => { state.loanHistoryPage = 1; renderLoanHistory(); });
  $('loanHistoryForm').addEventListener('change', () => { state.loanHistoryPage = 1; renderLoanHistory(); });
  $('clearHistFilters').addEventListener('click', () => {
    $('histQuery').value = '';
    $('histProperty').value = '';
    $('histBorrower').value = '';
    $('histStatus').value = '';
    $('histFrom').value = '';
    $('histTo').value = '';
    state.loanHistoryPage = 1;
    renderLoanHistory();
    toast('已清除篩選');
  });
  $('exportCsvBtn').addEventListener('click', downloadCsv);

  $('checkoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = readCheckoutForm();
    try {
      if (new Date(data.expectedReturnAt) < new Date(data.checkedOutAt)) {
        throw new Error('預計歸還時間不得早於借出時間');
      }
      state.pendingCheckout = data;
      $('checkoutConfirmBody').innerHTML = [
        ['財產', `${data.propertyName}（${data.propertyId}）`],
        ['借用人', `${data.borrowerName}／${data.borrowerId}`],
        ['單位', data.borrowerDepartment],
        ['借出時間', formatDateTime(new Date(data.checkedOutAt).toISOString())],
        ['預計歸還', formatDateTime(new Date(data.expectedReturnAt).toISOString())],
        ['用途', data.purpose],
        ['經手人', data.checkoutOperator]
      ].map(([k, v]) => `<div><strong>${esc(k)}：</strong>${esc(v)}</div>`).join('');
      openExclusiveDialog('checkoutConfirmDialog');
    } catch (error) {
      toast(error.message || '請完整填寫借出資料', 'error');
    }
  });

  $('checkoutConfirmForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const btn = event.submitter || $('checkoutConfirmForm').querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (!state.pendingCheckout) throw new Error('找不到待確認的借出資料');
      const { item } = checkout({
        ...state.pendingCheckout,
        checkoutMethod: CHECKOUT_METHOD.ADMIN
      });
      state.pendingCheckout = null;
      closeDialog('checkoutConfirmDialog', { silent: true });
      closeDialog('checkoutDialog', { silent: true });
      afterMutation(item.propertyId, '已完成借出，使用次數已更新');
    } catch (error) {
      toast(error.message || '借出失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('checkinForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const result = document.querySelector('input[name="checkinResult"]:checked')?.value;
      const outcome = checkin({
        propertyId: $('checkinPropertyId').value,
        returnedAt: $('checkinAt').value,
        returnOperator: $('checkinOperator').value,
        returnCondition: $('checkinCondition').value,
        returnLocation: $('checkinLocation').value,
        returnResult: result,
        note: $('checkinNote').value
      });
      closeDialog('checkinDialog', { silent: true });
      let message = '已完成歸還';
      if (result === RETURN_RESULT.REPAIR) message = '已歸還並改為維修中';
      if (result === RETURN_RESULT.LOST) message = '已登記遺失，財產狀態改為異常';
      if (result === RETURN_RESULT.DAMAGED) message = '已歸還，請注意此財產有損壞';
      if (result === RETURN_RESULT.MISSING_PARTS) message = '已歸還，請注意配件缺少';
      afterMutation(outcome.item.propertyId, message);
    } catch (error) {
      toast(error.message || '歸還失敗', 'error');
    }
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
      closeDialog('usageDialog', { silent: true });
      afterMutation(item.propertyId, '已完成現場使用登記，使用次數已更新');
    } catch (error) {
      toast(error.message || '現場使用登記失敗', 'error');
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
      closeDialog('auditDialog', { silent: true });
      afterMutation(outcome.item.propertyId, '盤點結果已儲存');
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
      closeDialog('locationDialog', { silent: true });
      afterMutation(item.propertyId, '位置已更新，並已建立異動紀錄');
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
      closeDialog('confirmDialog', { silent: true });
      afterMutation($('confirmPropertyId').value, '已確認更新位置');
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
      closeDialog('imageDialog', { silent: true });
      afterMutation(item.propertyId, '圖片已儲存');
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

  const showTestResult = (result) => {
    const box = $('loanTestResult');
    box.hidden = false;
    box.innerHTML = `
      <p><strong>${result.ok ? '測試通過' : '測試未通過'}</strong>${result.propertyId ? ` · 測試財產 ${esc(result.propertyId)}` : ''}${result.loanId ? ` · ${esc(result.loanId)}` : ''}</p>
      ${result.steps.map((step) => `<div class="feed-item"><strong>${esc(step.name)}</strong><div class="muted">${esc(step.detail || '')}</div></div>`).join('')}
    `;
    toast(result.ok ? '流程測試通過，測試資料已還原' : (result.error || '流程測試未通過'), result.ok ? 'ok' : 'error');
  };

  $('runLoanTestBtn').addEventListener('click', () => {
    const box = $('loanTestResult');
    box.hidden = false;
    box.innerHTML = '<p class="muted">測試進行中…</p>';
    try {
      const result = runLoanLifecycleTest();
      render();
      showTestResult(result);
    } catch (error) {
      box.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
      toast(error.message || '測試失敗', 'error');
    }
  });
  $('runSelfServiceTestBtn').addEventListener('click', () => {
    const box = $('loanTestResult');
    box.hidden = false;
    box.innerHTML = '<p class="muted">測試進行中…</p>';
    try {
      const result = runSelfServiceFlowTest();
      render();
      showTestResult(result);
    } catch (error) {
      box.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
      toast(error.message || '測試失敗', 'error');
    }
  });

  $('exportTestDataBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportOperationalJson(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hkproperty-test-data-${formatDate(new Date().toISOString())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('已匯出測試資料 JSON');
  });
  $('importTestDataInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      importOperationalJson(payload);
      render();
      toast('已匯入測試資料');
    } catch (error) {
      toast(error.message || '匯入失敗，請確認 JSON 格式', 'error');
    }
  });
  $('clearTestDataBtn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '清除測試資料',
      text: '將清除借用、使用、圖片、盤點及位置異動紀錄，並讓全部財產恢復可借用。390 筆原始財產清冊不會被刪除。此操作無法復原。',
      confirmLabel: '確認清除',
      cancelLabel: '取消'
    });
    if (!ok) return;
    clearOperationalData();
    render();
    toast(`測試資料已清除，財產清冊仍為 ${listItems().length} 筆`);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('notifyPanel').hidden = true;
      $('sidebar').classList.remove('open');
      $('sidebarBackdrop').hidden = true;
    }
  });
}

function showLoadError(message) {
  setLoading(false);
  $('loadError').hidden = false;
  $('loadErrorText').textContent = message;
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
}

async function init() {
  bindEvents();
  $('loadError').hidden = true;
  setLoading(true, '正在載入財產清冊…');
  try {
    await loadCatalog();
    refreshOverdueStatus();
    refreshFilterOptions();
    setLoading(false);
    $('loadError').hidden = true;
    setView('dashboard');
    toast(`已載入 ${listItems().length} 筆財產`);
  } catch (error) {
    showLoadError(error.message || '無法載入財產清冊，請重新載入。');
    toast(error.message || '載入失敗', 'error');
  }
}

init();
