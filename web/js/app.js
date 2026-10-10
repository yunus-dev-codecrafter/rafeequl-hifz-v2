'use strict';

/* ==========================================================================
   Rafeequl Hifz (رفيق الحفظ) — Application Core
   Features:
   1. Modern Theme Engine (Light / Dark / System)
   2. Screen Stay-Awake Engine (Wake Lock API)
   3. Individual Page-by-Page Completion Tracking
   4. Dedicated Task Pages Controller
   5. Dynamic Mistake Logging & Badging
   ========================================================================== */

/* ---------------- 1. API Helper ---------------- */

const API = {
  async call(path, { method = 'GET', body = null, redirectOn401 = false } = {}) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
      },
    };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch('../api/' + path, opts);
    } catch (e) {
      throw new Error('تعذر الاتصال بالخادم. يرجى التحقق من الاتصال.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (res.status === 401 && redirectOn401) {
      location.href = 'index.html';
      throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجدداً.');
    }

    if (!res.ok) {
      const err = new Error(apiMessage(data));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
};

function apiMessage(data) {
  if (!data) return 'حدث خطأ غير متوقع.';
  if (data.error) return data.error;
  if (data.errors) {
    const list = Object.values(data.errors);
    if (list.length) return list.join(' · ');
  }
  return 'حدث خطأ غير متوقع.';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function showToast(message, isError = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast hidden';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3400);
}

/* ---------------- 2. Theme Engine (Light / Dark) ---------------- */

const THEME_KEY = 'hifz-theme';
let currentTheme = 'system';

try {
  currentTheme = localStorage.getItem(THEME_KEY) || 'system';
} catch (e) {
  currentTheme = 'system';
}

function applyTheme(theme) {
  currentTheme = theme;
  const html = document.documentElement;
  if (theme === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }
  updateThemeIcon();
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

function updateThemeIcon() {
  const btns = document.querySelectorAll('.theme-toggle-btn');
  const active = document.documentElement.getAttribute('data-theme');
  btns.forEach((btn) => {
    btn.setAttribute('data-current-theme', active);
    btn.title = active === 'dark' ? 'الوضع الحالي: داكن (انقر للتحويل إلى الفاتح)' : 'الوضع الحالي: فاتح (انقر للتحويل إلى الداكن)';
    btn.setAttribute('aria-label', btn.title);
  });
}

function cycleTheme() {
  const currentActive = document.documentElement.getAttribute('data-theme');
  if (currentActive === 'dark') {
    applyTheme('light');
    showToast('تم التحويل إلى الوضع الفاتح ☀️');
  } else {
    applyTheme('dark');
    showToast('تم التحويل إلى الوضع الداكن 🌙');
  }
}

function initThemeEngine() {
  applyTheme(currentTheme);
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', cycleTheme);
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme === 'system') applyTheme('system');
    });
  }
}

/* ---------------- 3. Wake Lock Engine (Stay Awake) ---------------- */

const WAKELOCK_KEY = 'hifz-wakelock';
let wakeLockSentinel = null;
let wakeLockEnabled = true;

try {
  const storedWake = localStorage.getItem(WAKELOCK_KEY);
  if (storedWake !== null) wakeLockEnabled = storedWake === '1';
} catch (e) {
  wakeLockEnabled = true;
}

function wakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function updateWakeLockUI() {
  const btns = document.querySelectorAll('.wakelock-toggle-btn');
  btns.forEach((btn) => {
    btn.setAttribute('data-wakelock', wakeLockEnabled ? 'on' : 'off');
    btn.title = wakeLockEnabled
      ? (wakeLockSupported() ? 'إبقاء الشاشة مضاءة: مفعّل (لن تنطفئ الشاشة أثناء التلاوة)' : 'إبقاء الشاشة مضاءة: مفعّل (غير مدعوم في هذا المتصفح)')
      : 'إبقاء الشاشة مضاءة: متوقف (ستنطفئ الشاشة بشكل طبيعي)';
    btn.setAttribute('aria-label', btn.title);
  });
}

async function requestWakeLock() {
  if (!wakeLockEnabled || !wakeLockSupported()) {
    updateWakeLockUI();
    return;
  }
  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) return;
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      updateWakeLockUI();
    });
    updateWakeLockUI();
  } catch (err) {
    updateWakeLockUI();
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try { await wakeLockSentinel.release(); } catch (e) {}
    wakeLockSentinel = null;
  }
  updateWakeLockUI();
}

function toggleWakeLock() {
  wakeLockEnabled = !wakeLockEnabled;
  try { localStorage.setItem(WAKELOCK_KEY, wakeLockEnabled ? '1' : '0'); } catch (e) {}
  if (wakeLockEnabled) {
    requestWakeLock();
    showToast('تم تفعيل إبقاء الشاشة مضاءة 💡');
  } else {
    releaseWakeLock();
    showToast('تم إيقاف إبقاء الشاشة مضاءة');
  }
  updateWakeLockUI();
}

function initWakeLockEngine() {
  updateWakeLockUI();
  if (wakeLockEnabled) requestWakeLock();

  document.querySelectorAll('.wakelock-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', toggleWakeLock);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wakeLockEnabled) {
      requestWakeLock();
    } else if (document.hidden) {
      releaseWakeLock();
    }
  });
}

/* ---------------- 3b. Web Audio Feedback Engine ---------------- */

const AudioEngine = {
  enabled: true,
  init() {
    try {
      const stored = localStorage.getItem('hifz-sound');
      if (stored !== null) this.enabled = stored === '1';
    } catch (e) {
      this.enabled = true;
    }
    this.updateUI();
    document.querySelectorAll('.sound-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.toggle());
    });
  },
  updateUI() {
    document.querySelectorAll('.sound-toggle-btn').forEach((btn) => {
      btn.setAttribute('data-sound', this.enabled ? 'on' : 'off');
      btn.title = this.enabled ? 'المؤثرات الصوتية: مفعّلة (انقر للكتم)' : 'المؤثرات الصوتية: مكتومة (انقر للتفعيل)';
      btn.setAttribute('aria-label', btn.title);
    });
  },
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('hifz-sound', this.enabled ? '1' : '0'); } catch (e) {}
    this.updateUI();
    showToast(this.enabled ? 'تم تفعيل المؤثرات الصوتية 🔊' : 'تم كتم المؤثرات الصوتية 🔇');
    if (this.enabled) this.playSuccess();
  },
  playSuccess() {
    if (!this.enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.12); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.28); // G5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  },
  playCelebration() {
    if (!this.enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.09);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.09 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.09);
        osc.stop(ctx.currentTime + idx * 0.09 + 0.35);
      });
    } catch (e) {}
  }
};

