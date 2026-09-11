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
import { parseScanPayload, readAssetDeepLink, startCameraScan, stopCameraScan } from './scanner.js';
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
import { addUsage, listUsage, loadUsage } from '../services/usageService.js';
import { addAudit, confirmLocationUpdate, listAudits, listLocationChanges, loadAudits, loadLocationHistory } from '../services/auditService.js';
import {
  CHECKOUT_METHOD,
  RETURN_RESULT,
  approveLoan,
  checkin,
  checkout,
  checkoutMethodLabel,
  completeCheckout,
  currentLoanOf,
  displayLoanStatus,
  exportLoansCsv,
  getLoan,
  getLoanDashboardStats,
  getOpenLoan,
  getSettings,
  isDueToday,
  isDueWithinHours,
  isLoanOverdue,
  isOpenLoan,
  listLoans,
  loadLoans,
  loadOperationLogs,
  loadSettings,
  overdueDuration,
  refreshOverdueStatus,
  rejectLoan,
  saveSettings
} from '../services/loanService.js';
import {
  adminUpdateProfile,
  getProfile,
  initAuth,
  isAdmin,
  isStaff,
  listProfiles,
  registerWithPassword,
  roleLabel,
  sendLoginOtp,
  enterDemoSession,
  isDemoMode,
  signInWithPassword,
  signOut,
  updateMyProfile,
  verifyEmailOtp
} from '../services/authService.js';
import {
  approveReservation,
  cancelReservation,
  createReservation,
  listManageReservations,
  listMyReservations,
  loadReservations,
  rejectReservation
} from '../services/reservationService.js';
import { clearLegacyLocalData, detectLegacyLocalData } from '../services/legacyLocalData.js';
import {
  backendStatusLabel,
  getBackendStatus,
  isFormalPocketBaseMode,
  markDemoBackend,
  probePocketBase,
  requirePocketBaseReady
} from '../services/backendStatus.js';

