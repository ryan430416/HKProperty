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

let assets = [
  { id: 1, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01482', location: '教學大樓 A棟｜A305教室', uses: 47, confirmed: true, image: placeholder('電子白板', '#b9d3ca') },
  { id: 2, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01483', location: '教學大樓 A棟｜A201教室', uses: 33, confirmed: true, image: placeholder('電子白板', '#b9d3ca') },
  { id: 3, category: '電子白板', name: '互動式電子白板', code: 'HKU-113-01490', location: '教學大樓 B棟｜B101教室', uses: 21, confirmed: false, image: placeholder('電子白板', '#b9d3ca') },
  { id: 4, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00873', location: '行政大樓｜資訊中心', uses: 82, confirmed: true, image: placeholder('筆電', '#c6d2d8') },
  { id: 5, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00874', location: '行政大樓｜教務處', uses: 41, confirmed: true, image: placeholder('筆電', '#c6d2d8') },
  { id: 6, category: '筆記型電腦', name: '筆記型電腦', code: 'HKU-112-00880', location: '圖書館｜數位學習區', uses: 28, confirmed: true, image: placeholder('筆電', '#c6d2d8') },
  { id: 7, category: '平板電腦', name: '平板電腦', code: 'HKU-113-02117', location: '圖書館｜數位學習區', uses: 54, confirmed: true, image: placeholder('平板', '#bfd1d0') },
  { id: 8, category: '平板電腦', name: '平板電腦', code: 'HKU-113-02118', location: '教學大樓 A棟｜A305教室', uses: 19, confirmed: true, image: placeholder('平板', '#bfd1d0') },
  { id: 9, category: '投影機', name: '手持式投影機', code: 'HKU-113-01904', location: '教學大樓 B棟｜B202教室', uses: 18, confirmed: false, image: placeholder('投影機', '#b8c8bd') },
  { id: 10, category: '投影機', name: '短焦投影機', code: 'HKU-113-01910', location: '教學大樓 A棟｜A305教室', uses: 36, confirmed: true, image: placeholder('投影機', '#b8c8bd') },
  { id: 11, category: '相機', name: '單眼相機', code: 'HKU-111-00326', location: '設計大樓｜器材室 B', uses: 31, confirmed: true, image: placeholder('相機', '#d5c9bb') },
  { id: 12, category: '相機', name: '單眼相機', code: 'HKU-111-00330', location: '設計大樓｜攝影棚', uses: 14, confirmed: true, image: placeholder('相機', '#d5c9bb') },
  { id: 13, category: '音響設備', name: '無線麥克風組', code: 'HKU-110-00158', location: '學生活動中心｜器材室', uses: 29, confirmed: true, image: placeholder('麥克風', '#c9c2ba') },
  { id: 14, category: '音響設備', name: '無線麥克風組', code: 'HKU-110-00162', location: '學生活動中心｜禮堂', uses: 22, confirmed: true, image: placeholder('麥克風', '#c9c2ba') },
  { id: 15, category: '音響設備', name: '行動音響', code: 'HKU-109-00642', location: '學生活動中心｜服務台', uses: 11, confirmed: false, image: placeholder('音響', '#d7c9b7') },
  { id: 16, category: '掃描器', name: '文件掃描器', code: 'HKU-112-01139', location: '行政大樓｜教務處', uses: 23, confirmed: true, image: placeholder('掃描器', '#c8d3c4') }
];

let currentView = 'all';
let currentLayout = 'grid';

const board = document.querySelector('#assetBoard');
const search = document.querySelector('#search');
const categoryFilter = document.querySelector('#categoryFilter');
const locationFilter = document.querySelector('#locationFilter');
const sort = document.querySelector('#sortBy');
const dialog = document.querySelector('#editDialog');

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function categories() {
  return uniqueSorted(assets.map((x) => x.category));
}

function locations() {
  return uniqueSorted(assets.map((x) => x.location.split('｜')[0]));
}

function fillSelect(el, blank, items) {
  const old = el.value;
  el.innerHTML = `<option value="">${blank}</option>` + items.map((x) => `<option>${x}</option>`).join('');
  el.value = items.includes(old) ? old : '';
}

function refreshFilters() {
  fillSelect(categoryFilter, '全部類別', categories());
  fillSelect(locationFilter, '全部位置', locations());
  document.querySelector('#categoryList').innerHTML = categories()
    .map((x) => `<option value="${x}"></option>`)
    .join('');
}

function matchesView(x) {
  if (currentView === 'frequent') return x.uses >= 40;
  if (currentView === 'attention') return !x.confirmed;
  if (currentView.startsWith('cat:')) return x.category === currentView.slice(4);
  return true;
}

function visible() {
  const q = search.value.trim().toLowerCase();
  return assets.filter((x) => {
    const hit =
      !q ||
      x.name.toLowerCase().includes(q) ||
      x.code.toLowerCase().includes(q) ||
      x.category.toLowerCase().includes(q);
    const byCat = !categoryFilter.value || x.category === categoryFilter.value;
    const byLoc = !locationFilter.value || x.location.startsWith(locationFilter.value);
    return hit && byCat && byLoc && matchesView(x);
  });
}

function sortItems(list) {
  const copy = list.slice();
  if (sort.value === 'uses') copy.sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code));
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

function cardHTML(x) {
  return `<article class="asset-card">
    <div class="photo">
      <img src="${x.image}" alt="${x.name}">
      <span class="status ${x.confirmed ? '' : 'attention'}">${x.confirmed ? '✓ 位置已確認' : '! 待確認位置'}</span>
    </div>
    <div class="card-body">
      <div class="card-top">
        <div>
          <span class="cat-badge">${x.category}</span>
          <div class="asset-name">${x.name}</div>
          <div class="code">財編 ${x.code}</div>
        </div>
        <button class="dots" data-edit="${x.id}" aria-label="編輯 ${x.name} ${x.code}">•••</button>
      </div>
      <div class="location"><span>⌖</span><div><b>目前位置</b>${x.location}</div></div>
      <div class="card-foot">
        <div class="uses"><small>累計使用次數</small><strong>${x.uses}</strong> 次</div>
        <button class="use-btn" data-use="${x.id}">＋ 記錄使用</button>
      </div>
    </div>
  </article>`;
}

function rowHTML(x) {
  return `<article class="asset-row">
    <span class="cat-badge">${x.category}</span>
    <div>
      <div class="asset-name">${x.name}</div>
      <div class="code">財編 ${x.code}</div>
    </div>
    <div class="location compact"><span>⌖</span><div>${x.location}</div></div>
    <div class="uses"><strong>${x.uses}</strong><small>次</small></div>
    <span class="status-text ${x.confirmed ? '' : 'attention'}">${x.confirmed ? '已確認' : '待確認'}</span>
    <button class="use-btn" data-use="${x.id}">＋ 使用</button>
    <button class="dots" data-edit="${x.id}" aria-label="編輯 ${x.name} ${x.code}">•••</button>
  </article>`;
}

function renderChips() {
  const selected = categoryFilter.value;
  const counts = Object.fromEntries(categories().map((c) => [c, assets.filter((x) => x.category === c).length]));
  document.querySelector('#categoryChips').innerHTML =
    `<button class="chip ${selected ? '' : 'active'}" data-cat="">全部 ${assets.length}</button>` +
    categories()
      .map((c) => `<button class="chip ${selected === c ? 'active' : ''}" data-cat="${c}">${c} ${counts[c]}</button>`)
      .join('');

  document.querySelector('#sideCategories').innerHTML = categories()
    .map((c) => {
      const on = currentView === `cat:${c}` || categoryFilter.value === c;
      return `<button class="nav-item cat-link ${on ? 'active' : ''}" data-cat="${c}"><span>${counts[c]}</span>${c}</button>`;
    })
    .join('');

  document.querySelectorAll('.sidebar nav .nav-item').forEach((x) => {
    x.classList.toggle('active', !categoryFilter.value && currentView === x.dataset.view);
  });
}

function render() {
  const list = visible();
  const groups = grouped(list);

  board.classList.toggle('list-view', currentLayout === 'list');

  if (!list.length) {
    board.innerHTML = '<div class="empty">找不到符合條件的財產</div>';
  } else {
    board.innerHTML = groups
      .map(([cat, items]) => {
        const codes = items.map((x) => x.code).join('、');
        const itemHTML = items.map((x) => (currentLayout === 'list' ? rowHTML(x) : cardHTML(x))).join('');
        return `<section class="category-group">
          <div class="category-head">
            <div>
              <h3>${cat}</h3>
              <p>${items.length} 件同類物品，各有獨立財產編號</p>
            </div>
            <small title="${codes}">財編 ${items.length} 筆</small>
          </div>
          <div class="${currentLayout === 'list' ? 'asset-list' : 'asset-grid'}">${itemHTML}</div>
        </section>`;
      })
      .join('');
  }

  const confirmed = assets.filter((x) => x.confirmed).length;
  const percent = assets.length ? Math.round((confirmed / assets.length) * 100) : 0;
  document.querySelector('#resultText').textContent = categoryFilter.value
    ? `${categoryFilter.value}｜顯示 ${list.length} 件，每件皆有財產編號`
    : `顯示 ${groups.length} 類、${list.length} 件財產`;
  document.querySelector('#totalCount').textContent = assets.length;
  document.querySelector('#categoryCount').textContent = categories().length;
  document.querySelector('#locatedCount').textContent = confirmed;
  document.querySelector('#attentionCount').textContent = assets.filter((x) => !x.confirmed).length;
  document.querySelector('#monthUses').textContent = assets.reduce((n, x) => n + x.uses, 0);
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
  const use = e.target.closest('[data-use]');
  if (use) {
    assets.find((x) => x.id == use.dataset.use).uses++;
    render();
    toast('已新增 1 次使用紀錄');
    return;
  }

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    openEditor(assets.find((x) => x.id == edit.dataset.edit));
    return;
  }
  if (e.target.closest('#addBtn')) {
    openEditor();
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
    document.querySelectorAll('.sidebar .nav-item').forEach((x) => x.classList.remove('active'));
    sideCat.classList.add('active');
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
    document.querySelectorAll('.sidebar .nav-item').forEach((x) => x.classList.remove('active'));
    nav.classList.add('active');
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
  else assets.push({ id: Date.now(), ...data, uses: 0, confirmed: true });
  dialog.close();
  refreshFilters();
  render();
  toast(id ? '財產資料已更新' : `已新增「${data.category}」${data.code}`);
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
