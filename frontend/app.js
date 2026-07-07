/* ================================================================
   TELEGRAM MINI APP — WALLET / EXPENSE TRACKER
   Vanilla JS  •  No frameworks
   ================================================================ */

const API_BASE_URL = 'https://budget-ripper.onrender.com';

const CATEGORY_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c',
  '#4facfe', '#00f2fe', '#43e97b', '#fa709a',
  '#fee140', '#ffa751', '#a18cd1', '#fbc2eb'
];

const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
];

/* ================================================================
   STATE
   ================================================================ */
const state = {
  currentScreen: 'dashboard',
  transactions: [],
  categories: [],
  limits: [],
  analytics: null,
  selectedCategory: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth()  // 0-indexed
};

/* Sub-screens: which nav tab stays highlighted */
const SCREEN_PARENT = { history: 'dashboard' };

/* ================================================================
   TELEGRAM WEBAPP
   ================================================================ */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0f');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0f');
}

function hapticImpact(style) {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style || 'light'); } catch (e) {}
}

function hapticNotification(type) {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type); } catch (e) {}
}

/* ================================================================
   UTILITIES
   ================================================================ */
function formatMoney(amount) {
  const num = Math.abs(Number(amount) || 0);
  return num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()].substring(0, 3).toLowerCase() + ', ' + hours + ':' + mins;
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const toDate = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diff = toDate(now) - toDate(d);
  if (diff === 0) return 'Сьогодні';
  if (diff === 86400000) return 'Вчора';
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
}

/* Stable color by djb2 hash of category name */
function getCategoryColorStable(categoryName) {
  let h = 5381;
  for (let i = 0; i < categoryName.length; i++) {
    h = ((h << 5) + h) + categoryName.charCodeAt(i);
    h = h & h;
  }
  return CATEGORY_COLORS[Math.abs(h) % CATEGORY_COLORS.length];
}

function getCategoryIcon(categoryName) {
  const cat = state.categories.find(c => c.name === categoryName);
  return cat ? cat.icon : '💼';
}

function isCurrentMonth() {
  const now = new Date();
  return state.viewYear === now.getFullYear() && state.viewMonth === now.getMonth();
}

function getAuthHeader() {
  return (tg && tg.initData) ? tg.initData : '';
}

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* Compute analytics totals from raw transaction list (used for past months) */
function computeAnalyticsFromTransactions(transactions) {
  const map = {};
  let totalSpent = 0;
  (transactions || []).forEach(tx => {
    totalSpent += tx.amount;
    map[tx.category] = (map[tx.category] || 0) + tx.amount;
  });
  const categories = Object.entries(map)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  return { total_spent: totalSpent, categories };
}

/* ================================================================
   TOAST
   ================================================================ */
let toastTimer = null;
function showToast(message, duration) {
  const toast = $('toast');
  $('toast-text').textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration || 2500);
}

/* ================================================================
   GLOBAL LOADER
   ================================================================ */
function showLoader() { $('global-loader').classList.add('show'); }
function hideLoader() { $('global-loader').classList.remove('show'); }

/* ================================================================
   API MODULE
   ================================================================ */
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader() }
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(API_BASE_URL + path, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || 'Помилка сервера');
      }
      if (res.status === 204) return null;
      return await res.json();
    } catch (e) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) throw new Error('Немає підключення до сервера');
      throw e;
    }
  },
  getCategories()             { return this.request('GET', '/api/categories'); },
  getTransactions(period, limit) {
    let q = '?period=' + (period || 'all');
    if (limit) q += '&limit=' + limit;
    return this.request('GET', '/api/transactions' + q);
  },
  addTransaction(cat, amt, desc) { return this.request('POST', '/api/transactions', { category: cat, amount: amt, description: desc || null }); },
  deleteTransaction(id)       { return this.request('DELETE', '/api/transactions/' + id); },
  getAnalytics()              { return this.request('GET', '/api/analytics'); },
  getLimits()                 { return this.request('GET', '/api/limits'); },
  addLimit(cat, amt)          { return this.request('POST', '/api/limits', { category: cat, limit_amount: amt }); },
  deleteLimit(id)             { return this.request('DELETE', '/api/limits/' + id); }
};