/* ---------------- 4. Shared State & Metadata ---------------- */

const sharedState = {
  tasks: [],
  user: null,
  date: '',
  history: [],
  badges: {},
  surahs: null,
};

async function loadSharedData() {
  const [tasksRes, historyRes] = await Promise.all([
    API.call('tasks/get_daily_tasks.php', { redirectOn401: true }),
    API.call('mistakes/get_history.php', { redirectOn401: true }),
  ]);

  sharedState.tasks = tasksRes.tasks || [];
  sharedState.user = tasksRes.user || null;
  sharedState.date = tasksRes.date || '';

  sharedState.history = historyRes.history || [];
  sharedState.badges = {};
  sharedState.history.forEach((m) => {
    sharedState.badges[m.page_number] = (sharedState.badges[m.page_number] || 0) + 1;
  });

  return { tasks: sharedState.tasks, user: sharedState.user, history: sharedState.history };
}

/* ---------------- 5. Auth Controller (index.html) ---------------- */

function initAuthPage() {
  const tabs = document.querySelectorAll('.tab');
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const errorBox = document.getElementById('auth-error');
  const existingFields = document.getElementById('existing-fields');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.toggle('hidden', !message);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isRegister = tab.dataset.tab === 'register';
      registerForm.classList.toggle('hidden', !isRegister);
      loginForm.classList.toggle('hidden', isRegister);
      showError('');
    });
  });

  registerForm.querySelectorAll('input[name="user_type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isExisting = radio.value === 'EXISTING';
      existingFields.classList.toggle('hidden', !isExisting);
      const pageInput = document.getElementById('reg-page');
      if (isExisting) {
        pageInput.setAttribute('required', 'required');
        pageInput.focus();
      } else {
        pageInput.removeAttribute('required');
      }
    });
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = registerForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const daysSelect = document.getElementById('reg-days');
    const body = {
      name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      user_type: registerForm.querySelector('input[name="user_type"]:checked')?.value || 'NEW',
      murajaah_days: daysSelect ? (parseInt(daysSelect.value, 10) || 6) : 6,
    };

    if (body.user_type === 'EXISTING') {
      body.current_hifz_page = parseInt(document.getElementById('reg-page').value, 10);
    }

    try {
      const res = await API.call('auth/register.php', { method: 'POST', body });
      if (res.user && res.user.name) {
        localStorage.setItem('hifz_name', res.user.name);
      }
      showToast('تم إنشاء الحساب بنجاح! مرحباً بك 📖');
      setTimeout(() => { location.href = 'dashboard.html'; }, 400);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const body = {
      email: document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value,
    };

    try {
      const res = await API.call('auth/login.php', { method: 'POST', body });
      if (res.user && res.user.name) {
        localStorage.setItem('hifz_name', res.user.name);
      }
      showToast('تم تسجيل الدخول بنجاح ✓');
      setTimeout(() => { location.href = 'dashboard.html'; }, 300);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  });
}

/* ---------------- 6. Dashboard Controller (dashboard.html) ---------------- */

const TASK_DESTINATIONS = {
  HIFZ_JADID: { url: 'hifz.html',       cls: 'task-green',  title: 'الحفظ الجديد', sub: 'صفحة جديدة اليوم' },
  RABT:       { url: 'rabt.html',       cls: 'task-blue',   title: 'الربط',        sub: 'نافذة الربط المستمرة' },
  MURAJAAH:   { url: 'murajaah.html',   cls: 'task-purple', title: 'المراجعة',     sub: 'ختم دوري مقسم على الأيام' },
  MISTAKES:   { url: 'flashcards.html', cls: 'task-red',    title: 'المعالجة',     sub: 'تدريب البطاقات الذكية' },
};

async function initDashboard() {
  const name = localStorage.getItem('hifz_name');
  if (name && document.getElementById('greeting')) {
    document.getElementById('greeting').textContent = 'مرحباً، ' + name;
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('hifz_name');
      location.href = 'index.html';
    });
  }

  initHeaderDropdown();
  initResetModal();
  initPlanModal();

  try {
    await loadSharedData();
    renderDashboardUI();
  } catch (err) {
    if (err.status !== 401) {
      const grid = document.getElementById('tasks-grid');
      if (grid) grid.innerHTML = '<p class="hint" style="color:var(--danger)">' + esc(err.message) + '</p>';
      showToast(err.message, true);
    }
  }
}

