const placeholder = (label, color) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="${color}"/><circle cx="620" cy="100" r="170" fill="white" opacity=".16"/><rect x="170" y="125" width="460" height="250" rx="28" fill="white" opacity=".65"/><text x="400" y="270" text-anchor="middle" font-size="46" font-family="sans-serif" fill="#24483c">${label}</text></svg>`
  )}`;

const CATEGORY_COLORS = {
  電子白板: '#b9d3ca',
  筆記型電腦: '#c6d2d8',
  平板電腦: '#bfd1d0',
  投影機: '#b8c8bd',
  相機: '#d5c9bb',
  音響設備: '#c9c2ba',
  掃描器: '#c8d3c4'
};

let logSeq = 100;
const L = (borrower, lender, from, to = null) => ({
  id: ++logSeq,
  borrower,
  lender,
  borrowedAt: new Date(from).toISOString(),
  returnedAt: to ? new Date(to).toISOString() : null
});

let assets = [
  { id: 1, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01482', location: '教學大樓 A棟｜A305教室', confirmed: true, image: placeholder('電子白板', '#b9d3ca'), logs: [
    L('周佳蓉', '陳雅婷', '2026-08-12T09:10', '2026-08-12T17:40'),
    L('李承翰', '陳雅婷', '2026-08-28T13:00', '2026-08-29T11:20'),
    L('張家豪', '黃美玲', '2026-09-03T08:50', '2026-09-03T16:15'),
    L('吳欣怡', '陳雅婷', '2026-09-08T10:00', '2026-09-09T15:30')
  ]},
  { id: 2, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01483', location: '教學大樓 A棟｜A201教室', confirmed: true, image: placeholder('電子白板', '#b9d3ca'), logs: [
    L('蔡佩珊', '黃美玲', '2026-09-01T09:00', '2026-09-01T12:00'),
    L('林志偉', '陳雅婷', '2026-09-05T14:20', '2026-09-05T18:00')
  ]},
  { id: 3, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01490', location: '教學大樓 B棟｜B101教室', confirmed: false, image: placeholder('電子白板', '#b9d3ca'), logs: [
    L('鄭凱文', '陳雅婷', '2026-08-20T10:30', '2026-08-20T16:00')
  ]},
  { id: 4, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00873', location: '行政大樓｜資訊中心', confirmed: true, image: placeholder('筆電', '#c6d2d8'), logs: [
    L('林志偉', '陳雅婷', '2026-08-04T09:00', '2026-08-06T17:30'),
    L('王大為', '陳雅婷', '2026-08-18T08:40', '2026-08-19T12:10'),
    L('吳欣怡', '黃美玲', '2026-08-27T13:15', '2026-08-28T09:50'),
    L('張家豪', '陳雅婷', '2026-09-02T09:20', '2026-09-04T16:00'),
    L('李承翰', '陳雅婷', '2026-09-09T08:30')
  ]},
  { id: 5, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00874', location: '行政大樓｜教務處', confirmed: true, image: placeholder('筆電', '#c6d2d8'), logs: [
    L('黃美玲', '陳雅婷', '2026-09-04T10:00', '2026-09-04T17:20'),
    L('周佳蓉', '黃美玲', '2026-09-07T09:10', '2026-09-08T11:45')
  ]},
  { id: 6, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00880', location: '圖書館｜數位學習區', confirmed: true, image: placeholder('筆電', '#c6d2d8'), logs: [
    L('蔡佩珊', '陳雅婷', '2026-09-06T13:00', '2026-09-06T18:10')
  ]},
  { id: 7, category: '平板電腦', name: '平板電腦', code: 'HKU-113-02117', location: '圖書館｜數位學習區', confirmed: true, image: placeholder('平板', '#bfd1d0'), logs: [
    L('吳欣怡', '陳雅婷', '2026-08-25T09:30', '2026-08-25T16:40'),
    L('林志偉', '黃美玲', '2026-09-01T10:15', '2026-09-02T09:00'),
    L('周佳蓉', '陳雅婷', '2026-09-10T09:40')
  ]},
  { id: 8, category: '平板電腦', name: '平板電腦', code: 'HKU-113-02118', location: '教學大樓 A棟｜A305教室', confirmed: true, image: placeholder('平板', '#bfd1d0'), logs: [
    L('張家豪', '黃美玲', '2026-09-03T14:00', '2026-09-03T17:30')
  ]},
  { id: 9, category: '投影機', name: '手持式投影機', code: 'HKU-113-01904', location: '教學大樓 B棟｜B202教室', confirmed: false, image: placeholder('投影機', '#b8c8bd'), logs: [
    L('鄭凱文', '陳雅婷', '2026-09-08T15:00')
  ]},
  { id: 10, category: '投影機', name: '短焦投影機', code: 'HKU-113-01910', location: '教學大樓 A棟｜A305教室', confirmed: true, image: placeholder('投影機', '#b8c8bd'), logs: [
    L('李承翰', '黃美玲', '2026-08-14T08:50', '2026-08-14T12:00'),
    L('蔡佩珊', '陳雅婷', '2026-08-29T13:20', '2026-08-29T17:10'),
    L('王大為', '陳雅婷', '2026-09-05T09:00', '2026-09-05T11:40')
  ]},
  { id: 11, category: '相機', name: '單眼相機', code: 'HKU-111-00326', location: '設計大樓｜器材室 B', confirmed: true, image: placeholder('相機', '#d5c9bb'), logs: [
    L('周佳蓉', '黃美玲', '2026-08-22T10:00', '2026-08-23T18:00'),
    L('張家豪', '陳雅婷', '2026-09-02T13:30', '2026-09-02T19:10'),
    L('吳欣怡', '黃美玲', '2026-09-07T09:20', '2026-09-07T16:50')
  ]},
  { id: 12, category: '相機', name: '單眼相機', code: 'HKU-111-00330', location: '設計大樓｜攝影棚', confirmed: true, image: placeholder('相機', '#d5c9bb'), logs: [
    L('李承翰', '陳雅婷', '2026-09-04T11:00', '2026-09-04T15:20')
  ]},
  { id: 13, category: '音響設備', name: '無線麥克風組', code: 'HKU-110-00158', location: '學生活動中心｜器材室', confirmed: true, image: placeholder('麥克風', '#c9c2ba'), logs: [
    L('王大為', '黃美玲', '2026-09-01T17:00', '2026-09-01T21:30'),
    L('鄭凱文', '陳雅婷', '2026-09-06T18:00', '2026-09-06T22:10')
  ]},
  { id: 14, category: '音響設備', name: '無線麥克風組', code: 'HKU-110-00162', location: '學生活動中心｜禮堂', confirmed: true, image: placeholder('麥克風', '#c9c2ba'), logs: [
    L('蔡佩珊', '黃美玲', '2026-08-30T16:40', '2026-08-30T20:00')
  ]},
  { id: 15, category: '音響設備', name: '行動音響', code: 'HKU-109-00642', location: '學生活動中心｜服務台', confirmed: false, image: placeholder('音響', '#d7c9b7'), logs: [] },
  { id: 16, category: '掃描器', name: '文件掃描器', code: 'HKU-112-01139', location: '行政大樓｜教務處', confirmed: true, image: placeholder('掃描器', '#c8d3c4'), logs: [
    L('黃美玲', '陳雅婷', '2026-09-09T10:10', '2026-09-09T11:00')
  ]}
];