/* ================================================================
   NAVIGATION
   ================================================================ */
function navigateTo(screen) {
  if (state.currentScreen === screen) return;
  hapticImpact('light');

  const current = $('screen-' + state.currentScreen);
  if (current) {
    current.classList.remove('visible');
    setTimeout(() => current.classList.remove('active'), 350);
  }

  state.currentScreen = screen;

  /* Highlight correct nav tab (history → dashboard) */
  const activeTab = SCREEN_PARENT[screen] || screen;
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.screen === activeTab);
  });

  setTimeout(() => {
    const next = $('screen-' + screen);
    if (next) {
      next.classList.add('active');
      next.scrollTop = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('visible')));
    }
    loadScreenData(screen);
  }, current ? 100 : 0);
}

function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.screen));
  });
}

/* ================================================================
   SCREEN DATA LOADING
   ================================================================ */
async function loadScreenData(screen) {
  switch (screen) {
    case 'dashboard': await loadDashboard(); break;
    case 'add':       await loadAddScreen(); break;
    case 'analytics': await loadAnalytics(); break;
    case 'limits':    await loadLimits(); break;
    case 'history':   await loadHistory(); break;
  }
}

/* ================================================================
   SKELETON LOADERS
   ================================================================ */
function showDashboardSkeleton() {
  /* Total amount */
  const totalEl = $('dashboard-total');
  if (totalEl) totalEl.classList.add('loading');

  /* Transactions list */
  const txList = $('dashboard-transactions');
  if (txList) {
    txList.innerHTML = [0, 1, 2].map(() =>
      '<div class="skeleton-tx">' +
        '<div class="skeleton" style="width:44px;height:44px;border-radius:13px;flex-shrink:0;"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:8px;">' +
          '<div class="skeleton" style="height:13px;width:58%;"></div>' +
          '<div class="skeleton" style="height:11px;width:38%;"></div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">' +
          '<div class="skeleton" style="height:13px;width:68px;"></div>' +
          '<div class="skeleton" style="height:11px;width:48px;"></div>' +
        '</div>' +
      '</div>'
    ).join('');
  }
}

/* ================================================================
   ERROR STATE
   ================================================================ */
function showErrorState(containerId, onRetry) {
  const el = $(containerId);
  if (!el) return;
  const btnId = 'retry-' + containerId;
  el.innerHTML =
    '<div class="error-state">' +
      '<span class="error-icon">⚠️</span>' +
      '<span class="error-text">Не вдалося завантажити дані</span>' +
      '<button class="retry-btn" id="' + btnId + '">Спробувати знову</button>' +
    '</div>';
  const btn = $(btnId);
  if (btn && onRetry) btn.addEventListener('click', onRetry);
}

/* ================================================================
   DONUT CHART
   ================================================================ */