function initHeaderDropdown() {
  const menuBtn = document.getElementById('btn-header-menu');
  const dropdown = document.getElementById('header-dropdown-menu');
  if (!menuBtn || !dropdown) return;

  function toggleMenu(e) {
    e.stopPropagation();
    const isClosed = dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', !isClosed);
    menuBtn.setAttribute('aria-expanded', isClosed ? 'true' : 'false');
  }

  menuBtn.addEventListener('click', toggleMenu);

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== menuBtn) {
      dropdown.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  dropdown.querySelectorAll('button, a').forEach((item) => {
    item.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

function initResetModal() {
  const resetModal = document.getElementById('reset-modal');
  const openBtn = document.getElementById('btn-open-reset');
  const closeBtn = document.getElementById('reset-modal-close');
  const cancelBtn = document.getElementById('reset-modal-cancel');
  const confirmBtn = document.getElementById('btn-confirm-reset');

  if (!resetModal || !confirmBtn) return;

  function openReset() {
    resetModal.classList.remove('hidden');
  }
  function closeReset() {
    resetModal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openReset);
  if (closeBtn) closeBtn.addEventListener('click', closeReset);
  if (cancelBtn) cancelBtn.addEventListener('click', closeReset);
  resetModal.addEventListener('click', (e) => {
    if (e.target === resetModal) closeReset();
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جاري التصفير…';

    try {
      const body = sharedState.user && sharedState.user.id ? { user_id: sharedState.user.id } : null;
      await API.call('auth/reset.php', { method: 'POST', body, redirectOn401: true });
      closeReset();
      if (window.AudioEngine) AudioEngine.playSuccess();
      showToast('تم تصفير الحساب ومسح جميع السجلات بنجاح 🔄');
      await loadSharedData();
      renderDashboardUI();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'نعم، صفّر كل شيء وابدأ من جديد';
    }
  });
}

function initPlanModal() {
  const modal = document.getElementById('plan-modal');
  if (!modal) return;

  const openBtns = [
    document.getElementById('btn-open-plan'),
    document.getElementById('btn-quick-plan'),
    document.getElementById('btn-target-stat'),
  ];
  const closeBtn = document.getElementById('plan-modal-close');
  const cancelBtn = document.getElementById('plan-modal-cancel');
  const form = document.getElementById('plan-form');
  const daysInput = document.getElementById('plan-days');
  const pageInput = document.getElementById('plan-current-page');
  const typeSelect = document.getElementById('plan-user-type');
  const dayChips = document.querySelectorAll('#days-chip-grid .day-chip');
  const calcPreview = document.getElementById('plan-calc-preview');

  function updateCalcPreview() {
    if (!calcPreview) return;
    const days = parseInt(daysInput.value, 10) || 6;
    const current = parseInt(pageInput.value, 10) || 0;
    const type = typeSelect.value;
    const extra = (sharedState.user && sharedState.user.rabt_extra_pages) ? sharedState.user.rabt_extra_pages : 0;
    const rabtWindow = 30 + extra;

    let pool = 0;
    if (type === 'COMPLETE') {
      pool = 604;
    } else {
      const rabtStart = Math.max(1, Math.min(current + 1, 604) - (rabtWindow - 1));
      if (rabtStart > 1) {
        pool = rabtStart - 1;
      }
    }

    if (pool <= 0) {
      calcPreview.innerHTML = `📊 <strong>المراجعة غير نشطة حالياً:</strong> ستنطلق المراجعة الدورية تلقائياً بعد تجاوز أول ٣٠ صفحة حفظ.`;
    } else {
      const dailyPages = Math.ceil(pool / days);
      const hizb = dailyPages / 10;
      const hizbText = Number.isInteger(hizb) ? hizb : hizb.toFixed(1);
      calcPreview.innerHTML = `📊 <strong>الحساب التلقائي:</strong> إجمالي صفحات المراجعة (${pool} صفحة) مقسومة على <strong>${days} أيام</strong> = <strong>${dailyPages} صفحة يومياً</strong> (~${hizbText} أحزاب) لختم المراجعة في اليوم الأخير تماماً.`;
    }
  }

  function openPlanModal() {
    if (sharedState.user) {
      const curDays = sharedState.user.murajaah_days || 6;
      daysInput.value = curDays;
      pageInput.value = sharedState.user.current_hifz_page ?? 0;
      typeSelect.value = sharedState.user.user_type || 'NEW';

      dayChips.forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.days, 10) === curDays);
      });
      updateCalcPreview();
    }
    modal.classList.remove('hidden');
    pageInput.focus();
  }

  function closePlanModal() {
    modal.classList.add('hidden');
  }

  openBtns.forEach((b) => {
    if (b) b.addEventListener('click', openPlanModal);
  });

  if (closeBtn) closeBtn.addEventListener('click', closePlanModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closePlanModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePlanModal();
  });

  dayChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      dayChips.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      daysInput.value = btn.dataset.days;
      updateCalcPreview();
    });
  });

  if (pageInput) pageInput.addEventListener('input', updateCalcPreview);
  if (typeSelect) typeSelect.addEventListener('change', updateCalcPreview);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('plan-modal-save');
      saveBtn.disabled = true;

      const body = {
        murajaah_days: parseInt(daysInput.value, 10) || 6,
        current_hifz_page: parseInt(pageInput.value, 10) || 0,
        user_type: typeSelect.value,
        recalculate_today: true,
      };

      try {
        const res = await API.call('tasks/update_plan.php', { method: 'POST', body, redirectOn401: true });
        if (res.user) {
          sharedState.user = { ...sharedState.user, ...res.user };
        }
        await loadSharedData();
        renderDashboardUI();
        closePlanModal();
        if (window.AudioEngine) AudioEngine.playSuccess();
        showToast('تم تحديث خطة المراجعة بنجاح 🎯');
      } catch (err) {
        showToast(err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

function renderDashboardUI() {
  const user = sharedState.user;
  if (!user) return;

  // Render Stats Banner
  const currentVal = document.getElementById('stat-current-hifz');
  if (currentVal) currentVal.textContent = user.current_hifz_page + ' صفحة';

  const targetVal = document.getElementById('stat-target');
  if (targetVal) {
    const hizb = user.daily_murajaah_target_pages / 10;
    const hizbText = Number.isInteger(hizb) ? hizb : hizb.toFixed(1);
    const days = user.murajaah_days || 6;
    targetVal.textContent = `ختم كل ${days} أيام (${user.daily_murajaah_target_pages} ص / اليوم ≈ ${hizbText} أحزاب)`;
  }

  const activeMistakesCount = sharedState.history.filter((m) => m.status === 'ACTIVE').length;
  const mistakesVal = document.getElementById('stat-active-mistakes');
  if (mistakesVal) mistakesVal.textContent = activeMistakesCount + ' خطأ نشط';

  const dateEl = document.getElementById('tasks-date');
  if (dateEl) dateEl.textContent = sharedState.date;

  // Render 4 Dynamic Task Cards
  const grid = document.getElementById('tasks-grid');
  if (!grid) return;

  const order = ['HIFZ_JADID', 'RABT', 'MURAJAAH', 'MISTAKES'];
  grid.innerHTML = order.map((type) => {
    const meta = TASK_DESTINATIONS[type];
    const task = sharedState.tasks.find((t) => t.task_type === type);
    const isDisabled = !task && type !== 'MISTAKES';

    let rangeHtml = '';
    let statusPill = '';
    let progressHtml = '';
    let carriedFlag = '';

    if (type === 'MISTAKES') {
      const count = activeMistakesCount;
      rangeHtml = count > 0 ? (count + ' خطأ بحاجة للإتقان') : 'لا توجد أخطاء نشطة ✓';
      statusPill = count > 0
        ? '<span class="task-status" style="color:var(--danger); background:var(--danger-soft)">متاح للتدريب</span>'
        : '<span class="task-status done">رائـع! مكتمل</span>';
      progressHtml = `
        <div class="progress-wrap">
          <div class="progress-header"><span>بطاقات التدريب</span><span>${count} نشطة</span></div>
          <div class="progress-bar"><div class="progress-fill fill-blue" style="width:${count > 0 ? 100 : 0}%"></div></div>
        </div>`;
    } else if (task) {
      if (task.start_page === task.end_page) {
        rangeHtml = 'صفحة ' + task.start_page;
      } else {
        rangeHtml = 'صفحات ' + task.start_page + ' – ' + task.end_page;
      }

      const total = task.total_pages || 1;
      const count = task.completed_count || (task.is_completed ? total : 0);
      const percent = task.progress_percent || (task.is_completed ? 100 : 0);

      statusPill = task.is_completed
        ? '<span class="task-status done">✓ مكتمل اليوم</span>'
        : `<span class="task-status">${count} / ${total} صفحة</span>`;

      if (task.carried_over) {
        carriedFlag = '<span class="task-flag">محولة من أمس</span>';
      }

      const fillClass = type === 'HIFZ_JADID' ? 'fill-green' : (type === 'RABT' ? 'fill-blue' : 'fill-purple');
      progressHtml = `
        <div class="progress-wrap">
          <div class="progress-header">
            <span>التقدم الفردي للعملية</span>
            <span><strong>${count}</strong> من ${total} صفحة (${percent}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${percent}%"></div></div>
        </div>`;
    } else {
      rangeHtml = 'غير مفعّل اليوم';
      statusPill = '<span class="task-status">غير مفعّل</span>';
    }

    return `
      <a href="${meta.url}" class="task-card ${meta.cls} ${task && task.is_completed ? 'is-completed' : ''} ${isDisabled ? 'is-disabled' : ''}">
        <div class="task-top">
          <div class="task-title-wrap">
            <span class="task-dot"></span>
            <h3>${meta.title}</h3>
          </div>
          ${carriedFlag}
        </div>
        <p class="task-sub">${meta.sub}</p>
        <div class="task-range">
          <span>${rangeHtml}</span>
          ${statusPill}
        </div>
        ${progressHtml}
        <span class="task-arrow">فتح صفحة التلاوة المستقلة ←</span>
      </a>
    `;
  }).join('');
}

/* ---------------- 7. Dedicated Task Recitation Controller ---------------- */

async function initDedicatedTaskPage(taskType) {
  try {
    await loadSharedData();
    renderTaskPage(taskType);
    initMistakeModal();
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message, true);
    }
  }
}

