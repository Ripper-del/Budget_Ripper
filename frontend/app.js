/* ================================================================
   TELEGRAM MINI APP — WALLET / EXPENSE TRACKER
   Vanilla JS  •  No frameworks
   ================================================================

   Backend API contract:
   - GET  /api/categories       → [{name, icon}, ...]
   - POST /api/transactions     → {category: string, amount: float, description?: string}
   - GET  /api/transactions     → [{id, amount, category, description, created_at}, ...]
   - DELETE /api/transactions/:id
   - GET  /api/analytics        → {total_spent, categories: [{category, total, limit_amount?, percentage?}], period_start, period_end}
   - POST /api/limits           → {category: string, limit_amount: float, period?: string}
   - GET  /api/limits           → [{id, category, limit_amount, period, spent}, ...]
   - DELETE /api/limits/:id
   ================================================================ */

// === КОНФІГУРАЦІЯ ===
// Вкажіть URL вашого бекенду (Hugging Face Space URL), наприклад:
// const API_BASE_URL = 'https://username-tg-wallet-backend.hf.space';
const API_BASE_URL = 'https://budget-ripper.onrender.com';

/* ---------- Category Color Palette ---------- */
const CATEGORY_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c',
  '#4facfe', '#00f2fe', '#43e97b', '#fa709a',
  '#fee140', '#ffa751', '#a18cd1', '#fbc2eb'
];

/* ---------- Month Names ---------- */
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
  categories: [],     // [{name: "Їжа", icon: "🍔"}, ...]
  limits: [],
  analytics: null,
  selectedCategory: null,  // рядок — ім'я категорії, наприклад "Їжа"
  isLoading: false
};

/* ================================================================
   TELEGRAM WEBAPP INIT
   ================================================================ */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) {
    tg.setHeaderColor('#0a0a0f');
  }
  if (tg.setBackgroundColor) {
    tg.setBackgroundColor('#0a0a0f');
  }
}

function hapticImpact(style) {
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style || 'light');
  } catch (e) { /* ignore */ }
}

function hapticNotification(type) {
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type);
  } catch (e) { /* ignore */ }
}

/* ================================================================
   UTILITIES
   ================================================================ */
function formatMoney(amount) {
  const num = Math.abs(Number(amount) || 0);
  const formatted = num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return formatted + ' ₴';
}