function drawDonutChart(canvasId, data, size) {
  const canvas = $(canvasId);
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  const outerRadius = size / 2 - 4;
  const innerRadius = outerRadius * 0.62;
  const gapAngle = 0.04;
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0 || data.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerRadius, Math.PI * 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Немає даних', cx, cy);
    return;
  }

  let startAngle = -Math.PI / 2;
  const MIN_ANGLE = 0.07;
  const rawAngles = data.map(item => (item.value / total) * Math.PI * 2);
  const displayAngles = rawAngles.map(a => (a > 0 && a < MIN_ANGLE) ? MIN_ANGLE : a);
  const displayTotal = displayAngles.reduce((s, a) => s + a, 0);
  const scale = (Math.PI * 2) / displayTotal;
  const scaledAngles = displayAngles.map(a => a * scale);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  data.forEach((item, i) => {
    const sliceAngle = scaledAngles[i];
    const effectiveGap = (data.length > 1 && rawAngles[i] > gapAngle * 3) ? gapAngle : 0;
    const drawStart = startAngle + effectiveGap / 2;
    const drawEnd = startAngle + sliceAngle - effectiveGap / 2;
    if (drawEnd > drawStart) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, drawStart, drawEnd);
      ctx.arc(cx, cy, innerRadius, drawEnd, drawStart, true);
      ctx.closePath();
      ctx.fillStyle = item.color;
      ctx.fill();
    }
    startAngle += sliceAngle;
  });

  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerText = total >= 1000000
    ? (total / 1000000).toFixed(1).replace('.0', '') + 'М ₴'
    : total.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴';

  const baseFontSize = size >= 260 ? 22 : 18;
  const totalFontSize = centerText.length > 9 ? Math.round(baseFontSize * 0.75) : baseFontSize;
  const labelFontSize = size >= 260 ? 11 : 10;

  ctx.font = '700 ' + totalFontSize + 'px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(centerText, cx, cy - 4);

  ctx.font = '500 ' + labelFontSize + 'px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('всього', cx, cy + totalFontSize - 2);
}

/* ================================================================
   MONTH NAVIGATION
   ================================================================ */
function prevMonth() {
  hapticImpact('light');
  if (state.viewMonth === 0) { state.viewMonth = 11; state.viewYear--; }
  else state.viewMonth--;
  loadDashboard();
}

function nextMonth() {
  if (isCurrentMonth()) return;
  hapticImpact('light');
  if (state.viewMonth === 11) { state.viewMonth = 0; state.viewYear++; }
  else state.viewMonth++;
  loadDashboard();
}

function updateMonthNavUI() {
  const monthLabel = $('dashboard-month');
  if (monthLabel) monthLabel.textContent = MONTH_NAMES[state.viewMonth] + ' ' + state.viewYear;

  const nextBtn = $('month-next');
  if (nextBtn) {
    nextBtn.disabled = isCurrentMonth();
  }
}

function initMonthNav() {
  const prev = $('month-prev');
  const next = $('month-next');
  if (prev) prev.addEventListener('click', prevMonth);
  if (next) next.addEventListener('click', nextMonth);
}

/* ================================================================
   DASHBOARD
   ================================================================ */
async function loadDashboard() {
  updateMonthNavUI();

  /* Preload categories silently */
  if (state.categories.length === 0) {
    api.getCategories().then(cats => { state.categories = cats || []; }).catch(() => {});
  }

  showDashboardSkeleton();

  try {
    if (isCurrentMonth()) {
      const [analytics, transactions, limits] = await Promise.all([
        api.getAnalytics().catch(() => null),
        api.getTransactions('current_month').catch(() => []),
        api.getLimits().catch(() => [])
      ]);
      state.analytics = analytics;
      state.transactions = transactions || [];
      state.limits = limits || [];
      renderDashboardTotal(analytics);
      renderDashboardChart(analytics);
      renderDashboardLimits(limits);
      renderDashboardTransactions(state.transactions);
    } else {
      /* Past month: load all and filter client-side */
      const [allTx, limits] = await Promise.all([
        api.getTransactions('all', 200).catch(() => []),
        api.getLimits().catch(() => [])
      ]);
      state.limits = limits || [];
      const monthTx = (allTx || []).filter(tx => {
        const d = new Date(tx.created_at);
        return d.getFullYear() === state.viewYear && d.getMonth() === state.viewMonth;
      });
      const analytics = computeAnalyticsFromTransactions(monthTx);
      state.analytics = analytics;
      state.transactions = monthTx;
      renderDashboardTotal(analytics);
      renderDashboardChart(analytics);
      renderDashboardLimits(limits);
      renderDashboardTransactions(monthTx);
    }
  } catch (e) {
    showErrorState('dashboard-transactions', loadDashboard);
    showToast('Помилка: ' + e.message);
  }
}