function renderTaskPage(taskType) {
  const task = sharedState.tasks.find((t) => t.task_type === taskType);
  const container = document.getElementById('task-content');
  if (!container) return;

  if (!task) {
    container.innerHTML = `
      <div class="task-page-head">
        <h2>هذه المهمة غير نشطة اليوم</h2>
        <p class="hint">حسب مسار خطتك الحالي، هذه المهمة لا تتطلب إنجازاً اليوم.</p>
        <a href="dashboard.html" class="btn btn-primary" style="align-self:flex-start">العودة للرئيسية</a>
      </div>`;
    return;
  }

  const start = task.start_page;
  const end = task.end_page;
  const completedList = task.completed_pages || [];
  const completedCount = completedList.length;
  const totalPages = Math.max(1, end - start + 1);
  const percent = Math.min(100, Math.round((completedCount / totalPages) * 100));

  // Determine active selected page
  let activePage = start;
  const storedSelection = parseInt(sessionStorage.getItem('selected_page_' + taskType), 10);
  if (storedSelection >= start && storedSelection <= end) {
    activePage = storedSelection;
  } else {
    // Select first uncompleted page if available
    for (let p = start; p <= end; p++) {
      if (!completedList.includes(p)) {
        activePage = p;
        break;
      }
    }
  }

  // Header and Progress Bar
  const isAllDone = task.is_completed || completedCount >= totalPages;
  const titleArabic = task.title_ar;
  const fillClass = taskType === 'HIFZ_JADID' ? 'fill-green' : (taskType === 'RABT' ? 'fill-blue' : 'fill-purple');

  const pageHtml = `
    <div class="task-page-head">
      <div class="task-page-title-row">
        <div>
          <h2>${titleArabic}</h2>
          <p class="hint">النطاق المطلوب: من صفحة <strong>${start}</strong> إلى <strong>${end}</strong></p>
        </div>
        <div class="task-page-badge ${isAllDone ? 'green' : 'blue'}">
          ${isAllDone ? '✓ أنجزت جميع صفحات اليوم' : `${completedCount} من ${totalPages} صفحة منجزة`}
        </div>
      </div>
      <div class="progress-wrap">
        <div class="progress-header">
          <span>تقدم التلاوة اليومي</span>
          <span>${percent}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${fillClass}" style="width: ${percent}%;"></div>
        </div>
      </div>
    </div>

    <!-- Active Page Recitation Stage -->
    <div class="recitation-stage" id="recitation-stage">
      <!-- Populated by renderActivePageStage -->
    </div>

    <!-- Interactive Page Chips -->
    <div class="chips-card">
      <div class="chips-title">
        <span>اختر صفحة للتلاوة أو تسجيل خطأ:</span>
        <small class="hint">كل صفحة تُتلى وتُحدد تُسجل كصفحة منجزة بشكل فردي</small>
      </div>
      <div class="page-chips" id="task-page-chips">
        <!-- Rendered chips -->
      </div>
    </div>
  `;

  container.innerHTML = pageHtml;
  renderChipsList(taskType, task, activePage);
  renderActivePageStage(taskType, task, activePage);
}