let currentView = 'all';
let currentLayout = 'grid';
let historyAssetId = null;

const board = document.querySelector('#assetBoard');
const search = document.querySelector('#search');
const categoryFilter = document.querySelector('#categoryFilter');
const locationFilter = document.querySelector('#locationFilter');
const sort = document.querySelector('#sortBy');
const dialog = document.querySelector('#editDialog');
const logDialog = document.querySelector('#logDialog');
const loanDialog = document.querySelector('#loanDialog');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(iso) {
  if (!iso) return '尚未歸還';
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function duration(from, to) {
  const ms = new Date(to) - new Date(from);
  if (ms < 0) return '';
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} 分鐘`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours} 小時 ${rem} 分` : `${hours} 小時`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} 天 ${h} 小時` : `${days} 天`;
}

function logsOf(asset) {
  return (asset.logs || []).slice().sort((a, b) => new Date(b.borrowedAt) - new Date(a.borrowedAt));
}

function currentLoan(asset) {
  return (asset.logs || []).find((l) => !l.returnedAt) || null;
}

function useCount(asset) {
  return (asset.logs || []).length;
}

function peopleNames() {
  return uniqueSorted(assets.flatMap((a) => (a.logs || []).flatMap((l) => [l.borrower, l.lender])));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function categories() {
  return uniqueSorted(assets.map((x) => x.category));
}

function locations() {
  return uniqueSorted(assets.map((x) => x.location.split('｜')[0]));
}

function fillSelect(el, blank, items) {
  const old = el.value;
  el.innerHTML = `<option value="">${blank}</option>` + items.map((x) => `<option>${esc(x)}</option>`).join('');
  el.value = items.includes(old) ? old : '';
}

function refreshFilters() {
  fillSelect(categoryFilter, '全部類別', categories());
  fillSelect(locationFilter, '全部位置', locations());
  document.querySelector('#categoryList').innerHTML = categories()
    .map((x) => `<option value="${esc(x)}"></option>`)
    .join('');
  document.querySelector('#peopleList').innerHTML = peopleNames()
    .map((x) => `<option value="${esc(x)}"></option>`)
    .join('');
}

function matchesView(x) {
  if (currentView === 'frequent') return useCount(x) >= 3;
  if (currentView === 'attention') return !x.confirmed;
  if (currentView === 'loaned') return !!currentLoan(x);
  if (currentView.startsWith('cat:')) return x.category === currentView.slice(4);
  return true;
}

function peopleText(x) {
  return (x.logs || []).flatMap((l) => [l.borrower, l.lender]).join(' ').toLowerCase();
}

function visible() {
  const q = search.value.trim().toLowerCase();
  return assets.filter((x) => {
    const hit =
      !q ||
      x.name.toLowerCase().includes(q) ||
      x.code.toLowerCase().includes(q) ||
      x.category.toLowerCase().includes(q) ||
      peopleText(x).includes(q);
    const byCat = !categoryFilter.value || x.category === categoryFilter.value;
    const byLoc = !locationFilter.value || x.location.startsWith(locationFilter.value);
    return hit && byCat && byLoc && matchesView(x);
  });
}

function sortItems(list) {
  const copy = list.slice();
  if (sort.value === 'uses') copy.sort((a, b) => useCount(b) - useCount(a) || a.code.localeCompare(b.code));
  else if (sort.value === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.code.localeCompare(b.code));
  else if (sort.value === 'code') copy.sort((a, b) => a.code.localeCompare(b.code));
  else copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.code.localeCompare(b.code));
  return copy;
}

function grouped(list) {
  const map = new Map();
  for (const item of list) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category).push(item);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))
    .map(([cat, items]) => [cat, sortItems(items)]);
}

function statusHTML(x) {
  const loan = currentLoan(x);
  if (loan) return `<span class="status loan">外借中 · ${esc(loan.borrower)}</span>`;
  if (!x.confirmed) return `<span class="status attention">! 待確認位置</span>`;
  return `<span class="status">✓ 位置已確認</span>`;
}

function footHTML(x) {
  const loan = currentLoan(x);
  const n = useCount(x);
  const action = loan
    ? `<button class="use-btn return" data-return="${x.id}">登記歸還</button>`
    : `<button class="use-btn" data-borrow="${x.id}">登記借出</button>`;
  return `<div class="card-foot">
    <button class="history-btn" data-history="${x.id}"><small>使用紀錄</small><strong>${n}</strong> 筆</button>
    ${action}
  </div>`;
}

function cardHTML(x) {
  return `<article class="asset-card">
    <div class="photo">
      <img src="${x.image}" alt="${esc(x.name)}">
      ${statusHTML(x)}
    </div>
    <div class="card-body">
      <div class="card-top">
        <div>
          <span class="cat-badge">${esc(x.category)}</span>
          <div class="asset-name">${esc(x.name)}</div>
          <div class="code">財編 ${esc(x.code)}</div>
        </div>
        <button class="dots" data-edit="${x.id}" aria-label="編輯 ${esc(x.name)} ${esc(x.code)}">•••</button>
      </div>
      <div class="location"><span>⌖</span><div><b>目前位置</b>${esc(x.location)}</div></div>
      ${footHTML(x)}
    </div>
  </article>`;
}

function rowHTML(x) {
  const loan = currentLoan(x);
  return `<article class="asset-row">
    <span class="cat-badge">${esc(x.category)}</span>
    <div>
      <div class="asset-name">${esc(x.name)}</div>
      <div class="code">財編 ${esc(x.code)}</div>
    </div>
    <div class="location compact"><span>⌖</span><div>${esc(x.location)}</div></div>
    <button class="history-btn compact" data-history="${x.id}"><strong>${useCount(x)}</strong><small>筆</small></button>
    <span class="status-text ${loan ? 'loan' : x.confirmed ? '' : 'attention'}">${loan ? '外借中' : x.confirmed ? '已確認' : '待確認'}</span>
    ${loan ? `<button class="use-btn return" data-return="${x.id}">歸還</button>` : `<button class="use-btn" data-borrow="${x.id}">借出</button>`}
    <button class="dots" data-edit="${x.id}" aria-label="編輯 ${esc(x.name)} ${esc(x.code)}">•••</button>
  </article>`;
}

function timelineItemHTML(log, asset) {
  const open = !log.returnedAt;
  const assetLine = asset
    ? `<div class="timeline-asset">${esc(asset.name)} · 財編 ${esc(asset.code)}</div>`
    : '';
  const returnLine = open
    ? `<div class="meta warn">尚未歸還 · 已借出 ${esc(duration(log.borrowedAt, new Date()))}</div>`
    : `<div class="meta">歸還時間 ${esc(formatTime(log.returnedAt))} · 使用 ${esc(duration(log.borrowedAt, log.returnedAt))}</div>`;
  return `<li class="${open ? 'open' : ''}">
    <div class="when">${open ? '借出中' : '已歸還'} · ${esc(formatTime(log.borrowedAt))}</div>
    ${assetLine}
    <div class="people">使用人 <b>${esc(log.borrower)}</b>　借出人 <b>${esc(log.lender)}</b></div>
    ${returnLine}
  </li>`;
}

function allLogs() {
  return assets
    .flatMap((a) => logsOf(a).map((l) => ({ log: l, asset: a })))
    .sort((a, b) => new Date(b.log.borrowedAt) - new Date(a.log.borrowedAt));
}

function visibleLogs() {
  const q = search.value.trim().toLowerCase();
  return allLogs().filter(({ log, asset }) => {
    const byCat = !categoryFilter.value || asset.category === categoryFilter.value;
    const byLoc = !locationFilter.value || asset.location.startsWith(locationFilter.value);
    const hit =
      !q ||
      [asset.name, asset.code, asset.category, log.borrower, log.lender].join(' ').toLowerCase().includes(q);
    return byCat && byLoc && hit;
  });
}

function renderGlobalLogs() {
  const list = visibleLogs();
  if (!list.length) {
    board.innerHTML = '<div class="empty">找不到符合條件的使用紀錄</div>';
    return;
  }
  board.innerHTML = `<section class="global-log">
    <div class="category-head">
      <div><h3>借入借出時間軸</h3><p>依借出時間由新到舊，含使用人、借出人與歸還時間</p></div>
      <small>${list.length} 筆紀錄</small>
    </div>
    <ol class="timeline">${list.map(({ log, asset }) => timelineItemHTML(log, asset)).join('')}</ol>
  </section>`;
}

function renderChips() {
  const selected = categoryFilter.value;
  const counts = Object.fromEntries(categories().map((c) => [c, assets.filter((x) => x.category === c).length]));
  document.querySelector('#categoryChips').innerHTML =
    `<button class="chip ${selected ? '' : 'active'}" data-cat="">全部 ${assets.length}</button>` +
    categories()
      .map((c) => `<button class="chip ${selected === c ? 'active' : ''}" data-cat="${c}">${esc(c)} ${counts[c]}</button>`)
      .join('');

  document.querySelector('#sideCategories').innerHTML = categories()
    .map((c) => {
      const on = currentView === `cat:${c}` || categoryFilter.value === c;
      return `<button class="nav-item cat-link ${on ? 'active' : ''}" data-cat="${c}"><span>${counts[c]}</span>${esc(c)}</button>`;
    })
    .join('');

  document.querySelectorAll('.sidebar nav .nav-item').forEach((x) => {
    x.classList.toggle('active', !categoryFilter.value && currentView === x.dataset.view);
  });
}

function syncHeader() {
  const map = {
    all: ['全校財產管理', '財產盤點總覽'],
    logs: ['借入借出時間軸', '使用紀錄'],
    loaned: ['借出管理', '目前外借中'],
    frequent: ['使用分析', '高頻使用物品'],
    attention: ['盤點異常', '待確認物品']
  };
  let pair = map[currentView] || map.all;
  if (currentView.startsWith('cat:')) pair = ['物品類別', currentView.slice(4)];
  document.querySelector('header .eyebrow').textContent = pair[0];
  document.querySelector('header h1').textContent = pair[1];
}

function monthLogCount() {
  const now = new Date();
  return assets.reduce(
    (n, a) =>
      n +
      (a.logs || []).filter((l) => {
        const d = new Date(l.borrowedAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length,
    0
  );
}

function render() {
  const list = visible();
  const groups = grouped(list);
  board.classList.toggle('list-view', currentLayout === 'list');
  syncHeader();

  if (currentView === 'logs') {
    renderGlobalLogs();
  } else if (!list.length) {
    board.innerHTML = '<div class="empty">找不到符合條件的財產</div>';
  } else {
    board.innerHTML = groups
      .map(([cat, items]) => {
        const codes = items.map((x) => x.code).join('、');
        const itemHTML = items.map((x) => (currentLayout === 'list' ? rowHTML(x) : cardHTML(x))).join('');
        return `<section class="category-group">
          <div class="category-head">
            <div>
              <h3>${esc(cat)}</h3>
              <p>${items.length} 件同類物品，各有獨立財產編號</p>
            </div>
            <small title="${esc(codes)}">財編 ${items.length} 筆</small>
          </div>
          <div class="${currentLayout === 'list' ? 'asset-list' : 'asset-grid'}">${itemHTML}</div>
        </section>`;
      })
      .join('');
  }

  const confirmed = assets.filter((x) => x.confirmed).length;
  const loaned = assets.filter((x) => currentLoan(x)).length;
  const percent = assets.length ? Math.round((confirmed / assets.length) * 100) : 0;
  const result = document.querySelector('#resultText');
  if (currentView === 'logs') result.textContent = `顯示 ${visibleLogs().length} 筆借入借出紀錄`;
  else if (categoryFilter.value) result.textContent = `${categoryFilter.value}｜顯示 ${list.length} 件，每件皆有財產編號`;
  else result.textContent = `顯示 ${groups.length} 類、${list.length} 件財產`;

  document.querySelector('#totalCount').textContent = assets.length;
  document.querySelector('#categoryCount').textContent = categories().length;
  document.querySelector('#loanedCount').textContent = loaned;
  document.querySelector('#attentionCount').textContent = assets.filter((x) => !x.confirmed).length;
  document.querySelector('#monthUses').textContent = monthLogCount();
  document.querySelector('#progressText').textContent = `${percent}%`;
  document.querySelector('#progressCount').textContent = `${confirmed} / ${assets.length} 件`;
  document.querySelector('#progressBar').style.width = `${percent}%`;
  renderChips();
}

function toast(t) {
  const el = document.querySelector('#toast');
  el.textContent = t;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function assetById(id) {
  return assets.find((x) => x.id == id);
}

function openHistory(id) {
  const item = assetById(id);
  if (!item) return;
  historyAssetId = item.id;
  const loan = currentLoan(item);
  document.querySelector('#logTitle').textContent = `${item.name} 使用紀錄`;
  document.querySelector('#logMeta').textContent = `財編 ${item.code}｜${item.location}｜共 ${useCount(item)} 筆`;
  document.querySelector('#logBorrowBtn').disabled = !!loan;
  document.querySelector('#logReturnBtn').disabled = !loan;
  const logs = logsOf(item);
  document.querySelector('#timeline').innerHTML = logs.length
    ? logs.map((l) => timelineItemHTML(l)).join('')
    : '<li class="empty-log">還沒有借入借出紀錄</li>';
  logDialog.showModal();
}

function openBorrow(id) {
  const item = assetById(id);
  if (!item) return;
  if (currentLoan(item)) {
    toast('此物品尚未歸還，請先登記歸還');
    return;
  }
  document.querySelector('#loanMode').value = 'borrow';
  document.querySelector('#loanAssetId').value = item.id;
  document.querySelector('#loanEyebrow').textContent = `${item.name} · ${item.code}`;
  document.querySelector('#loanTitle').textContent = '登記借出';
  document.querySelector('#loanSummary').textContent = '請填寫使用人、借出人與借出時間。';
  document.querySelector('#loanBorrowFields').hidden = false;
  document.querySelector('#loanReturnFields').hidden = true;
  document.querySelector('#loanBorrower').required = true;
  document.querySelector('#loanLender').required = true;
  document.querySelector('#loanBorrowedAt').required = true;
  document.querySelector('#loanReturnedAt').required = false;
  document.querySelector('#loanBorrower').value = '';
  document.querySelector('#loanLender').value = '';
  document.querySelector('#loanBorrowedAt').value = toInputValue();
  document.querySelector('#loanSubmit').textContent = '確認借出';
  loanDialog.showModal();
}

function openReturn(id) {
  const item = assetById(id);
  if (!item) return;
  const loan = currentLoan(item);
  if (!loan) {
    toast('這件物品目前沒有外借中的紀錄');
    return;
  }
  document.querySelector('#loanMode').value = 'return';
  document.querySelector('#loanAssetId').value = item.id;
  document.querySelector('#loanEyebrow').textContent = `${item.name} · ${item.code}`;
  document.querySelector('#loanTitle').textContent = '登記歸還';
  document.querySelector('#loanSummary').textContent = `使用人 ${loan.borrower}　借出人 ${loan.lender}　借出時間 ${formatTime(loan.borrowedAt)}`;
  document.querySelector('#loanBorrowFields').hidden = true;
  document.querySelector('#loanReturnFields').hidden = false;
  document.querySelector('#loanBorrower').required = false;
  document.querySelector('#loanLender').required = false;
  document.querySelector('#loanBorrowedAt').required = false;
  document.querySelector('#loanReturnedAt').required = true;
  document.querySelector('#loanReturnedAt').value = toInputValue();
  document.querySelector('#loanSubmit').textContent = '確認歸還';
  loanDialog.showModal();
}

function openEditor(item = { id: '', category: '', name: '', code: '', location: '', image: '' }) {
  document.querySelector('#dialogTitle').textContent = item.id ? '更新財產資料' : '新增財產';
  ['Id', 'Category', 'Name', 'Code', 'Location', 'Image'].forEach((k) => {
    document.querySelector('#edit' + k).value = item[k.toLowerCase()] || '';
  });
  if (!item.id && categoryFilter.value) document.querySelector('#editCategory').value = categoryFilter.value;
  dialog.showModal();
}

function setCategory(cat) {
  categoryFilter.value = cat;
  if (currentView.startsWith('cat:')) currentView = cat ? `cat:${cat}` : 'all';
  render();
}

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) {
    document.getElementById(closer.dataset.close)?.close();
    return;
  }

  const history = e.target.closest('[data-history]');
  if (history) {
    openHistory(history.dataset.history);
    return;
  }
  const borrow = e.target.closest('[data-borrow]');
  if (borrow) {
    openBorrow(borrow.dataset.borrow);
    return;
  }
  const ret = e.target.closest('[data-return]');
  if (ret) {
    openReturn(ret.dataset.return);
    return;
  }

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    openEditor(assetById(edit.dataset.edit));
    return;
  }
  if (e.target.closest('#addBtn')) {
    openEditor();
    return;
  }
  if (e.target.closest('#logBorrowBtn')) {
    logDialog.close();
    openBorrow(historyAssetId);
    return;
  }
  if (e.target.closest('#logReturnBtn')) {
    logDialog.close();
    openReturn(historyAssetId);
    return;
  }
  if (e.target.closest('.menu')) document.querySelector('.sidebar').classList.toggle('open');

  const chip = e.target.closest('[data-cat]');
  if (chip && !chip.classList.contains('nav-item')) {
    setCategory(chip.dataset.cat);
    return;
  }

  const sideCat = e.target.closest('#sideCategories [data-cat]');
  if (sideCat) {
    currentView = `cat:${sideCat.dataset.cat}`;
    categoryFilter.value = sideCat.dataset.cat;
    render();
    document.querySelector('.sidebar').classList.remove('open');
    return;
  }

  const layoutBtn = e.target.closest('[data-layout]');
  if (layoutBtn) {
    document.querySelectorAll('[data-layout]').forEach((x) => x.classList.remove('active'));
    layoutBtn.classList.add('active');
    currentLayout = layoutBtn.dataset.layout;
    render();
  }

  const nav = e.target.closest('.sidebar nav .nav-item');
  if (nav) {
    currentView = nav.dataset.view;
    categoryFilter.value = '';
    render();
    document.querySelector('.sidebar').classList.remove('open');
  }
});

document.querySelector('#editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = +document.querySelector('#editId').value;
  const category = document.querySelector('#editCategory').value.trim();
  const data = {
    category,
    name: document.querySelector('#editName').value.trim(),
    code: document.querySelector('#editCode').value.trim(),
    location: document.querySelector('#editLocation').value.trim(),
    image:
      document.querySelector('#editImage').value.trim() ||
      placeholder(category || '物品圖片', CATEGORY_COLORS[category] || '#c8d4cf')
  };
  if (assets.some((x) => x.code === data.code && x.id !== id)) {
    toast('財產編號已存在，請使用獨立編號');
    return;
  }
  if (id) Object.assign(assets.find((x) => x.id === id), data, { confirmed: true });
  else assets.push({ id: Date.now(), ...data, logs: [], confirmed: true });
  dialog.close();
  refreshFilters();
  render();
  toast(id ? '財產資料已更新' : `已新增「${data.category}」${data.code}`);
});

document.querySelector('#loanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const item = assetById(document.querySelector('#loanAssetId').value);
  if (!item) return;
  item.logs = item.logs || [];
  const mode = document.querySelector('#loanMode').value;

  if (mode === 'borrow') {
    if (currentLoan(item)) {
      toast('此物品尚未歸還');
      return;
    }
    const borrowedAt = new Date(document.querySelector('#loanBorrowedAt').value);
    if (Number.isNaN(borrowedAt.getTime())) {
      toast('請填寫正確的借出時間');
      return;
    }
    item.logs.push({
      id: Date.now(),
      borrower: document.querySelector('#loanBorrower').value.trim(),
      lender: document.querySelector('#loanLender').value.trim(),
      borrowedAt: borrowedAt.toISOString(),
      returnedAt: null
    });
    loanDialog.close();
    refreshFilters();
    render();
    toast(`已借出給 ${item.logs.at(-1).borrower}`);
    return;
  }

  const loan = currentLoan(item);
  if (!loan) {
    toast('沒有外借中的紀錄');
    return;
  }
  const returnedAt = new Date(document.querySelector('#loanReturnedAt').value);
  if (Number.isNaN(returnedAt.getTime())) {
    toast('請填寫正確的歸還時間');
    return;
  }
  if (returnedAt < new Date(loan.borrowedAt)) {
    toast('歸還時間不可早於借出時間');
    return;
  }
  loan.returnedAt = returnedAt.toISOString();
  loanDialog.close();
  render();
  toast(`${loan.borrower} 已歸還 ${item.name}`);
});

[search, categoryFilter, locationFilter, sort].forEach((el) =>
  el.addEventListener(el === search ? 'input' : 'change', () => {
    if (el === categoryFilter && currentView.startsWith('cat:')) {
      currentView = categoryFilter.value ? `cat:${categoryFilter.value}` : 'all';
    }
    render();
  })
);

refreshFilters();
render();