function renderDashboardTotal(analytics) {
  const el = $('dashboard-total');
  if (!el) return;
  el.classList.remove('loading');
  const total = analytics && analytics.total_spent != null ? analytics.total_spent : 0;
  el.textContent = formatMoney(total);
}

function renderDashboardChart(analytics) {
  const categories = analytics && analytics.categories ? analytics.categories : [];
  const chartData = categories.map(cat => ({
    label: cat.category,
    value: cat.total || 0,
    color: getCategoryColorStable(cat.category)
  }));
  drawDonutChart('dashboard-chart', chartData, 220);

  const legend = $('dashboard-legend');
  if (legend) {
    legend.innerHTML = chartData.map(d =>
      '<div class="legend-item">' +
        '<span class="legend-dot" style="background:' + d.color + '"></span>' +
        '<span>' + escapeHtml(d.label) + '</span>' +
      '</div>'
    ).join('');
  }
}

function renderDashboardLimits(limits) {
  const container = $('dashboard-limits-list');
  if (!container) return;
  if (!limits || limits.length === 0) {
    container.parentElement.style.display = 'none';
    return;
  }
  container.parentElement.style.display = '';
  container.innerHTML = limits.slice(0, 3).map((lim, i) => buildLimitBar(lim, i)).join('');
}

function renderDashboardTransactions(transactions) {
  const container = $('dashboard-transactions');
  if (!container) return;
  if (!transactions || transactions.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📭</span>' +
        '<span class="empty-text">Поки немає витрат</span>' +
      '</div>';
    return;
  }
  container.innerHTML = transactions.slice(0, 5).map((tx, i) => buildTransactionItem(tx, i)).join('');
  attachDeleteHandlers(container, loadDashboard);
}

/* ================================================================
   TRANSACTION ITEM BUILDER (shared: dashboard + history)
   ================================================================ */
function buildTransactionItem(tx, i) {
  const emoji = getCategoryIcon(tx.category);
  const catName = escapeHtml(tx.category || 'Інше');
  const desc = tx.description ? '<div class="transaction-desc">' + escapeHtml(tx.description) + '</div>' : '';
  const amount = formatMoney(tx.amount);
  const date = tx.created_at ? formatDate(tx.created_at) : '';

  return '<div class="transaction-item animate-in" data-id="' + tx.id + '" style="animation-delay:' + (i * 0.05) + 's">' +
    '<div class="transaction-emoji">' + emoji + '</div>' +
    '<div class="transaction-info">' +
      '<div class="transaction-category">' + catName + '</div>' +
      desc +
    '</div>' +
    '<div class="transaction-right">' +
      '<div class="transaction-amount">−' + escapeHtml(amount) + '</div>' +
      '<div class="transaction-date">' + date + '</div>' +
    '</div>' +
    '<button class="tx-delete-btn" data-id="' + tx.id + '" aria-label="Видалити">✕</button>' +
  '</div>';
}

function attachDeleteHandlers(container, onDeleted) {
  container.querySelectorAll('.tx-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hapticImpact('medium');
      const id = btn.dataset.id;
      const item = container.querySelector('.transaction-item[data-id="' + id + '"]');
      if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
      try {
        await api.deleteTransaction(id);
        hapticNotification('success');
        if (onDeleted) await onDeleted();
      } catch (err) {
        hapticNotification('error');
        showToast('Помилка: ' + err.message);
        if (item) { item.style.opacity = ''; item.style.pointerEvents = ''; }
      }
    });
  });
}

/* ================================================================
   HISTORY (All transactions)
   ================================================================ */