function renderChipsList(taskType, task, activePage) {
  const chipsWrap = document.getElementById('task-page-chips');
  if (!chipsWrap) return;

  const completedList = task.completed_pages || [];
  let html = '';

  for (let p = task.start_page; p <= task.end_page; p++) {
    const isDone = completedList.includes(p);
    const isActive = p === activePage;
    const mistakeCount = sharedState.badges[p] || 0;

    html += `
      <button type="button" class="page-chip ${isActive ? 'active' : ''} ${isDone ? 'is-done' : ''}" data-page="${p}">
        ${p}
        ${mistakeCount > 0 ? `<span class="mistake-badge">${mistakeCount}</span>` : ''}
      </button>
    `;
  }

  chipsWrap.innerHTML = html;

  chipsWrap.querySelectorAll('.page-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pageNum = parseInt(btn.dataset.page, 10);
      sessionStorage.setItem('selected_page_' + taskType, pageNum);
      renderTaskPage(taskType);
    });
  });
}

function renderActivePageStage(taskType, task, activePage) {
  const stage = document.getElementById('recitation-stage');
  if (!stage) return;

  const completedList = task.completed_pages || [];
  const isPageDone = completedList.includes(activePage);
  const mistakeCount = sharedState.badges[activePage] || 0;

  stage.innerHTML = `
    <div class="stage-top">
      <div class="stage-page-title">
        <span>📖 صفحة ${activePage}</span>
        ${isPageDone ? '<span class="task-status done">✓ تمت تلاوتها</span>' : '<span class="task-status">بانتظار التلاوة</span>'}
      </div>
      <div class="stage-meta">
        ${taskType === 'HIFZ_JADID' ? 'الحفظ الجديد (صفحة اليوم)' : 'صفحة داخل نطاق ' + task.title_ar}
      </div>
    </div>

    ${mistakeCount > 0 ? `
      <div class="stage-warning">
        <span>⚠ لديك <strong>${mistakeCount}</strong> أخطاء سابقة مسجلة على هذه الصفحة. ركز عليها أثناء التلاوة!</span>
      </div>
    ` : ''}

    <div class="stage-actions">
      <button type="button" id="btn-complete-page" class="btn ${isPageDone ? 'btn-ghost' : 'btn-success'}">
        ${isPageDone ? '✓ تم إتمام هذه الصفحة (إعادة التأكيد)' : '✓ تمت تلاوة الصفحة (إتمام)'}
      </button>

      <button type="button" id="btn-view-mushaf" class="btn-mushaf-view" title="عرض الصفحة من مصحف المدينة">
        📖 تصفح المصحف
      </button>

      <button type="button" id="btn-open-mistake" class="btn btn-danger">
        🔴 سجل خطأ
      </button>

      <div style="margin-right:auto; display:flex; gap:0.5rem">
        ${activePage > task.start_page ? `<button type="button" id="btn-prev-page" class="btn btn-ghost">السابقة (${activePage - 1})</button>` : ''}
        ${activePage < task.end_page ? `<button type="button" id="btn-next-page" class="btn btn-ghost">التالية (${activePage + 1})</button>` : ''}
      </div>
    </div>
    <div class="kbd-hint">
      <span>مفاتيح سريعة:</span> <kbd>→</kbd> <kbd>←</kbd> للتنقل بين الصفحات | <kbd>Enter</kbd> للإتمام | <kbd>M</kbd> لتسجيل خطأ
    </div>
  `;

  // Action listeners
  const completeBtn = document.getElementById('btn-complete-page');
  completeBtn.addEventListener('click', async () => {
    completeBtn.disabled = true;
    try {
      const res = await API.call('tasks/update_progress.php', {
        method: 'POST',
        body: { task_type: taskType, completed_page: activePage },
        redirectOn401: true,
      });

      if (res.task && res.task.is_completed) {
        AudioEngine.playCelebration();
        showToast(`🎉 مبارك! تم إنجاز جميع صفحات ${task.title_ar} لليوم!`);
      } else {
        AudioEngine.playSuccess();
        showToast(`تم تسجيل إتمام صفحة ${activePage} بنجاح ✓`);
      }

      await loadSharedData();
      renderTaskPage(taskType);
    } catch (err) {
      showToast(err.message, true);
      completeBtn.disabled = false;
    }
  });

  const mushafBtn = document.getElementById('btn-view-mushaf');
  if (mushafBtn) {
    mushafBtn.addEventListener('click', () => {
      openMushafModal(activePage);
    });
  }

  const mistakeBtn = document.getElementById('btn-open-mistake');
  mistakeBtn.addEventListener('click', () => {
    openMistakeModal(activePage);
  });

  const prevBtn = document.getElementById('btn-prev-page');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      sessionStorage.setItem('selected_page_' + taskType, activePage - 1);
      renderTaskPage(taskType);
    });
  }

  const nextBtn = document.getElementById('btn-next-page');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      sessionStorage.setItem('selected_page_' + taskType, activePage + 1);
      renderTaskPage(taskType);
    });
  }
}

/* ---------------- 8. Mistake Logging Modal (Shared) ---------------- */

let modalActivePage = 1;
let modalSelectedTag = 'TRANSITION_FAILURE';