const PAGE_META = {
  dashboard: ['財產管理', '系統總覽'],
  selfService: ['自助服務', '自助借還'],
  inventory: ['財產查詢', '財產清冊'],
  loans: ['借用作業', '借出管理'],
  loanHistory: ['借用作業', '借用紀錄'],
  myReservations: ['借用作業', '我的預借'],
  reservations: ['借用作業', '預借管理'],
  audit: ['盤點作業', '盤點作業'],
  usage: ['使用管理', '使用紀錄'],
  locations: ['位置資料', '位置管理'],
  logs: ['系統維護', '操作紀錄'],
  users: ['系統維護', '使用者管理'],
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

async function refreshData() {
  if (!isDemoMode()) requirePocketBaseReady();
  await Promise.all([
    loadCatalog(),
    loadLoans(),
    loadSettings(),
    loadUsage(),
    loadAudits(),
    loadLocationHistory(),
    loadReservations().catch((error) => {
      if (!isDemoMode()) throw error;
      return [];
    })
  ]);
  refreshOverdueStatus();
}

function updateBackendStatusUi() {
  const status = getBackendStatus();
  const label = backendStatusLabel(status);
  const detail = status.message ? `${label}｜${status.message}` : label;
  const banner = $('backendStatusBanner');
  const text = $('backendStatusText');
  if (banner && text) {
    banner.dataset.mode = status.mode;
    text.textContent = detail;
  }
  const authStatus = $('authBackendStatus');
  if (authStatus) {
    authStatus.dataset.mode = status.mode;
    authStatus.textContent = detail;
  }
  if ($('demoBanner')) $('demoBanner').hidden = status.mode !== 'demo';
}

function applyRoleNav() {
  const demo = isDemoMode();
  const staff = isStaff();
  const admin = isAdmin();
  document.querySelectorAll('[data-min-role]').forEach((el) => {
    const need = el.dataset.minRole;
    const ok = need === 'admin' ? admin : staff;
    el.hidden = !ok;
  });
  const profile = getProfile();
  $('userName').textContent = profile?.display_name || '使用者';
  $('userRole').textContent = demo ? `${roleLabel(profile?.role)}（測試）` : roleLabel(profile?.role);
  $('userAvatar').textContent = (profile?.display_name || '用').slice(0, 1);
  $('logoutBtn').hidden = !profile;
  document.body.classList.toggle('borrower-view', Boolean(profile) && !staff);
  if ($('sideFoot')) {
    $('sideFoot').textContent = demo
      ? '測試模式：資料只存在此瀏覽器，關閉分頁後會消失'
      : isFormalPocketBaseMode()
        ? '正式模式：借用／預借／使用／歸還會寫入 PocketBase'
        : '資料儲存在雲端資料庫，可在不同裝置同步';
  }
  updateBackendStatusUi();
}

function showAuthGate(on) {
  $('authGate').hidden = !on;
  $('main').hidden = on;
  document.querySelector('.sidebar')?.classList.toggle('signed-out', on);
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
    ['待核准', stats.approvalPending, '件'],
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
  const staff = isStaff();
  state.page = data.page;
  const colSpan = staff ? 13 : 8;
  if (!data.total) {
    $('inventoryBody').innerHTML = `<tr><td colspan="${colSpan}"><div class="empty">找不到符合條件的財產</div></td></tr>`;
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
      ${staff ? `<td>${esc(displayValue(item.custodian))}</td>` : ''}
      <td>${item.useCount}</td>
      <td><span class="badge">${esc(displayValue(item.status))}</span></td>
      ${staff ? `<td><span class="badge ${auditStatusClass(item.auditStatus)}">${esc(item.auditStatus)}</span></td>` : ''}
      <td>${availabilityBadge(item)}</td>
      ${staff ? `<td>${esc(loanBorrowerText(item))}</td>` : ''}
      ${staff ? `<td>${esc(loanDueText(item))}</td>` : ''}
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
        <div class="meta-row">${staff ? `<span>${esc(displayValue(item.custodian))}</span>` : '<span></span>'}<span>使用 ${item.useCount} 次</span></div>
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
        ${loan.rawStatus === 'pending' ? `
          <button type="button" class="primary" data-approve="${esc(loan.id)}">核准</button>
          <button type="button" class="secondary" data-reject="${esc(loan.id)}">拒絕</button>
        ` : loan.rawStatus === 'approved' ? `
          <button type="button" class="primary" data-complete-checkout="${esc(loan.id)}">辦理借出</button>
        ` : `
          <button type="button" class="primary" data-checkin="${esc(loan.propertyId)}">辦理歸還</button>
        `}
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
    ['待核准', stats.approvalPending || loanStats.pending, '件'],
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
  let loans = [];

  if (mode === 'pending') {
    title = '待核准申請';
    loans = listLoans().filter((loan) => loan.rawStatus === 'pending');
  } else if (mode === 'available' || mode === 'maintenance') {
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

  if (mode !== 'pending') {
    loans = listLoans().filter((loan) => isOpenLoan(loan));
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
    if (status === 'pending' && shown !== '待核准') return false;
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
  const profile = getProfile();
  if ($('profileName')) $('profileName').value = profile?.display_name || '';
  if ($('profileSchool')) $('profileSchool').value = profile?.school_number || '';
  if ($('profileDept')) $('profileDept').value = profile?.department || '';
  const settings = getSettings();
  $('systemSettingsPanel').hidden = !isAdmin();
  if (isAdmin()) {
    $('settingRequireApproval').checked = Boolean(settings.require_loan_approval);
    $('settingAllowSelf').checked = Boolean(settings.allow_self_checkout);
    $('settingLoanDays').value = settings.default_loan_days || 1;
  }
  const legacy = detectLegacyLocalData();
  $('legacyDataText').textContent = legacy.found
    ? `偵測到舊版測試資料（約 ${(legacy.bytes / 1024).toFixed(1)} KB）。可清除本機資料，不會上傳到雲端。`
    : '沒有偵測到舊版 localStorage 測試資料。';
}

async function renderUsers() {
  if (!isAdmin()) {
    $('userManageList').innerHTML = '<div class="empty">只有管理者可以管理使用者</div>';
    return;
  }
  try {
    const rows = await listProfiles();
    $('userManageList').innerHTML = rows.map((row) => `
      <div class="audit-item">
        <div>
          <strong>${esc(row.display_name || '未命名')}</strong>
          <div class="muted">${esc(row.school_number || '未填學號')} · ${esc(row.department || '未填單位')}</div>
          <div class="muted">${row.is_active ? '啟用中' : '已停用'}</div>
        </div>
        <select data-role-user="${esc(row.id)}">
          <option value="borrower" ${row.role === 'borrower' ? 'selected' : ''}>借用人</option>
          <option value="staff" ${row.role === 'staff' ? 'selected' : ''}>經辦人員</option>
          <option value="admin" ${row.role === 'admin' ? 'selected' : ''}>管理者</option>
        </select>
        <button type="button" class="secondary" data-toggle-user="${esc(row.id)}" data-active="${row.is_active ? '1' : '0'}">${row.is_active ? '停用' : '啟用'}</button>
      </div>
    `).join('') || '<div class="empty">尚無使用者</div>';
  } catch (error) {
    $('userManageList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

async function renderLogs() {
  if (!isStaff()) {
    $('operationLogList').innerHTML = '<div class="empty">沒有權限查看操作紀錄</div>';
    return;
  }
  try {
    const rows = await loadOperationLogs();
    $('operationLogList').innerHTML = rows.length
      ? rows.map((row) => `
        <div class="log-item">
          <div>
            <strong>${esc(row.action)}</strong>
            <div class="muted">${esc(row.actor_name || '系統')} · ${esc(formatDateTime(row.created_at))}</div>
            <div class="muted">${esc(JSON.stringify(row.detail || {}))}</div>
          </div>
        </div>
      `).join('')
      : '<div class="empty">尚無操作紀錄</div>';
  } catch (error) {
    $('operationLogList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
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
  if (state.view === 'myReservations') renderMyReservations();
  if (state.view === 'reservations') renderReservationManage();
  if (state.view === 'audit') renderAuditPage();
  if (state.view === 'usage') renderUsagePage();
  if (state.view === 'locations') renderLocations();
  if (state.view === 'logs') renderLogs();
  if (state.view === 'users') renderUsers();
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
  const staff = isStaff();
  const alert = item.returnAlert === 'damaged'
    ? '<div class="warn-banner danger">此財產最近歸還時有損壞，請管理者後續處理。</div>'
    : item.returnAlert === 'missing_parts'
      ? '<div class="warn-banner">此財產最近歸還時配件缺少，請管理者後續處理。</div>'
      : '';
  const canReserve = item.availabilityStatus === AVAILABILITY.AVAILABLE
    || item.availabilityStatus === AVAILABILITY.RESERVED;
  const fields = [
        ['財產名稱', item.name],
        ['財產編號', item.propertyId],
        ['目前位置', displayValue(item.location)],
        ['保管單位', displayValue(item.department)],
        staff ? ['保管人', displayValue(item.custodian)] : null,
        ['規格', displayValue(item.specification)],
        ['單位', displayValue(item.unit)],
        staff ? ['單價', formatPrice(item.price)] : null,
        staff ? ['購買日期', formatDate(item.purchaseDate)] : null,
        staff ? ['使用年限', Number.isFinite(item.serviceLife) ? `${item.serviceLife} 年` : '未提供'] : null,
        staff ? ['供應商', displayValue(item.supplier)] : null,
        ['廠牌', displayValue(item.brand)],
        ['型號', displayValue(item.model)],
        ['財產狀態', item.availabilityStatus === AVAILABILITY.LOST ? '異常' : displayValue(item.status)],
        ['借用狀態', item.availabilityLabel],
        staff ? ['目前借用人', loan && isOpenLoan(loan) ? loan.borrowerName : '—'] : null,
        ['借出時間', loan && isOpenLoan(loan) ? formatDateTime(loan.checkedOutAt) : '—'],
        ['預計歸還時間', loan && isOpenLoan(loan) ? formatDateTime(loan.expectedReturnAt) : '—'],
        ['借用用途', loan && isOpenLoan(loan) ? loan.purpose : '—'],
        ['使用次數', String(item.useCount)],
        staff ? ['最後盤點時間', item.lastAuditAt ? formatDateTime(item.lastAuditAt) : '尚未盤點'] : null,
        staff ? ['盤點狀態', item.auditStatus] : null,
        staff ? ['內部備註', displayValue(item.note)] : null
      ].filter(Boolean);
  $('detailTitle').textContent = item.name || '財產';
  $('detailBody').innerHTML = `
    <div class="detail-photo"><img src="${esc(imageOf(item))}" alt="${esc(item.name)}"></div>
    ${alert}
    <dl>
      ${fields.map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    <div class="action-grid">
      ${staff ? loanActionButtons(item) : `<button type="button" class="primary" data-self="borrow">前往自助借用</button>`}
      ${canReserve ? `<button type="button" class="secondary" data-reserve="${esc(item.propertyId)}">預約借用</button>` : ''}
      ${staff ? `<button type="button" class="secondary" data-usage="${esc(item.propertyId)}">現場使用登記</button>
      <button type="button" class="primary" data-audit="${esc(item.propertyId)}">執行盤點</button>
      <button type="button" class="secondary" data-location="${esc(item.propertyId)}">更新位置</button>
      <button type="button" class="secondary" data-image="${esc(item.propertyId)}">上傳圖片</button>
      <button type="button" class="secondary" data-history="${esc(item.propertyId)}">查看紀錄</button>` : ''}
    </div>
    <div class="action-hint">
      <p><strong>辦理借出：</strong>物品會離開原存放地點，需要辦理歸還；借出成功才增加使用次數。</p>
      <p><strong>預約借用：</strong>僅鎖定時段，申請本身不增加使用次數。</p>
      <p><strong>現場使用登記：</strong>物品未借離，只記錄一次使用並增加一次使用次數。</p>
    </div>
  `;
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('detailDialog');
}

function openReservation(propertyId) {
  const item = getItem(propertyId);
  if (!item) return;
  $('reservationPropertyId').value = item.propertyId;
  $('reservationEyebrow').textContent = `${item.name} · ${item.propertyId}`;
  $('reservationPurpose').value = '';
  $('reservationStart').value = toInputDateTime();
  const end = new Date();
  end.setDate(end.getDate() + 1);
  $('reservationEnd').value = toInputDateTime(end);
  $('reservationContact').value = getProfile()?.email || '';
  $('reservationNote').value = '';
  state.returnToDetailId = item.propertyId;
  openExclusiveDialog('reservationDialog');
}

function reservationCardHTML(row, { manage = false } = {}) {
  const mine = getProfile()?.id && row.userId === getProfile().id;
  return `
    <div class="audit-item">
      <strong>${esc(row.propertyName)} · ${esc(row.propertyId)}</strong>
      <div class="meta-row">
        <span class="badge">${esc(row.statusLabel)}</span>
        <span>${esc(row.id)}</span>
      </div>
      <div>${esc(formatDateTime(row.startAt))} → ${esc(formatDateTime(row.endAt))}</div>
      <div>用途：${esc(row.purpose)}${row.userName ? ` · ${esc(row.userName)}` : ''}</div>
      ${row.rejectionReason ? `<div class="muted">拒絕原因：${esc(row.rejectionReason)}</div>` : ''}
      <div class="card-actions">
        ${mine && ['pending', 'approved'].includes(row.status)
          ? `<button type="button" class="secondary" data-cancel-reservation="${esc(row.recordId)}">取消預借</button>`
          : ''}
        ${manage && row.status === 'pending'
          ? `<button type="button" class="primary" data-approve-reservation="${esc(row.recordId)}">核准</button>
             <button type="button" class="danger" data-reject-reservation="${esc(row.recordId)}">拒絕</button>`
          : ''}
        <button type="button" class="link-btn" data-open-item="${esc(row.propertyId)}">查看財產</button>
      </div>
    </div>
  `;
}

function renderMyReservations() {
  const rows = listMyReservations();
  $('myReservationList').innerHTML = rows.length
    ? rows.map((row) => reservationCardHTML(row)).join('')
    : '<div class="empty">尚無預借申請</div>';
}

function renderReservationManage() {
  const rows = listManageReservations();
  $('reservationManageList').innerHTML = rows.length
    ? rows.map((row) => reservationCardHTML(row, { manage: true })).join('')
    : '<div class="empty">目前沒有待處理的預借</div>';
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

async function resetScanCameraUi() {
  await stopCameraScan();
  if ($('scanCameraPanel')) $('scanCameraPanel').hidden = true;
  if ($('scanVideo')) {
    $('scanVideo').hidden = false;
    $('scanVideo').srcObject = null;
  }
  if ($('scanFallback')) $('scanFallback').innerHTML = '';
  if ($('scanEngineText')) $('scanEngineText').textContent = '';
}

function openScan() {
  resetScanCameraUi();
  $('scanCode').value = '';
  $('scanError').textContent = '';
  if ($('scanHint')) {
    $('scanHint').textContent = '啟用相機掃描 QR；若拒絕權限，可改以手動輸入財產編號。';
  }
  openExclusiveDialog('scanDialog');
}

function lookupScan(raw) {
  const code = parseScanPayload(raw);
  const item = findByPropertyId(code);
  if (!item) {
    if ($('scanError')) $('scanError').textContent = `找不到財產編號「${code}」，請確認後再試。`;
    toast('找不到對應財產', 'error');
    return false;
  }
  resetScanCameraUi();
  closeDialog('scanDialog');
  $('filterQuery').value = code;
  state.page = 1;
  setView('inventory');
  openItem(item.propertyId);
  toast(`已找到「${item.name}」，目前狀態：${item.availabilityLabel}`);
  return true;
}

async function afterMutation(propertyId, message) {
  await refreshData();
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
    'locationDialog', 'imageDialog', 'historyDialog', 'confirmDialog', 'reservationDialog'
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
  bindSelfService({
    onChanged: async () => {
      await refreshData();
      render();
    }
  });
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
    const approveBtn = event.target.closest('[data-approve]');
    if (approveBtn) {
      confirmAction({
        title: '核准借用申請',
        text: '確定核准此筆借用申請？',
        confirmLabel: '確認核准'
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await approveLoan(approveBtn.dataset.approve);
          await afterMutation(null, '已核准借用申請');
        } catch (error) {
          toast(error.message || '核准失敗', 'error');
        }
      });
      return;
    }
    const rejectBtn = event.target.closest('[data-reject]');
    if (rejectBtn) {
      $('rejectLoanId').value = rejectBtn.dataset.reject;
      $('rejectReason').value = '';
      openExclusiveDialog('rejectDialog');
      return;
    }
    const completeBtn = event.target.closest('[data-complete-checkout]');
    if (completeBtn) {
      completeCheckout(completeBtn.dataset.completeCheckout)
        .then((result) => afterMutation(result.item.propertyId, '已完成借出'))
        .catch((error) => toast(error.message || '借出失敗', 'error'));
      return;
    }
    const toggleUser = event.target.closest('[data-toggle-user]');
    if (toggleUser) {
      const active = toggleUser.dataset.active === '1';
      confirmAction({
        title: active ? '停用使用者' : '啟用使用者',
        text: active ? '停用後此帳號將無法登入。' : '確定重新啟用此帳號？',
        confirmLabel: active ? '確認停用' : '確認啟用'
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await adminUpdateProfile({ id: toggleUser.dataset.toggleUser, isActive: !active });
          await renderUsers();
          toast(active ? '已停用使用者' : '已啟用使用者');
        } catch (error) {
          toast(error.message || '更新失敗', 'error');
        }
      });
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
    const reserveBtn = event.target.closest('[data-reserve]');
    if (reserveBtn) {
      openReservation(reserveBtn.dataset.reserve);
      return;
    }
    const cancelRsv = event.target.closest('[data-cancel-reservation]');
    if (cancelRsv) {
      cancelReservation(cancelRsv.dataset.cancelReservation)
        .then(() => {
          render();
          toast('已取消預借');
        })
        .catch((error) => toast(error.message || '取消失敗', 'error'));
      return;
    }
    const approveRsv = event.target.closest('[data-approve-reservation]');
    if (approveRsv) {
      approveReservation(approveRsv.dataset.approveReservation)
        .then(() => {
          render();
          toast('已核准預借');
        })
        .catch((error) => toast(error.message || '核准失敗', 'error'));
      return;
    }
    const rejectRsv = event.target.closest('[data-reject-reservation]');
    if (rejectRsv) {
      const reason = window.prompt('請輸入拒絕原因');
      if (!reason) return;
      rejectReservation(rejectRsv.dataset.rejectReservation, reason)
        .then(() => {
          render();
          toast('已拒絕預借');
        })
        .catch((error) => toast(error.message || '拒絕失敗', 'error'));
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

  $('checkoutConfirmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = event.submitter || $('checkoutConfirmForm').querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (!state.pendingCheckout) throw new Error('找不到待確認的借出資料');
      const { item } = await checkout({
        ...state.pendingCheckout,
        checkoutMethod: CHECKOUT_METHOD.ADMIN
      });
      state.pendingCheckout = null;
      closeDialog('checkoutConfirmDialog', { silent: true });
      closeDialog('checkoutDialog', { silent: true });
      await afterMutation(item.propertyId, '已完成借出，使用次數已更新');
    } catch (error) {
      toast(error.message || '借出失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('checkinForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = event.submitter || $('checkinForm').querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const result = document.querySelector('input[name="checkinResult"]:checked')?.value;
      const outcome = await checkin({
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
      await afterMutation(outcome.item.propertyId, message);
    } catch (error) {
      toast(error.message || '歸還失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('usageForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const { item } = await addUsage({
        propertyId: $('usagePropertyId').value,
        userName: $('usageUser').value,
        department: $('usageDept').value,
        usedAt: $('usageAt').value,
        purpose: $('usagePurpose').value,
        note: $('usageNote').value
      });
      closeDialog('usageDialog', { silent: true });
      await afterMutation(item.propertyId, '已完成現場使用登記，使用次數已更新');
    } catch (error) {
      toast(error.message || '現場使用登記失敗', 'error');
    }
  });

  $('auditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = document.querySelector('input[name="auditResult"]:checked')?.value;
      const outcome = await addAudit({
        propertyId: $('auditPropertyId').value,
        registeredLocation: $('auditRegistered').value,
        actualLocation: $('auditActual').value,
        result,
        auditor: $('auditPerson').value,
        auditedAt: $('auditAt').value,
        note: $('auditNote').value
      });
      closeDialog('auditDialog', { silent: true });
      await afterMutation(outcome.item.propertyId, '盤點結果已儲存');
      if (outcome.needsLocationConfirm) {
        askLocationConfirm(outcome.item.propertyId, outcome.entry.registeredLocation, outcome.entry.actualLocation);
      }
    } catch (error) {
      toast(error.message || '盤點失敗', 'error');
    }
  });

  $('locationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const { item } = await confirmLocationUpdate({
        propertyId: $('locationPropertyId').value,
        fromLocation: $('locationCurrent').value,
        toLocation: $('locationNext').value,
        operator: $('locationOperator').value,
        reason: $('locationReason').value
      });
      closeDialog('locationDialog', { silent: true });
      await afterMutation(item.propertyId, '位置已更新，並已建立異動紀錄');
    } catch (error) {
      toast(error.message || '位置更新失敗', 'error');
    }
  });

  $('confirmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await confirmLocationUpdate({
        propertyId: $('confirmPropertyId').value,
        fromLocation: $('confirmFrom').value,
        toLocation: $('confirmTo').value,
        operator: '管理者',
        reason: '盤點後確認更新位置'
      });
      closeDialog('confirmDialog', { silent: true });
      await afterMutation($('confirmPropertyId').value, '已確認更新位置');
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
      $('imageError').textContent = '檔案大小不可超過 5 MB';
      toast('檔案過大，請重新選擇', 'error');
      return;
    }
    state.pendingImage = file;
    $('imagePreview').src = URL.createObjectURL(file);
    $('imageSaveBtn').disabled = false;
  });

  $('imageForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.pendingImage) {
      $('imageError').textContent = '請先選擇圖片';
      return;
    }
    try {
      const item = await saveImage($('imagePropertyId').value, state.pendingImage);
      closeDialog('imageDialog', { silent: true });
      await afterMutation(item.propertyId, '圖片已儲存');
    } catch (error) {
      toast(error.message || '圖片儲存失敗', 'error');
    }
  });

  $('scanForm').addEventListener('submit', (event) => {
    event.preventDefault();
    lookupScan($('scanCode').value);
  });
  $('cameraScanBtn').addEventListener('click', async () => {
    $('scanError').textContent = '';
    try {
      $('scanCameraPanel').hidden = false;
      $('scanVideo').hidden = false;
      $('scanFallback').innerHTML = '';
      const result = await startCameraScan({
        videoEl: $('scanVideo'),
        fallbackContainerId: 'scanFallback',
        onDetected: (propertyId) => {
          $('scanCode').value = propertyId;
          lookupScan(propertyId);
        }
      });
      if ($('scanEngineText')) {
        $('scanEngineText').textContent = result?.engine === 'BarcodeDetector'
          ? '掃描引擎：BarcodeDetector'
          : '掃描引擎：html5-qrcode';
      }
      if (result?.engine === 'html5-qrcode') {
        $('scanVideo').hidden = true;
      }
    } catch (error) {
      await resetScanCameraUi();
      $('scanError').textContent = error.message;
      toast(error.message, 'error');
      $('scanCode').focus();
    }
  });
  $('stopCameraBtn')?.addEventListener('click', async () => {
    await resetScanCameraUi();
  });
  document.getElementById('scanDialog')?.addEventListener('close', () => {
    resetScanCameraScanSafe();
  });

  function resetScanCameraScanSafe() {
    resetScanCameraUi().catch(() => {});
  }

  $('reservationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = event.submitter;
    if (btn) btn.disabled = true;
    try {
      await createReservation({
        propertyId: $('reservationPropertyId').value,
        purpose: $('reservationPurpose').value,
        startAt: $('reservationStart').value,
        endAt: $('reservationEnd').value,
        contact: $('reservationContact').value,
        note: $('reservationNote').value
      });
      closeDialog('reservationDialog', { silent: true });
      await refreshData();
      render();
      if (state.returnToDetailId) openItem(state.returnToDetailId);
      toast('預借申請已送出（未增加使用次數）');
    } catch (error) {
      toast(error.message || '預借失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  async function startDemo(role) {
    try {
      await enterDemoSession(role);
      markDemoBackend();
      updateBackendStatusUi();
      toast(role === 'borrower' ? '已進入測試（借用人）' : `已進入測試（${role === 'admin' ? '管理者' : '經辦'}）`);
      await bootApp();
    } catch (error) {
      toast(error.message || '無法進入測試', 'error');
    }
  }
  $('demoAdminBtn').addEventListener('click', () => startDemo('admin'));
  $('demoStaffBtn').addEventListener('click', () => startDemo('staff'));
  $('demoBorrowerBtn').addEventListener('click', () => startDemo('borrower'));

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = $('loginSubmitBtn');
    btn.disabled = true;
    try {
      const email = $('loginEmail').value;
      const password = $('loginPassword').value;
      const otp = $('loginOtp').value.trim();
      if (otp) {
        await verifyEmailOtp(email, otp);
        toast('登入成功');
        await bootApp();
      } else {
        await signInWithPassword(email, password);
        toast('登入成功');
        await bootApp();
      }
    } catch (error) {
      toast(error.message || '登入失敗', 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('registerBtn').addEventListener('click', async () => {
    const btn = $('registerBtn');
    btn.disabled = true;
    try {
      await registerWithPassword($('loginEmail').value, $('loginPassword').value);
      toast('已註冊並登入，預設為借用人');
      await bootApp();
    } catch (error) {
      toast(error.message || '註冊失敗', 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('otpBtn').addEventListener('click', async () => {
    try {
      await sendLoginOtp($('loginEmail').value);
      toast('已寄送一次性密碼，請至信箱查收後填入驗證碼再登入');
    } catch (error) {
      toast(error.message || '無法寄送驗證碼', 'error');
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await signOut();
    applyRoleNav();
    showAuthGate(true);
    toast('已登出');
  });
  $('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await updateMyProfile({
        displayName: $('profileName').value,
        schoolNumber: $('profileSchool').value,
        department: $('profileDept').value
      });
      applyRoleNav();
      toast('個人資料已儲存');
    } catch (error) {
      toast(error.message || '儲存失敗', 'error');
    }
  });
  $('systemSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveSettings({
        requireLoanApproval: $('settingRequireApproval').checked,
        allowSelfCheckout: $('settingAllowSelf').checked,
        defaultLoanDays: Number($('settingLoanDays').value || 1)
      });
      toast('系統設定已儲存');
    } catch (error) {
      toast(error.message || '儲存失敗', 'error');
    }
  });
  $('clearLegacyBtn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '清除瀏覽器舊測試資料',
      text: '只會清除此瀏覽器的舊版 localStorage，不會影響雲端資料，也不會上傳舊的姓名或學號。',
      confirmLabel: '確認清除'
    });
    if (!ok) return;
    clearLegacyLocalData();
    renderSettings();
    toast('已清除本機舊測試資料');
  });
  $('rejectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await rejectLoan($('rejectLoanId').value, $('rejectReason').value);
      closeDialog('rejectDialog', { silent: true });
      await afterMutation(null, '已拒絕借用申請');
    } catch (error) {
      toast(error.message || '拒絕失敗', 'error');
    }
  });
  document.addEventListener('change', async (event) => {
    const roleSelect = event.target.closest('[data-role-user]');
    if (!roleSelect) return;
    const ok = await confirmAction({
      title: '修改使用者角色',
      text: '角色異動會留下操作紀錄。確定要變更嗎？',
      confirmLabel: '確認修改'
    });
    if (!ok) {
      renderUsers();
      return;
    }
    try {
      await adminUpdateProfile({ id: roleSelect.dataset.roleUser, role: roleSelect.value });
      toast('角色已更新');
    } catch (error) {
      toast(error.message || '更新失敗', 'error');
      renderUsers();
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

function showLoadError(message) {
  setLoading(false);
  $('main').hidden = false;
  $('loadError').hidden = false;
  const status = getBackendStatus();
  const prefix = status.mode === 'failed' || status.mode === 'unset'
    ? `PocketBase 尚未連線。${status.message ? `${status.message}。` : ''}`
    : '';
  $('loadErrorText').textContent = `${prefix}${message || '無法載入資料'}`.trim();
  document.querySelectorAll('.view').forEach((el) => { el.hidden = true; });
  updateBackendStatusUi();
}

async function bootApp() {
  if (!getProfile()) {
    showAuthGate(true);
    setLoading(false);
    updateBackendStatusUi();
    return;
  }
  applyRoleNav();
  showAuthGate(false);
  $('loadError').hidden = true;
  setLoading(true, '正在載入財產清冊…');
  try {
    if (isDemoMode()) {
      markDemoBackend();
    } else {
      const status = await probePocketBase({ requireRead: true });
      updateBackendStatusUi();
      if (status.mode !== 'connected') {
        throw new Error(status.message || 'PocketBase 尚未連線');
      }
    }
    updateBackendStatusUi();
    await refreshData();
    setLoading(false);
    applyRoleNav();
    const deep = readAssetDeepLink() || (() => {
      try {
        return JSON.parse(sessionStorage.getItem('hkp-pending-asset') || 'null');
      } catch {
        return null;
      }
    })();
    sessionStorage.removeItem('hkp-pending-asset');
    if (deep?.propertyId) {
      setView('inventory');
      lookupScan(deep.propertyId);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('action');
        url.searchParams.delete('propertyId');
        url.searchParams.delete('id');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      } catch {
        // ignore
      }
    } else {
      setView(isStaff() ? 'dashboard' : 'selfService');
    }
    toast(`已載入 ${listItems().length} 筆財產`);
  } catch (error) {
    showLoadError(error.message || '無法載入資料，請重試。');
    toast(error.message || '載入失敗', 'error');
  }
}

async function init() {
  bindEvents();
  $('loadError').hidden = true;
  const pendingDeep = readAssetDeepLink();
  if (pendingDeep?.propertyId) {
    sessionStorage.setItem('hkp-pending-asset', JSON.stringify(pendingDeep));
  }
  setLoading(true, '檢查登入狀態…');
  await probePocketBase();
  updateBackendStatusUi();
  await initAuth(async (profile) => {
    if (profile) await bootApp();
    else {
      setLoading(false);
      showAuthGate(true);
      updateBackendStatusUi();
    }
  });
}

init();