async function loadHistory() {
  const container = $('history-list');
  if (!container) return;

  container.innerHTML = [0, 1, 2, 3, 4].map(() =>
    '<div class="skeleton-tx">' +
      '<div class="skeleton" style="width:44px;height:44px;border-radius:13px;flex-shrink:0;"></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:8px;">' +
        '<div class="skeleton" style="height:13px;width:55%;"></div>' +
        '<div class="skeleton" style="height:11px;width:36%;"></div>' +
      '</div>' +
      '<div class="skeleton" style="height:13px;width:68px;flex-shrink:0;"></div>' +
    '</div>'
  ).join('');

  try {
    /* Ensure categories are loaded for icons */
    if (state.categories.length === 0) {
      state.categories = await api.getCategories().catch(() => []);
    }
    const transactions = await api.getTransactions('all', 200);
    renderHistory(transactions || []);
  } catch (e) {
    showErrorState('history-list', loadHistory);
  }
}

function renderHistory(transactions) {
  const container = $('history-list');
  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📭</span>' +
        '<span class="empty-text">Немає жодної витрати</span>' +
      '</div>';
    return;
  }

  /* Group by day */
  const groups = {};
  const order = [];
  transactions.forEach(tx => {
    const label = getDayLabel(tx.created_at);
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label].push(tx);
  });

  let idx = 0;
  let html = '';
  order.forEach(label => {
    html += '<div class="tx-date-group">' + escapeHtml(label) + '</div>';
    html += groups[label].map(tx => buildTransactionItem(tx, idx++)).join('');
  });

  container.innerHTML = html;
  attachDeleteHandlers(container, loadHistory);
}

function initHistory() {
  const backBtn = $('history-back');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('dashboard'));

  const seeAllBtn = $('dashboard-see-all');
  if (seeAllBtn) seeAllBtn.addEventListener('click', () => navigateTo('history'));
}

/* ================================================================
   ADD TRANSACTION
   ================================================================ */
async function loadAddScreen() {
  if (state.categories.length === 0) {
    try {
      state.categories = await api.getCategories();
    } catch (e) {
      showToast('Не вдалося завантажити категорії');
    }
  }
  renderCategories();
}

function renderCategories() {
  const grid = $('add-categories');
  if (!grid) return;
  grid.innerHTML = state.categories.map(cat => {
    const sel = state.selectedCategory === cat.name ? ' selected' : '';
    return '<button class="category-card' + sel + '" data-name="' + escapeHtml(cat.name) + '">' +
      '<span class="category-card-emoji">' + (cat.icon || '📦') + '</span>' +
      '<span class="category-card-label">' + escapeHtml(cat.name) + '</span>' +
    '</button>';
  }).join('');

  grid.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      hapticImpact('light');
      state.selectedCategory = card.dataset.name;
      grid.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateSubmitState();
    });
  });
}

function initAddScreen() {
  const amountInput = $('add-amount');
  amountInput.addEventListener('input', () => {
    let val = amountInput.value.replace(/[^\d.,]/g, '').replace(',', '.');
    val = val.replace(/^0+(\d)/, '$1');
    const parts = val.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    amountInput.value = parts.join('.');
    updateSubmitState();
  });
  $('add-submit').addEventListener('click', submitTransaction);
}

function updateSubmitState() {
  $('add-submit').disabled = !(parseAmountInput() > 0 && state.selectedCategory);
}

function parseAmountInput() {
  return parseFloat(($('add-amount').value || '').replace(/\s/g, '').replace(',', '.')) || 0;
}

async function submitTransaction() {
  const amount = parseAmountInput();
  if (amount <= 0 || !state.selectedCategory) return;

  const desc = ($('add-description').value || '').trim();
  const btn = $('add-submit');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    await api.addTransaction(state.selectedCategory, amount, desc);
    hapticNotification('success');

    const overlay = $('add-success');
    overlay.classList.add('show');
    setTimeout(() => {
      overlay.classList.remove('show');
      $('add-amount').value = '';
      $('add-description').value = '';
      state.selectedCategory = null;
      document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
      updateSubmitState();
      navigateTo('dashboard');
    }, 1200);
  } catch (e) {
    hapticNotification('error');
    showToast('Помилка: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
    updateSubmitState();
  }
}

/* ================================================================
   ANALYTICS
   ================================================================ */