const SURAHS_LIST = [
  { id: 1, name: "الفاتحة", ayahs: 7 },
  { id: 2, name: "البقرة", ayahs: 286 },
  { id: 3, name: "آل عمران", ayahs: 200 },
  { id: 4, name: "النساء", ayahs: 176 },
  { id: 5, name: "المائدة", ayahs: 120 },
  { id: 6, name: "الأنعام", ayahs: 165 },
  { id: 7, name: "الأعراف", ayahs: 206 },
  { id: 8, name: "الأنفال", ayahs: 75 },
  { id: 9, name: "التوبة", ayahs: 129 },
  { id: 10, name: "يونس", ayahs: 109 },
  { id: 11, name: "هود", ayahs: 123 },
  { id: 12, name: "يوسف", ayahs: 111 },
  { id: 13, name: "الرعد", ayahs: 43 },
  { id: 14, name: "إبراهيم", ayahs: 52 },
  { id: 15, name: "الحجر", ayahs: 99 },
  { id: 16, name: "النحل", ayahs: 128 },
  { id: 17, name: "الإسراء", ayahs: 111 },
  { id: 18, name: "الكهف", ayahs: 110 },
  { id: 19, name: "مريم", ayahs: 98 },
  { id: 20, name: "طه", ayahs: 135 },
  { id: 21, name: "الأنبياء", ayahs: 112 },
  { id: 22, name: "الحج", ayahs: 78 },
  { id: 23, name: "المؤمنون", ayahs: 118 },
  { id: 24, name: "النور", ayahs: 64 },
  { id: 25, name: "الفرقان", ayahs: 77 },
  { id: 26, name: "الشعراء", ayahs: 227 },
  { id: 27, name: "النمل", ayahs: 93 },
  { id: 28, name: "القصص", ayahs: 88 },
  { id: 29, name: "العنكبوت", ayahs: 69 },
  { id: 30, name: "الروم", ayahs: 60 },
  { id: 31, name: "لقمان", ayahs: 34 },
  { id: 32, name: "السجدة", ayahs: 30 },
  { id: 33, name: "الأحزاب", ayahs: 73 },
  { id: 34, name: "سبأ", ayahs: 54 },
  { id: 35, name: "فاطر", ayahs: 45 },
  { id: 36, name: "يس", ayahs: 83 },
  { id: 37, name: "الصافات", ayahs: 182 },
  { id: 38, name: "ص", ayahs: 88 },
  { id: 39, name: "الزمر", ayahs: 75 },
  { id: 40, name: "غافر", ayahs: 85 },
  { id: 41, name: "فصلت", ayahs: 54 },
  { id: 42, name: "الشورى", ayahs: 53 },
  { id: 43, name: "الزخرف", ayahs: 89 },
  { id: 44, name: "الدخان", ayahs: 59 },
  { id: 45, name: "الجاثية", ayahs: 37 },
  { id: 46, name: "الأحقاف", ayahs: 35 },
  { id: 47, name: "محمد", ayahs: 38 },
  { id: 48, name: "الفتح", ayahs: 29 },
  { id: 49, name: "الحجرات", ayahs: 18 },
  { id: 50, name: "ق", ayahs: 45 },
  { id: 51, name: "الذاريات", ayahs: 60 },
  { id: 52, name: "الطور", ayahs: 49 },
  { id: 53, name: "النجم", ayahs: 62 },
  { id: 54, name: "القمر", ayahs: 55 },
  { id: 55, name: "الرحمن", ayahs: 78 },
  { id: 56, name: "الواقعة", ayahs: 96 },
  { id: 57, name: "الحديد", ayahs: 29 },
  { id: 58, name: "المجادلة", ayahs: 22 },
  { id: 59, name: "الحشر", ayahs: 24 },
  { id: 60, name: "الممتحنة", ayahs: 13 },
  { id: 61, name: "الصف", ayahs: 14 },
  { id: 62, name: "الجمعة", ayahs: 11 },
  { id: 63, name: "المنافقون", ayahs: 11 },
  { id: 64, name: "التغابن", ayahs: 18 },
  { id: 65, name: "الطلاق", ayahs: 12 },
  { id: 66, name: "التحريم", ayahs: 12 },
  { id: 67, name: "الملك", ayahs: 30 },
  { id: 68, name: "القلم", ayahs: 52 },
  { id: 69, name: "الحاقة", ayahs: 52 },
  { id: 70, name: "المعارج", ayahs: 44 },
  { id: 71, name: "نوح", ayahs: 28 },
  { id: 72, name: "الجن", ayahs: 28 },
  { id: 73, name: "المزمل", ayahs: 20 },
  { id: 74, name: "المدثر", ayahs: 56 },
  { id: 75, name: "القيامة", ayahs: 40 },
  { id: 76, name: "الإنسان", ayahs: 31 },
  { id: 77, name: "المرسلات", ayahs: 50 },
  { id: 78, name: "النبأ", ayahs: 40 },
  { id: 79, name: "النازعات", ayahs: 46 },
  { id: 80, name: "عبس", ayahs: 42 },
  { id: 81, name: "التكوير", ayahs: 29 },
  { id: 82, name: "الانفطار", ayahs: 19 },
  { id: 83, name: "المطففين", ayahs: 36 },
  { id: 84, name: "الانشقاق", ayahs: 25 },
  { id: 85, name: "البروج", ayahs: 22 },
  { id: 86, name: "الطارق", ayahs: 17 },
  { id: 87, name: "الأعلى", ayahs: 19 },
  { id: 88, name: "الغاشية", ayahs: 26 },
  { id: 89, name: "الفجر", ayahs: 30 },
  { id: 90, name: "البلد", ayahs: 20 },
  { id: 91, name: "الشمس", ayahs: 15 },
  { id: 92, name: "الليل", ayahs: 21 },
  { id: 93, name: "الضحى", ayahs: 11 },
  { id: 94, name: "الشرح", ayahs: 8 },
  { id: 95, name: "التين", ayahs: 8 },
  { id: 96, name: "العلق", ayahs: 19 },
  { id: 97, name: "القدر", ayahs: 5 },
  { id: 98, name: "البينة", ayahs: 8 },
  { id: 99, name: "الزلزلة", ayahs: 8 },
  { id: 100, name: "العاديات", ayahs: 11 },
  { id: 101, name: "القارعة", ayahs: 11 },
  { id: 102, name: "التكاثر", ayahs: 8 },
  { id: 103, name: "العصر", ayahs: 3 },
  { id: 104, name: "الهمزة", ayahs: 9 },
  { id: 105, name: "الفيل", ayahs: 5 },
  { id: 106, name: "قريش", ayahs: 4 },
  { id: 107, name: "الماعون", ayahs: 7 },
  { id: 108, name: "الكوثر", ayahs: 3 },
  { id: 109, name: "الكافرون", ayahs: 6 },
  { id: 110, name: "النصر", ayahs: 3 },
  { id: 111, name: "المسد", ayahs: 5 },
  { id: 112, name: "الإخلاص", ayahs: 4 },
  { id: 113, name: "الفلق", ayahs: 5 },
  { id: 114, name: "الناس", ayahs: 6 },
];