function formatMoneyShort(amount) {
  const num = Number(amount) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'М ₴';
  if (num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'К ₴';
  return num.toFixed(0) + ' ₴';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return day + ' ' + month.substring(0, 3).toLowerCase() + ', ' + hours + ':' + mins;
}

function getCategoryColor(index) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

/** Знайти іконку категорії за ім'ям */
function getCategoryIcon(categoryName) {
  const cat = state.categories.find(c => c.name === categoryName);
  return cat ? cat.icon : '💼';
}

/** Знайти індекс категорії за ім'ям (для кольору) */
function getCategoryIndex(categoryName) {
  const idx = state.categories.findIndex(c => c.name === categoryName);
  return idx >= 0 ? idx : 0;
}

function getAuthHeader() {
  return (tg && tg.initData) ? tg.initData : '';
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ================================================================
   TOAST
   ================================================================ */
let toastTimer = null;
function showToast(message, duration) {
  const toast = $('toast');
  const text = $('toast-text');
  text.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration || 2500);
}

/* ================================================================
   GLOBAL LOADER
   ================================================================ */
function showLoader() {
  $('global-loader').classList.add('show');
}

function hideLoader() {
  $('global-loader').classList.remove('show');
}

/* ================================================================
   API MODULE
   ================================================================ */
const api = {
  async request(method, path, body) {
    const url = API_BASE_URL + path;
    const opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader()
      }
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || 'Помилка сервера');
      }
      if (res.status === 204) return null;
      return await res.json();
    } catch (e) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error('Немає підключення до сервера');
      }
      throw e;
    }
  },

  // Категорії: GET /api/categories → [{name, icon}, ...]
  getCategories() {
    return this.request('GET', '/api/categories');
  },

  // Транзакції: GET /api/transactions?period=current_month
  getTransactions(period) {
    const q = period ? '?period=' + period : '';
    return this.request('GET', '/api/transactions' + q);
  },

  // Додавання витрати: POST /api/transactions — {category: "Їжа", amount: 500, description: ""}
  addTransaction(category, amount, description) {
    return this.request('POST', '/api/transactions', {
      category: category,
      amount: amount,
      description: description || null
    });
  },

  deleteTransaction(id) {
    return this.request('DELETE', '/api/transactions/' + id);
  },

  // Аналітика: GET /api/analytics → {total_spent, categories: [{category, total, limit_amount?, percentage?}]}
  getAnalytics() {
    return this.request('GET', '/api/analytics');
  },

  // Ліміти: GET /api/limits → [{id, category, limit_amount, period, spent}, ...]
  getLimits() {
    return this.request('GET', '/api/limits');
  },

  // Створення ліміту: POST /api/limits — {category: "Їжа", limit_amount: 5000}
  addLimit(category, limitAmount) {
    return this.request('POST', '/api/limits', {
      category: category,
      limit_amount: limitAmount
    });
  },

  deleteLimit(id) {
    return this.request('DELETE', '/api/limits/' + id);
  }
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

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.screen === screen);
  });

  setTimeout(() => {
    const next = $('screen-' + screen);
    if (next) {
      next.classList.add('active');
      next.scrollTop = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => next.classList.add('visible'));
      });
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
    case 'add': await loadAddScreen(); break;
    case 'analytics': await loadAnalytics(); break;
    case 'limits': await loadLimits(); break;
  }
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

  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 4;
  const innerRadius = outerRadius * 0.62;
  const gapAngle = 0.04;

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0 || data.length === 0) {
    /* Порожній стан — сіре кільце */
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

  /* Тінь */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  data.forEach((item) => {
    const sliceAngle = (item.value / total) * Math.PI * 2;
    const effectiveGap = data.length > 1 ? gapAngle : 0;
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

  /* Текст у центрі */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const totalFontSize = size >= 260 ? 22 : 18;
  const labelFontSize = size >= 260 ? 11 : 10;

  ctx.font = '700 ' + totalFontSize + 'px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(formatMoneyShort(total), cx, cy - 4);

  ctx.font = '500 ' + labelFontSize + 'px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('всього', cx, cy + totalFontSize - 2);
}

/* ================================================================
   DASHBOARD
   ================================================================ */
async function loadDashboard() {
  const now = new Date();
  const monthLabel = $('dashboard-month');
  if (monthLabel) monthLabel.textContent = MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();

  // Завантажуємо категорії в фоні, якщо вони ще не завантажені
  if (state.categories.length === 0) {
    api.getCategories().then(cats => { state.categories = cats || []; }).catch(() => {});
  }

  try {
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
  } catch (e) {
    showToast('Помилка завантаження: ' + e.message);
  }
}

function renderDashboardTotal(analytics) {
  const el = $('dashboard-total');
  if (!el) return;
  const total = analytics && analytics.total_spent != null ? analytics.total_spent : 0;
  el.textContent = formatMoney(total);
}

function renderDashboardChart(analytics) {
  const categories = analytics && analytics.categories ? analytics.categories : [];
  const chartData = categories.map((cat, i) => ({
    label: cat.category,
    value: cat.total || 0,
    color: getCategoryColor(getCategoryIndex(cat.category))
  }));

  drawDonutChart('dashboard-chart', chartData, 220);

  const legend = $('dashboard-legend');
  if (!legend) return;
  legend.innerHTML = chartData.map(d =>
    '<div class="legend-item">' +
      '<span class="legend-dot" style="background:' + d.color + '"></span>' +
      '<span>' + escapeHtml(d.label) + '</span>' +
    '</div>'
  ).join('');
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

  // Показуємо максимум 5 останніх
  const recent = transactions.slice(0, 5);

  container.innerHTML = recent.map((tx, i) => {
    const emoji = getCategoryIcon(tx.category);
    const catName = tx.category || 'Інше';
    const desc = tx.description || '';
    const amount = formatMoney(tx.amount);
    const date = tx.created_at ? formatDate(tx.created_at) : '';
    return '<div class="transaction-item animate-in" style="animation-delay:' + (i * 0.06) + 's">' +
      '<div class="transaction-emoji">' + emoji + '</div>' +
      '<div class="transaction-info">' +
        '<div class="transaction-category">' + escapeHtml(catName) + '</div>' +
        (desc ? '<div class="transaction-desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
      '<div class="transaction-right">' +
        '<div class="transaction-amount">−' + escapeHtml(amount) + '</div>' +
        '<div class="transaction-date">' + date + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ================================================================
   ADD TRANSACTION
   ================================================================ */
async function loadAddScreen() {
  if (state.categories.length === 0) {
    try {
      const cats = await api.getCategories();
      state.categories = cats || [];
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
    const name = cat.name;
    const emoji = cat.icon || '📦';
    const selected = state.selectedCategory === name ? ' selected' : '';
    return '<button class="category-card' + selected + '" data-name="' + escapeHtml(name) + '">' +
      '<span class="category-card-emoji">' + emoji + '</span>' +
      '<span class="category-card-label">' + escapeHtml(name) + '</span>' +
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
  const submitBtn = $('add-submit');

  amountInput.addEventListener('input', () => {
    let val = amountInput.value.replace(/[^\d.,]/g, '').replace(',', '.');
    /* remove leading zeros */
    val = val.replace(/^0+(\d)/, '$1');
    /* format with spaces */
    const parts = val.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    amountInput.value = parts.join('.');
    updateSubmitState();
  });

  submitBtn.addEventListener('click', submitTransaction);
}

function updateSubmitState() {
  const amount = parseAmountInput();
  const btn = $('add-submit');
  btn.disabled = !(amount > 0 && state.selectedCategory);
}

function parseAmountInput() {
  const raw = ($('add-amount').value || '').replace(/\s/g, '').replace(',', '.');
  return parseFloat(raw) || 0;
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

    /* Показуємо анімацію успіху */
    const overlay = $('add-success');
    overlay.classList.add('show');
    setTimeout(() => {
      overlay.classList.remove('show');
      /* Скидаємо форму */
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
  const chartData = categories.map((cat) => ({
    label: cat.category,
    value: cat.total || 0,
    color: getCategoryColor(getCategoryIndex(cat.category))
  }));

  drawDonutChart('analytics-chart', chartData, 280);
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
    const color = getCategoryColor(getCategoryIndex(cat.category));
    const name = cat.category;
    const emoji = getCategoryIcon(cat.category);
    return '<div class="breakdown-item animate-in" style="animation-delay:' + (i * 0.05) + 's">' +
      '<div class="breakdown-color" style="background:' + color + '"></div>' +
      '<div class="breakdown-info">' +
        '<div class="breakdown-name">' + emoji + ' ' + escapeHtml(name) + '</div>' +
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

  if (!limits || limits.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  container.innerHTML = limits.map((lim, i) => buildLimitBar(lim, i)).join('');
}

/* ================================================================
   LIMITS
   ================================================================ */
async function loadLimits() {
  try {
    const limits = await api.getLimits();
    state.limits = limits || [];
    renderLimits(state.limits);
  } catch (e) {
    showToast('Помилка завантаження лімітів');
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
    const pctFull = total > 0 ? ((spent / total) * 100) : 0;
    const colorClass = pct < 60 ? 'green' : pct < 85 ? 'yellow' : 'red';
    const emoji = getCategoryIcon(lim.category);
    const name = lim.category;

    return '<div class="limit-card animate-in" style="animation-delay:' + (i * 0.06) + 's">' +
      '<div class="limit-card-header">' +
        '<div class="limit-card-left">' +
          '<span class="limit-card-emoji">' + emoji + '</span>' +
          '<span class="limit-card-name">' + escapeHtml(name) + '</span>' +
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
      const id = btn.dataset.id;
      try {
        await api.deleteLimit(id);
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
  const name = lim.category;

  return '<div class="limit-card animate-in" style="animation-delay:' + (index * 0.05) + 's">' +
    '<div class="limit-card-header">' +
      '<div class="limit-card-left">' +
        '<span class="limit-card-emoji">' + emoji + '</span>' +
        '<span class="limit-card-name">' + escapeHtml(name) + '</span>' +
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
  const saveBtn = $('limit-save');
  const amountInput = $('limit-amount');

  addBtn.addEventListener('click', () => {
    hapticImpact('light');
    populateLimitCategorySelect();
    overlay.classList.add('open');
  });

  cancelBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
  });

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

  saveBtn.addEventListener('click', saveLimitFromModal);
}

async function populateLimitCategorySelect() {
  if (state.categories.length === 0) {
    try {
      const cats = await api.getCategories();
      state.categories = cats || [];
    } catch (e) { /* ignore */ }
  }

  const select = $('limit-category');
  select.innerHTML = '<option value="" disabled selected>Оберіть категорію</option>';
  state.categories.forEach(cat => {
    const emoji = cat.icon || '📦';
    const name = cat.name;
    const opt = document.createElement('option');
    opt.value = name;  // значення = рядок з ім'ям категорії
    opt.textContent = emoji + ' ' + escapeHtml(name);
    select.appendChild(opt);
  });

  /* Скидання полів */
  $('limit-amount').value = '';
}

async function saveLimitFromModal() {
  const category = $('limit-category').value;  // рядок — ім'я категорії
  const rawAmount = ($('limit-amount').value || '').replace(/\s/g, '').replace(',', '.');
  const amount = parseFloat(rawAmount) || 0;

  if (!category) {
    showToast('Оберіть категорію');
    return;
  }
  if (amount <= 0) {
    showToast('Введіть суму ліміту');
    return;
  }

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

  /* Активуємо дашборд */
  const dashboard = $('screen-dashboard');
  if (dashboard) {
    dashboard.classList.add('active');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => dashboard.classList.add('visible'));
    });
  }

  loadScreenData('dashboard');
});