async function loadAnalytics() {
  try {
    const [analytics, limits] = await Promise.all([
      api.getAnalytics().catch(() => null),
      api.getLimits().catch(() => [])
    ]);
    state.analytics = analytics;
    state.limits = limits || [];
    renderAnalyticsChart(analytics);
    renderAnalyticsBreakdown(analytics);
    renderAnalyticsLimits(limits);
  } catch (e) {
    showToast('Помилка завантаження аналітики');
  }
}

function renderAnalyticsChart(analytics) {
  const categories = analytics && analytics.categories ? analytics.categories : [];
  drawDonutChart('analytics-chart', categories.map(cat => ({
    label: cat.category,
    value: cat.total || 0,
    color: getCategoryColorStable(cat.category)
  })), 280);
}

function renderAnalyticsBreakdown(analytics) {
  const container = $('analytics-breakdown');
  if (!container) return;
  const categories = analytics && analytics.categories ? analytics.categories : [];
  const totalSpent = analytics && analytics.total_spent != null ? analytics.total_spent : 0;

  if (categories.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📊</span>' +
        '<span class="empty-text">Немає даних за цей місяць</span>' +
      '</div>';
    return;
  }

  container.innerHTML = categories.map((cat, i) => {
    const amount = cat.total || 0;
    const pct = totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(1) : 0;
    const color = getCategoryColorStable(cat.category);
    const emoji = getCategoryIcon(cat.category);
    return '<div class="breakdown-item animate-in" style="animation-delay:' + (i * 0.05) + 's">' +
      '<div class="breakdown-color" style="background:' + color + '"></div>' +
      '<div class="breakdown-info">' +
        '<div class="breakdown-name">' + emoji + ' ' + escapeHtml(cat.category) + '</div>' +
        '<div class="breakdown-bar-bg"><div class="breakdown-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '</div>' +
      '<div class="breakdown-values">' +
        '<div class="breakdown-amount">' + escapeHtml(formatMoney(amount)) + '</div>' +
        '<div class="breakdown-pct">' + pct + '%</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderAnalyticsLimits(limits) {
  const section = $('analytics-limits-section');
  const container = $('analytics-limits-bars');
  if (!container || !section) return;
  if (!limits || limits.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  container.innerHTML = limits.map((lim, i) => buildLimitBar(lim, i)).join('');
}

/* ================================================================
   LIMITS
   ================================================================ */
async function loadLimits() {
  try {
    state.limits = await api.getLimits() || [];
    renderLimits(state.limits);
  } catch (e) {
    showErrorState('limits-list', loadLimits);
  }
}

function renderLimits(limits) {
  const container = $('limits-list');
  if (!container) return;

  if (!limits || limits.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📊</span>' +
        '<span class="empty-text">Ліміти не встановлені</span>' +
      '</div>';
    return;
  }

  container.innerHTML = limits.map((lim, i) => {
    const spent = lim.spent || 0;
    const total = lim.limit_amount || 0;
    const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;
    const pctFull = total > 0 ? (spent / total) * 100 : 0;
    const colorClass = pct < 60 ? 'green' : pct < 85 ? 'yellow' : 'red';
    const emoji = getCategoryIcon(lim.category);
    return '<div class="limit-card animate-in" style="animation-delay:' + (i * 0.06) + 's">' +
      '<div class="limit-card-header">' +
        '<div class="limit-card-left">' +
          '<span class="limit-card-emoji">' + emoji + '</span>' +
          '<span class="limit-card-name">' + escapeHtml(lim.category) + '</span>' +
        '</div>' +
        '<button class="limit-card-delete" data-id="' + lim.id + '" title="Видалити">✕</button>' +
      '</div>' +
      '<div class="limit-progress-bar">' +
        '<div class="limit-progress-fill ' + colorClass + '" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="limit-card-footer">' +
        '<span class="limit-spent">' + escapeHtml(formatMoney(spent)) + ' / ' + escapeHtml(formatMoney(total)) + '</span>' +
        '<span class="limit-pct ' + colorClass + '">' + Math.round(pctFull) + '%</span>' +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.limit-card-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hapticImpact('medium');
      try {
        await api.deleteLimit(btn.dataset.id);
        hapticNotification('success');
        showToast('Ліміт видалено');
        await loadLimits();
      } catch (err) {
        showToast('Помилка: ' + err.message);
      }
    });
  });
}

function buildLimitBar(lim, index) {
  const spent = lim.spent || 0;
  const total = lim.limit_amount || 0;
  const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;
  const colorClass = pct < 60 ? 'green' : pct < 85 ? 'yellow' : 'red';
  const emoji = getCategoryIcon(lim.category);
  return '<div class="limit-card animate-in" style="animation-delay:' + (index * 0.05) + 's">' +
    '<div class="limit-card-header">' +
      '<div class="limit-card-left">' +
        '<span class="limit-card-emoji">' + emoji + '</span>' +
        '<span class="limit-card-name">' + escapeHtml(lim.category) + '</span>' +
      '</div>' +
      '<span class="limit-pct ' + colorClass + '">' + Math.round(pct) + '%</span>' +
    '</div>' +
    '<div class="limit-progress-bar">' +
      '<div class="limit-progress-fill ' + colorClass + '" style="width:' + pct + '%"></div>' +
    '</div>' +
    '<div class="limit-card-footer">' +
      '<span class="limit-spent">' + escapeHtml(formatMoney(spent)) + '</span>' +
      '<span class="limit-total">із ' + escapeHtml(formatMoney(total)) + '</span>' +
    '</div>' +
  '</div>';
}

/* ================================================================
   LIMIT MODAL
   ================================================================ */
function initLimitModal() {
  const overlay = $('limit-modal-overlay');
  const addBtn = $('limits-add-btn');
  const cancelBtn = $('limit-cancel');
  const amountInput = $('limit-amount');

  addBtn.addEventListener('click', () => {
    hapticImpact('light');
    populateLimitCategorySelect();
    overlay.classList.add('open');
  });

  cancelBtn.addEventListener('click', () => overlay.classList.remove('open'));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

  amountInput.addEventListener('input', () => {
    let val = amountInput.value.replace(/[^\d.,]/g, '').replace(',', '.');
    val = val.replace(/^0+(\d)/, '$1');
    const parts = val.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    amountInput.value = parts.join('.');
  });

  $('limit-save').addEventListener('click', saveLimitFromModal);
}

async function populateLimitCategorySelect() {
  if (state.categories.length === 0) {
    try { state.categories = await api.getCategories() || []; } catch (e) {}
  }
  const select = $('limit-category');
  select.innerHTML = '<option value="" disabled selected>Оберіть категорію</option>';
  state.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = (cat.icon || '📦') + ' ' + cat.name;
    select.appendChild(opt);
  });
  $('limit-amount').value = '';
}

async function saveLimitFromModal() {
  const category = $('limit-category').value;
  const amount = parseFloat(($('limit-amount').value || '').replace(/\s/g, '').replace(',', '.')) || 0;
  if (!category) { showToast('Оберіть категорію'); return; }
  if (amount <= 0) { showToast('Введіть суму ліміту'); return; }
  try {
    await api.addLimit(category, amount);
    hapticNotification('success');
    showToast('Ліміт додано');
    $('limit-modal-overlay').classList.remove('open');
    await loadLimits();
  } catch (e) {
    hapticNotification('error');
    showToast('Помилка: ' + e.message);
  }
}

/* ================================================================
   INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTelegram();
  initNavigation();
  initAddScreen();
  initLimitModal();
  initMonthNav();
  initHistory();

  const dashboard = $('screen-dashboard');
  if (dashboard) {
    dashboard.classList.add('active');
    requestAnimationFrame(() => requestAnimationFrame(() => dashboard.classList.add('visible')));
  }

  loadScreenData('dashboard');
});