function initMistakeModal() {
  const modal = document.getElementById('mistake-modal');
  if (!modal) return;

  const surahSelect = document.getElementById('mistake-surah');
  const ayahSelect = document.getElementById('mistake-ayah');

  if (surahSelect && surahSelect.options.length <= 1) {
    SURAHS_LIST.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.id}. سورة ${s.name}`;
      surahSelect.appendChild(opt);
    });
  }

  if (surahSelect) {
    surahSelect.addEventListener('change', () => {
      const sId = parseInt(surahSelect.value, 10);
      const sData = SURAHS_LIST.find((s) => s.id === sId);
      ayahSelect.innerHTML = '<option value="">— اختر الآية —</option>';
      if (sData) {
        for (let i = 1; i <= sData.ayahs; i++) {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = 'الآية ' + i;
          ayahSelect.appendChild(opt);
        }
      }
    });
  }

  document.querySelectorAll('#mistake-tags .tag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mistake-tags .tag-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      modalSelectedTag = btn.dataset.type;
    });
  });

  const cancelBtn = document.getElementById('modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeMistakeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMistakeModal();
  });

  const saveBtn = document.getElementById('modal-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const surahVal = parseInt(surahSelect.value, 10);
      const ayahVal = parseInt(ayahSelect.value, 10);
      const notesVal = document.getElementById('mistake-note').value.trim();

      if (!surahVal || !ayahVal) {
        showToast('يرجى اختيار السورة ورقم الآية أولاً', true);
        return;
      }

      saveBtn.disabled = true;
      try {
        await API.call('mistakes/record_mistake.php', {
          method: 'POST',
          body: {
            page_number: modalActivePage,
            surah_number: surahVal,
            ayah_number: ayahVal,
            mistake_type: modalSelectedTag,
            notes: notesVal || null,
          },
          redirectOn401: true,
        });

        showToast('تم تسجيل الخطأ بنجاح 🔴 وسيظهر في بطاقات المعالجة');
        closeMistakeModal();

        // Refresh shared data and re-render current view
        await loadSharedData();
        const activeType = document.body.dataset.taskType;
        if (activeType) {
          renderTaskPage(activeType);
        } else if (document.getElementById('tasks-grid')) {
          renderDashboardUI();
        }
      } catch (err) {
        showToast(err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

/* Standard Madinah Mushaf Surah start pages mapping (1-114) */
const SURAH_START_PAGES = [
  { id: 1, page: 1 }, { id: 2, page: 2 }, { id: 3, page: 50 }, { id: 4, page: 77 }, { id: 5, page: 106 },
  { id: 6, page: 128 }, { id: 7, page: 151 }, { id: 8, page: 177 }, { id: 9, page: 187 }, { id: 10, page: 208 },
  { id: 11, page: 221 }, { id: 12, page: 235 }, { id: 13, page: 249 }, { id: 14, page: 255 }, { id: 15, page: 262 },
  { id: 16, page: 267 }, { id: 17, page: 282 }, { id: 18, page: 293 }, { id: 19, page: 305 }, { id: 20, page: 312 },
  { id: 21, page: 322 }, { id: 22, page: 332 }, { id: 23, page: 342 }, { id: 24, page: 350 }, { id: 25, page: 359 },
  { id: 26, page: 367 }, { id: 27, page: 377 }, { id: 28, page: 385 }, { id: 29, page: 396 }, { id: 30, page: 404 },
  { id: 31, page: 411 }, { id: 32, page: 415 }, { id: 33, page: 418 }, { id: 34, page: 428 }, { id: 35, page: 434 },
  { id: 36, page: 440 }, { id: 37, page: 446 }, { id: 38, page: 453 }, { id: 39, page: 458 }, { id: 40, page: 467 },
  { id: 41, page: 477 }, { id: 42, page: 483 }, { id: 43, page: 489 }, { id: 44, page: 496 }, { id: 45, page: 499 },
  { id: 46, page: 502 }, { id: 47, page: 507 }, { id: 48, page: 511 }, { id: 49, page: 515 }, { id: 50, page: 518 },
  { id: 51, page: 520 }, { id: 52, page: 523 }, { id: 53, page: 526 }, { id: 54, page: 528 }, { id: 55, page: 531 },
  { id: 56, page: 534 }, { id: 57, page: 537 }, { id: 58, page: 542 }, { id: 59, page: 545 }, { id: 60, page: 549 },
  { id: 61, page: 551 }, { id: 62, page: 553 }, { id: 63, page: 554 }, { id: 64, page: 556 }, { id: 65, page: 558 },
  { id: 66, page: 560 }, { id: 67, page: 562 }, { id: 68, page: 564 }, { id: 69, page: 566 }, { id: 70, page: 568 },
  { id: 71, page: 570 }, { id: 72, page: 572 }, { id: 73, page: 574 }, { id: 74, page: 575 }, { id: 75, page: 577 },
  { id: 76, page: 578 }, { id: 77, page: 580 }, { id: 78, page: 582 }, { id: 79, page: 583 }, { id: 80, page: 585 },
  { id: 81, page: 586 }, { id: 82, page: 587 }, { id: 83, page: 587 }, { id: 84, page: 589 }, { id: 85, page: 590 },
  { id: 86, page: 591 }, { id: 87, page: 591 }, { id: 88, page: 592 }, { id: 89, page: 593 }, { id: 90, page: 594 },
  { id: 91, page: 595 }, { id: 92, page: 595 }, { id: 93, page: 596 }, { id: 94, page: 596 }, { id: 95, page: 597 },
  { id: 96, page: 597 }, { id: 97, page: 598 }, { id: 98, page: 598 }, { id: 99, page: 599 }, { id: 100, page: 599 },
  { id: 101, page: 600 }, { id: 102, page: 600 }, { id: 103, page: 601 }, { id: 104, page: 601 }, { id: 105, page: 601 },
  { id: 106, page: 602 }, { id: 107, page: 602 }, { id: 108, page: 602 }, { id: 109, page: 603 }, { id: 110, page: 603 },
  { id: 111, page: 603 }, { id: 112, page: 604 }, { id: 113, page: 604 }, { id: 114, page: 604 }
];

function getSurahForPage(page) {
  let matched = 1;
  for (let i = 0; i < SURAH_START_PAGES.length; i++) {
    if (SURAH_START_PAGES[i].page <= page) {
      matched = SURAH_START_PAGES[i].id;
    } else {
      break;
    }
  }
  return matched;
}

function openMistakeModal(pageNumber) {
  modalActivePage = pageNumber;
  const modal = document.getElementById('mistake-modal');
  if (!modal) return;

  const pageBadge = document.getElementById('modal-page');
  if (pageBadge) pageBadge.textContent = 'صفحة ' + pageNumber;

  document.getElementById('mistake-note').value = '';

  // Auto-detect and select Surah for this page
  const surahSelect = document.getElementById('mistake-surah');
  if (surahSelect) {
    const detectedSurah = getSurahForPage(pageNumber);
    surahSelect.value = detectedSurah;
    surahSelect.dispatchEvent(new Event('change'));
  }

  // Reset tag selection to first tag
  const firstTag = document.querySelector('#mistake-tags .tag-btn');
  if (firstTag) {
    document.querySelectorAll('#mistake-tags .tag-btn').forEach((b) => b.classList.remove('active'));
    firstTag.classList.add('active');
    modalSelectedTag = firstTag.dataset.type;
  }

  modal.classList.remove('hidden');
}

function closeMistakeModal() {
  const modal = document.getElementById('mistake-modal');
  if (modal) modal.classList.add('hidden');
}

/* ---------------- 8b. Mushaf Page Viewer Modal ---------------- */

function openMushafModal(pageNumber) {
  let modal = document.getElementById('mushaf-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mushaf-modal';
    modal.className = 'mushaf-modal';
    document.body.appendChild(modal);
  }

  const imgUrl = `https://images.quran.com/page/${pageNumber}.png`;
  const quranComUrl = `https://quran.com/page/${pageNumber}`;

  modal.innerHTML = `
    <div class="mushaf-modal-content" role="dialog" aria-modal="true">
      <div class="mushaf-modal-head">
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <h3 style="font-size:1.1rem;">📖 مصحف المدينة — صفحة ${pageNumber}</h3>
          <a href="${quranComUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="padding:0.25rem 0.6rem; font-size:0.75rem;">
            فتح على Quran.com ↗
          </a>
        </div>
        <button type="button" id="btn-close-mushaf" class="btn btn-ghost" style="padding:0.35rem 0.65rem; font-size:1.1rem;" aria-label="إغلاق">✕</button>
      </div>
      <div class="mushaf-img-frame">
        <img src="${imgUrl}" alt="صفحة ${pageNumber} من مصحف المدينة" class="mushaf-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'mushaf-fallback-box\\'><h3>تعذر تحميل صورة الصفحة في وضع عدم الاتصال</h3><p class=\\'hint\\'>يمكنك تلاوة الصفحة مباشرة من مصحفك أو النقر أدناه لفتحها على الويب:</p><a href=\\'${quranComUrl}\\' target=\\'_blank\\' class=\\'btn btn-primary\\'>فتح الصفحة على Quran.com</a></div>';">
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('btn-close-mushaf').addEventListener('click', closeMushafModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMushafModal();
  });
}

function closeMushafModal() {
  const modal = document.getElementById('mushaf-modal');
  if (modal) modal.classList.add('hidden');
}

/* ---------------- 8c. Keyboard Navigation Engine ---------------- */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    const mistakeModal = document.getElementById('mistake-modal');
    const mushafModal = document.getElementById('mushaf-modal');

    if (e.key === 'Escape') {
      if (mistakeModal && !mistakeModal.classList.contains('hidden')) closeMistakeModal();
      if (mushafModal && !mushafModal.classList.contains('hidden')) closeMushafModal();
      return;
    }

    if ((mistakeModal && !mistakeModal.classList.contains('hidden')) || (mushafModal && !mushafModal.classList.contains('hidden'))) {
      return;
    }

    if (e.key === 'ArrowLeft') {
      const nextBtn = document.getElementById('btn-next-page');
      if (nextBtn) nextBtn.click();
    } else if (e.key === 'ArrowRight') {
      const prevBtn = document.getElementById('btn-prev-page');
      if (prevBtn) prevBtn.click();
    } else if (e.key === 'Enter') {
      const compBtn = document.getElementById('btn-complete-page');
      if (compBtn && !compBtn.disabled) compBtn.click();
    } else if (e.key === 'm' || e.key === 'M' || e.key === 'ة') {
      const mistBtn = document.getElementById('btn-open-mistake');
      if (mistBtn) mistBtn.click();
    }
  });
}

/* ---------------- 9. DOM Ready Initialization ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  initThemeEngine();
  initWakeLockEngine();
  AudioEngine.init();
  initKeyboardShortcuts();

  // Route by current page element
  if (document.getElementById('register-form')) {
    initAuthPage();
  } else if (document.getElementById('tasks-grid')) {
    initDashboard();
  } else if (document.body.dataset.taskType) {
    initDedicatedTaskPage(document.body.dataset.taskType);
  }
});
