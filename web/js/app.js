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
window.showToast = showToast;

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
    btn.title = active === 'dark'
      ? (window.I18N ? I18N.t('theme_toggle_title_dark') : 'الوضع الحالي: داكن (انقر للتحويل إلى الفاتح)')
      : (window.I18N ? I18N.t('theme_toggle_title_light') : 'الوضع الحالي: فاتح (انقر للتحويل إلى الداكن)');
    btn.setAttribute('aria-label', btn.title);
  });
}

function cycleTheme() {
  const currentActive = document.documentElement.getAttribute('data-theme');
  if (currentActive === 'dark') {
    applyTheme('light');
    showToast(window.I18N ? I18N.t('toast_theme_light') : 'تم التحويل إلى الوضع الفاتح ☀️');
  } else {
    applyTheme('dark');
    showToast(window.I18N ? I18N.t('toast_theme_dark') : 'تم التحويل إلى الوضع الداكن 🌙');
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
      ? (window.I18N ? I18N.t('wakelock_title_on') : 'إبقاء الشاشة مضاءة: مفعّل (لن تنطفئ الشاشة أثناء التلاوة)')
      : (window.I18N ? I18N.t('wakelock_title_off') : 'إبقاء الشاشة مضاءة: متوقف (ستنطفئ الشاشة بشكل طبيعي)');
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
    showToast(window.I18N ? I18N.t('toast_wake_on') : 'تم تفعيل إبقاء الشاشة مضاءة 💡');
  } else {
    releaseWakeLock();
    showToast(window.I18N ? I18N.t('toast_wake_off') : 'تم إيقاف إبقاء الشاشة مضاءة');
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
      btn.title = this.enabled
        ? (window.I18N ? I18N.t('sound_toggle_title_on') : 'المؤثرات الصوتية: مفعّلة (انقر للكتم)')
        : (window.I18N ? I18N.t('sound_toggle_title_off') : 'المؤثرات الصوتية: مكتومة (انقر للتفعيل)');
      btn.setAttribute('aria-label', btn.title);
    });
  },
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('hifz-sound', this.enabled ? '1' : '0'); } catch (e) {}
    this.updateUI();
    showToast(this.enabled ? (window.I18N ? I18N.t('toast_sound_on') : 'تم تفعيل المؤثرات الصوتية 🔊') : (window.I18N ? I18N.t('toast_sound_off') : 'تم كتم المؤثرات الصوتية 🔇'));
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
  },
  playUndo() {
    if (!this.enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(440.00, ctx.currentTime + 0.18); // A4
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }
};

/* ---------------- 3c. PWA Installation Engine ---------------- */

let deferredInstallPrompt = null;

function isAppStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

// True if the user installed the app on a previous visit (persisted flag).
// This is what keeps the install button from coming back in a browser tab
// after the app has been installed.
function wasInstalledPreviously() {
  try { return localStorage.getItem('pwa_installed') === 'true'; } catch (e) { return false; }
}

function markAppInstalled() {
  try { localStorage.setItem('pwa_installed', 'true'); } catch (e) {}
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

// The install flow only makes sense on phones/tablets. On a desktop browser the
// install button / banner is just noise, so we keep it hidden there entirely.
function isMobileDevice() {
  if (isIOS() || isAndroid()) return true;
  // iPadOS 13+ reports itself as "Macintosh" but is touch-capable.
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  return false;
}

// Register sw.js with a single retry. InfinityFree's "Browser Security System"
// serves sw.js as an HTML challenge (wrong MIME type) until its __test cookie
// is set, so the very first registration attempt can transiently fail.
function registerServiceWorker(attempt = 0) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    console.warn('[PWA] Insecure origin (http://): Service Worker requires HTTPS to enable automatic installation.');
    return;
  }
  navigator.serviceWorker.register('sw.js')
    .then((reg) => {
      console.log('[PWA] Service Worker registered with scope:', reg.scope);
    })
    .catch((err) => {
      if (attempt < 1) {
        console.warn('[PWA] Service Worker registration failed, retrying:', err);
        setTimeout(() => registerServiceWorker(attempt + 1), 1500);
      } else {
        console.warn('[PWA] Service Worker registration failed:', err);
      }
    });
}

async function initPWAEngine() {
  // 1. Register Service Worker if in secure context (https:// or localhost)
  registerServiceWorker();

  const headerInstallBtn = document.getElementById('btn-install-app');
  const banner = document.getElementById('pwa-install-banner');
  const bannerInstallBtn = document.getElementById('btn-banner-install');
  const bannerDismissBtn = document.getElementById('btn-banner-dismiss');

  const hideInstallUI = () => {
    if (headerInstallBtn) headerInstallBtn.classList.add('hidden');
    if (banner) banner.classList.add('hidden');
  };

  // Single source of truth for whether we may offer installation at all.
  // Once the app has been installed it must NEVER be offered again — on any
  // device — so this checks the persisted flag, standalone mode and device type.
  const shouldOfferInstall = () => {
    if (isAppStandalone()) {
      markAppInstalled();
      return false;
    }
    if (wasInstalledPreviously()) return false;
    if (!isMobileDevice()) return false;
    return true;
  };

  const showInstallUI = () => {
    // Hard gate: never reveal the button/banner once installed (or on desktop).
    if (!shouldOfferInstall()) {
      hideInstallUI();
      return;
    }
    if (headerInstallBtn) headerInstallBtn.classList.remove('hidden');
    if (banner) {
      let dismissed = false;
      try {
        const t = localStorage.getItem('pwa_banner_dismissed');
        if (t && Date.now() - parseInt(t, 10) < 7 * 86400000) dismissed = true;
      } catch (e) {}
      if (!dismissed) banner.classList.remove('hidden');
    }
  };

  // Wire up click handlers immediately
  const triggerInstall = (e) => {
    if (e) {
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
    }
    showInstallGuideModal();
  };

  if (headerInstallBtn) {
    headerInstallBtn.addEventListener('click', triggerInstall);
  }
  if (bannerInstallBtn) {
    bannerInstallBtn.addEventListener('click', triggerInstall);
  }
  if (bannerDismissBtn && banner) {
    bannerDismissBtn.addEventListener('click', () => {
      banner.classList.add('hidden');
      try { localStorage.setItem('pwa_banner_dismissed', String(Date.now())); } catch (e) {}
    });
  }

  // These listeners are attached on EVERY device / page (before any early
  // return) so a completed installation is always remembered and the install
  // button can never reappear afterwards.
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    markAppInstalled();
    hideInstallUI();
    const modal = document.getElementById('install-guide-modal');
    if (modal) modal.classList.add('hidden');
    showToast(window.I18N ? I18N.t('app_installed_toast') : '🎉 تم تثبيت التطبيق بنجاح!');
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallUI(); // gated by shouldOfferInstall()
  });

  // Persist the "installed" state if we ever find ourselves running as the
  // installed (standalone) app, in case the install event was missed.
  if (window.matchMedia) {
    const onStandaloneChange = () => {
      if (isAppStandalone()) {
        markAppInstalled();
        hideInstallUI();
      }
    };
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener('change', onStandaloneChange);
    } catch (e) {
      try { window.matchMedia('(display-mode: standalone)').addListener(onStandaloneChange); } catch (e2) {}
    }
  }

  // 2. Already installed (or running standalone, or on desktop)? Never show UI.
  if (!shouldOfferInstall()) {
    hideInstallUI();
    return;
  }

  // 3. Chromium installed-apps check
  if (typeof navigator.getInstalledRelatedApps === 'function') {
    try {
      const relatedApps = await navigator.getInstalledRelatedApps();
      if (relatedApps && relatedApps.length > 0) {
        markAppInstalled();
        hideInstallUI();
        return;
      }
    } catch (e) {}
  }

  // 4. Normal browser tab on a phone/tablet: offer installation.
  showInstallUI();
}

function showInstallGuideModal() {
  let modal = document.getElementById('install-guide-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'install-guide-modal';
    modal.className = 'modal-overlay hidden';
    
    const userIsIOS = isIOS();
    const userIsAndroid = isAndroid();
    const userIsDesktop = !userIsIOS && !userIsAndroid;
    const insecureOrigin = !window.isSecureContext;

    modal.innerHTML = `
      <div class="modal ios-install-box" style="max-width:490px;" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3 data-i18n="install_modal_title">تثبيت رفيق الحفظ على جهازك</h3>
          <button type="button" class="btn btn-ghost btn-close-guide" style="padding:0.25rem 0.6rem;">✕</button>
        </div>
        <div class="modal-body" style="padding:0.8rem 0;">
          ${insecureOrigin ? `
          <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:8px; padding:0.7rem 0.9rem; margin-bottom:1rem; font-size:0.85rem; color:#92400e; line-height:1.6;">
            <strong data-i18n="install_insecure_title">⚠️ اتصال غير آمن (http://)</strong><br>
            <span data-i18n="install_insecure_desc">لتثبيت التطبيق كأيقونة مستقلة بملء الشاشة، افتح الموقع عبر الرابط الآمن (https://) ثم أعد المحاولة.</span>
          </div>` : ''}
          <div style="display:flex; gap:0.4rem; margin-bottom:1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem; flex-wrap:wrap;">
            <button type="button" id="tab-guide-android" class="btn btn-ghost ${userIsAndroid ? 'btn-primary' : ''}" style="flex:1 1 auto; font-size:0.82rem; padding:0.4rem 0.6rem;" data-i18n="android_install_tab">
              🤖 أندرويد (Chrome)
            </button>
            <button type="button" id="tab-guide-ios" class="btn btn-ghost ${userIsIOS ? 'btn-primary' : ''}" style="flex:1 1 auto; font-size:0.82rem; padding:0.4rem 0.6rem;" data-i18n="ios_install_tab">
              🍎 آيفون (Safari)
            </button>
            <button type="button" id="tab-guide-desktop" class="btn btn-ghost ${userIsDesktop ? 'btn-primary' : ''}" style="flex:1 1 auto; font-size:0.82rem; padding:0.4rem 0.6rem;" data-i18n="desktop_install_tab">
              💻 كمبيوتر (Chrome / Edge)
            </button>
          </div>

          <!-- Android Steps -->
          <div id="guide-steps-android" class="${userIsAndroid ? '' : 'hidden'}">
            <div id="quick-install-container-android" class="${deferredInstallPrompt ? '' : 'hidden'}" style="margin-bottom:1.2rem; text-align:center;">
              <button type="button" id="btn-quick-install-prompt-android" class="btn btn-primary" style="width:100%; justify-content:center; padding:0.75rem; font-weight:700; font-size:0.95rem;">
                <span data-i18n="install_quick_btn">⚡ محاولة التثبيت التلقائي الفوري</span>
              </button>
              <p style="font-size:0.8rem; color:var(--text-muted, #64748b); margin-top:0.4rem; margin-bottom:0;" data-i18n="install_quick_hint">
                إذا ظهر تنبيه المتصفح «تعذر تثبيت التطبيق»، اتبع الخطوات السريعة أدناه:
              </p>
            </div>

            <ul class="ios-guide-list">
              <li class="ios-guide-step">
                <span class="ios-step-num">1</span>
                <span class="ios-step-text" data-i18n="android_install_step1">اضغط على زر القائمة (الثلاث نقاط ⋮) في أعلى المتصفح.</span>
              </li>
              <li class="ios-guide-step">
                <span class="ios-step-num">2</span>
                <span class="ios-step-text" data-i18n="android_install_step2">اختر «الإضافة إلى الشاشة الرئيسية» (Add to Home screen) أو «تثبيت التطبيق».</span>
              </li>
              <li class="ios-guide-step">
                <span class="ios-step-num">3</span>
                <span class="ios-step-text" data-i18n="android_install_step3">اضغط «إضافة» وسيتم تثبيت التطبيق فوراً ليعمل كأي تطبيق أصيل بملء الشاشة!</span>
              </li>
            </ul>
          </div>

          <!-- iOS Steps -->
          <ul id="guide-steps-ios" class="ios-guide-list ${userIsIOS ? '' : 'hidden'}">
            <li class="ios-guide-step">
              <span class="ios-step-num">1</span>
              <span class="ios-step-text" data-i18n="ios_install_step1">اضغط على زر المشاركة (Share ⎋) في شريط متصفح Safari.</span>
            </li>
            <li class="ios-guide-step">
              <span class="ios-step-num">2</span>
              <span class="ios-step-text" data-i18n="ios_install_step2">مرر للأسفل واختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen ⊞).</span>
            </li>
            <li class="ios-guide-step">
              <span class="ios-step-num">3</span>
              <span class="ios-step-text" data-i18n="ios_install_step3">اضغط «إضافة» (Add) في الزاوية وسيظهر التطبيق كأيقونة على شاشتك.</span>
            </li>
          </ul>

          <!-- Desktop Steps -->
          <div id="guide-steps-desktop" class="${userIsDesktop ? '' : 'hidden'}">
            <div id="quick-install-container-desktop" class="${deferredInstallPrompt ? '' : 'hidden'}" style="margin-bottom:1.2rem; text-align:center;">
              <button type="button" id="btn-quick-install-prompt-desktop" class="btn btn-primary" style="width:100%; justify-content:center; padding:0.75rem; font-weight:700; font-size:0.95rem;">
                <span data-i18n="install_quick_btn">⚡ محاولة التثبيت التلقائي الفوري</span>
              </button>
            </div>
            <ul class="ios-guide-list">
              <li class="ios-guide-step">
                <span class="ios-step-num">1</span>
                <span class="ios-step-text" data-i18n="desktop_install_step1">انقر على أيقونة التثبيت (⊕) في شريط العنوان أعلى المتصفح.</span>
              </li>
              <li class="ios-guide-step">
                <span class="ios-step-num">2</span>
                <span class="ios-step-text" data-i18n="desktop_install_step2">أو اضغط على قائمة المتصفح (الثلاث نقاط ⋮) واختر «تثبيت رفيق الحفظ» (Install).</span>
              </li>
              <li class="ios-guide-step">
                <span class="ios-step-num">3</span>
                <span class="ios-step-text" data-i18n="desktop_install_step3">اضغط «تثبيت» وسيفتح التطبيق فوراً في نافذة مستقلة وسريعة كأي برنامج أصيل!</span>
              </li>
            </ul>
          </div>

          <!-- Note box -->
          <div style="background:var(--bg-card, #f8f9fa); border:1px solid var(--border-color, #e2e8f0); border-radius:8px; padding:0.75rem 1rem; margin-top:1rem; font-size:0.85rem; color:var(--text-muted, #64748b); line-height:1.5;">
            <span data-i18n="install_modal_note">💡 ملاحظة: خيار «الإضافة إلى الشاشة الرئيسية» من قائمة المتصفح يثبّت التطبيق فوراً على هاتفك ليعمل كتطبيق أصيل مستقل مع أيقونة المصحف وبملء الشاشة!</span>
          </div>
        </div>
        <div class="modal-foot" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" id="btn-guide-already-installed" class="btn btn-ghost" style="font-size:0.82rem;" data-i18n="install_already_done_btn">✓ قمت بتثبيته بالفعل (إخفاء الزر)</button>
          <button type="button" class="btn btn-primary btn-close-guide" data-i18n="ios_install_modal_close">فهمت ذلك</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnAndroid = modal.querySelector('#tab-guide-android');
    const btnIos = modal.querySelector('#tab-guide-ios');
    const btnDesktop = modal.querySelector('#tab-guide-desktop');
    const stepsAndroid = modal.querySelector('#guide-steps-android');
    const stepsIos = modal.querySelector('#guide-steps-ios');
    const stepsDesktop = modal.querySelector('#guide-steps-desktop');

    const handlePrompt = async () => {
      if (!deferredInstallPrompt) return;
      try {
        const promptEvent = deferredInstallPrompt;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          console.log('[PWA] User accepted prompt');
          modal.classList.add('hidden');
          markAppInstalled();
          const headerBtn = document.getElementById('btn-install-app');
          if (headerBtn) headerBtn.classList.add('hidden');
          const pwaBanner = document.getElementById('pwa-install-banner');
          if (pwaBanner) pwaBanner.classList.add('hidden');
          showToast(window.I18N ? I18N.t('app_installed_toast') : '🎉 تم تثبيت التطبيق بنجاح!');
        }
      } catch (err) {
        console.warn('[PWA] Prompt error:', err);
      }
    };

    const btnAlreadyInstalled = modal.querySelector('#btn-guide-already-installed');
    if (btnAlreadyInstalled) {
      btnAlreadyInstalled.addEventListener('click', () => {
        markAppInstalled();
        const headerBtn = document.getElementById('btn-install-app');
        if (headerBtn) headerBtn.classList.add('hidden');
        const pwaBanner = document.getElementById('pwa-install-banner');
        if (pwaBanner) pwaBanner.classList.add('hidden');
        modal.classList.add('hidden');
        showToast(window.I18N ? I18N.t('app_installed_toast') : '🎉 تم تثبيت التطبيق بنجاح على جهازك!');
      });
    }

    const btnQuickAndroid = modal.querySelector('#btn-quick-install-prompt-android');
    if (btnQuickAndroid) btnQuickAndroid.addEventListener('click', handlePrompt);

    const btnQuickDesktop = modal.querySelector('#btn-quick-install-prompt-desktop');
    if (btnQuickDesktop) btnQuickDesktop.addEventListener('click', handlePrompt);

    // iOS Safari never fires `appinstalled`. If the user leaves the page while
    // the install guide is open (to use "Add to Home Screen") and comes back,
    // remember it so the button does not keep reappearing on iPhone/iPad.
    if (isIOS() && !document._pwaIosInstallHooked) {
      document._pwaIosInstallHooked = true;
      let guideWasOpen = false;
      document.addEventListener('visibilitychange', () => {
        const m = document.getElementById('install-guide-modal');
        if (document.hidden) {
          guideWasOpen = !!m && !m.classList.contains('hidden');
        } else if (guideWasOpen) {
          guideWasOpen = false;
          markAppInstalled();
          if (m) m.classList.add('hidden');
          const headerBtn = document.getElementById('btn-install-app');
          if (headerBtn) headerBtn.classList.add('hidden');
          const pwaBanner = document.getElementById('pwa-install-banner');
          if (pwaBanner) pwaBanner.classList.add('hidden');
        }
      });
    }

    const selectTab = (activeBtn, activeSteps) => {
      [btnAndroid, btnIos, btnDesktop].forEach((b) => b && b.classList.remove('btn-primary'));
      [stepsAndroid, stepsIos, stepsDesktop].forEach((s) => s && s.classList.add('hidden'));
      if (activeBtn) activeBtn.classList.add('btn-primary');
      if (activeSteps) activeSteps.classList.remove('hidden');
    };

    if (btnAndroid) btnAndroid.addEventListener('click', () => selectTab(btnAndroid, stepsAndroid));
    if (btnIos) btnIos.addEventListener('click', () => selectTab(btnIos, stepsIos));
    if (btnDesktop) btnDesktop.addEventListener('click', () => selectTab(btnDesktop, stepsDesktop));

    modal.querySelectorAll('.btn-close-guide').forEach((b) => {
      b.addEventListener('click', () => modal.classList.add('hidden'));
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  // Update quick install button visibility if deferredInstallPrompt changed
  const quickContainerAndroid = modal.querySelector('#quick-install-container-android');
  if (quickContainerAndroid) {
    quickContainerAndroid.classList.toggle('hidden', !deferredInstallPrompt);
  }
  const quickContainerDesktop = modal.querySelector('#quick-install-container-desktop');
  if (quickContainerDesktop) {
    quickContainerDesktop.classList.toggle('hidden', !deferredInstallPrompt);
  }

  if (window.I18N && typeof window.I18N.translateContainer === 'function') {
    window.I18N.translateContainer(modal);
  }
  modal.classList.remove('hidden');
}

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
  sharedState.analytics = historyRes.analytics || null;
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

  // If user already has an active session, auto-redirect to dashboard
  API.call('tasks/get_daily_tasks.php', { method: 'GET' })
    .then((res) => {
      if (res && res.success && res.user) {
        location.href = 'dashboard.html';
      }
    })
    .catch(() => {});

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
      showToast(window.I18N ? I18N.t('auth_welcome_toast') : 'تم إنشاء الحساب بنجاح! مرحباً بك 📖');
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
      showToast(window.I18N ? I18N.t('auth_login_toast') : 'تم تسجيل الدخول بنجاح ✓');
      setTimeout(() => { location.href = 'dashboard.html'; }, 300);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  });
}

/* ---------------- 6. Dashboard Controller (dashboard.html) ---------------- */

const TASK_DESTINATIONS = {
  HIFZ_JADID: { url: 'hifz.html',       cls: 'task-green',  keyTitle: 'task_hifz_title',     keySub: 'task_hifz_sub',     title: 'الحفظ الجديد',     sub: 'صفحة جديدة اليوم' },
  TIKRAR_AMS: { url: 'tikrar.html',     cls: 'task-amber',  keyTitle: 'task_tikrar_title',   keySub: 'task_tikrar_sub',   title: 'تكرار حفظ الأمس',   sub: 'تكرار ١٠ مرات لتثبيت الحفظ قبل الربط' },
  RABT:       { url: 'rabt.html',       cls: 'task-blue',   keyTitle: 'task_rabt_title',     keySub: 'task_rabt_sub',     title: 'الربط',            sub: 'نافذة الربط المستمرة' },
  MURAJAAH:   { url: 'murajaah.html',   cls: 'task-purple', keyTitle: 'task_murajaah_title', keySub: 'task_murajaah_sub', title: 'المراجعة',         sub: 'ختم دوري مقسم على الأيام' },
  MISTAKES:   { url: 'flashcards.html', cls: 'task-red',    keyTitle: 'task_mistakes_title', keySub: 'task_mistakes_sub', title: 'المعالجة',         sub: 'تدريب البطاقات الذكية' },
};

async function initDashboard() {
  const name = localStorage.getItem('hifz_name');
  if (name && document.getElementById('greeting')) {
    document.getElementById('greeting').textContent = (window.I18N ? I18N.t('greeting_prefix') : 'مرحباً، ') + name;
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

  if (window.I18N && !window._dashLangBound) {
    I18N.onChange(() => {
      const n = localStorage.getItem('hifz_name');
      if (n && document.getElementById('greeting')) {
        document.getElementById('greeting').textContent = I18N.t('greeting_prefix') + n;
      }
      renderDashboardUI();
    });
    window._dashLangBound = true;
  }

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
    confirmBtn.textContent = window.I18N ? I18N.t('resetting_in_progress') : 'جاري التصفير…';

    try {
      const body = sharedState.user && sharedState.user.id ? { user_id: sharedState.user.id } : null;
      await API.call('auth/reset.php', { method: 'POST', body, redirectOn401: true });
      closeReset();
      if (window.AudioEngine) AudioEngine.playSuccess();
      showToast(window.I18N ? I18N.t('reset_success_toast') : 'تم تصفير الحساب ومسح جميع السجلات بنجاح 🔄');
      await loadSharedData();
      renderDashboardUI();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = window.I18N ? I18N.t('btn_confirm_reset') : 'نعم، صفّر كل شيء وابدأ من جديد';
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
      calcPreview.innerHTML = window.I18N ? I18N.t('plan_calc_inactive') : `📊 <strong>المراجعة غير نشطة حالياً:</strong> ستنطلق المراجعة الدورية تلقائياً بعد تجاوز أول ٣٠ صفحة حفظ.`;
    } else {
      const dailyPages = Math.ceil(pool / days);
      const hizb = dailyPages / 10;
      const hizbText = Number.isInteger(hizb) ? hizb : hizb.toFixed(1);
      calcPreview.innerHTML = window.I18N
        ? I18N.t('plan_calc_active', { pool, days, daily: dailyPages, hizb: hizbText })
        : `📊 <strong>الحساب التلقائي:</strong> إجمالي صفحات المراجعة (${pool} صفحة) مقسومة على <strong>${days} أيام</strong> = <strong>${dailyPages} صفحة يومياً</strong> (~${hizbText} أحزاب) لختم المراجعة في اليوم الأخير تماماً.`;
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
        showToast(window.I18N ? I18N.t('plan_updated_toast') : 'تم تحديث خطة المراجعة بنجاح 🎯');
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
  if (currentVal) currentVal.textContent = user.current_hifz_page + ' ' + (window.I18N ? I18N.t('page_unit') : 'صفحة');

  const targetVal = document.getElementById('stat-target');
  if (targetVal) {
    const hizb = user.daily_murajaah_target_pages / 10;
    const hizbText = Number.isInteger(hizb) ? hizb : hizb.toFixed(1);
    const days = user.murajaah_days || 6;
    targetVal.textContent = window.I18N
      ? I18N.t('khatm_every_days', { days, pages: user.daily_murajaah_target_pages, hizb: hizbText })
      : `ختم كل ${days} أيام (${user.daily_murajaah_target_pages} ص / اليوم ≈ ${hizbText} أحزاب)`;
  }

  const activeMistakesCount = sharedState.history.filter((m) => m.status === 'ACTIVE').length;
  const dashAnalytics = sharedState.analytics || {};
  const dueCount = (dashAnalytics.due_summary && dashAnalytics.due_summary.due_now) || 0;
  const reviewStreak = dashAnalytics.streak || 0;
  const mistakesVal = document.getElementById('stat-active-mistakes');
  if (mistakesVal) {
    mistakesVal.textContent = window.I18N
      ? I18N.t('stat_due_mistakes') + ': ' + dueCount
      : (dueCount + ' بطاقة مستحقة اليوم');
  }

  const dateEl = document.getElementById('tasks-date');
  if (dateEl) dateEl.textContent = sharedState.date;

  // Render 4 Dynamic Task Cards
  const grid = document.getElementById('tasks-grid');
  if (!grid) return;

  const order = ['HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'MISTAKES'];
  grid.innerHTML = order.map((type) => {
    const meta = TASK_DESTINATIONS[type];
    const task = sharedState.tasks.find((t) => t.task_type === type);
    const isDisabled = !task && type !== 'MISTAKES';

    const cardTitle = window.I18N ? I18N.t(meta.keyTitle) : meta.title;
    const cardSub = window.I18N ? I18N.t(meta.keySub) : meta.sub;
    const arrowText = window.I18N ? I18N.t('task_open_arrow') : 'فتح صفحة التلاوة المستقلة ←';

    let rangeHtml = '';
    let statusPill = '';
    let progressHtml = '';
    let carriedFlag = '';

    if (type === 'MISTAKES') {
      const count = activeMistakesCount;
      rangeHtml = count > 0
        ? (dueCount > 0
            ? (window.I18N ? I18N.t('task_mistakes_due', { count: dueCount }) : (dueCount + ' بطاقة مستحقة للمراجعة'))
            : (window.I18N ? I18N.t('task_mistakes_need_practice', { count }) : (count + ' خطأ بحاجة للإتقان')))
        : (window.I18N ? I18N.t('task_no_mistakes') : 'لا توجد أخطاء نشطة ✓');

      if (reviewStreak > 0) {
        carriedFlag = `<span class="task-flag">🔥 ${reviewStreak} ${window.I18N ? I18N.t('streak_unit') : 'يوم'}</span>`;
      }

      statusPill = count > 0
        ? `<span class="task-status" style="color:var(--danger); background:var(--danger-soft)">${window.I18N ? I18N.t('task_status_ready_train') : 'متاح للتدريب'}</span>`
        : `<span class="task-status done">${window.I18N ? I18N.t('task_status_deck_done') : 'رائـع! مكتمل'}</span>`;

      progressHtml = `
        <div class="progress-wrap">
          <div class="progress-header"><span>${window.I18N ? I18N.t('task_progress_deck_title') : 'بطاقات التدريب'}</span><span>${window.I18N ? I18N.t('task_progress_deck_active', { count }) : (count + ' نشطة')}</span></div>
          <div class="progress-bar"><div class="progress-fill fill-blue" style="width:${count > 0 ? 100 : 0}%"></div></div>
        </div>`;
    } else if (task) {
      if (task.start_page === task.end_page) {
        rangeHtml = window.I18N ? I18N.t('single_page_format', { page: task.start_page }) : ('صفحة ' + task.start_page);
      } else {
        rangeHtml = window.I18N ? I18N.t('multi_page_format', { start: task.start_page, end: task.end_page }) : ('صفحات ' + task.start_page + ' – ' + task.end_page);
      }

      const total = task.total_pages || 1;
      const count = task.completed_count || (task.is_completed ? total : 0);
      const percent = task.progress_percent || (task.is_completed ? 100 : 0);

      if (type === 'TIKRAR_AMS') {
        const reps = task.repetition_count || 0;
        const target = task.target_repetitions || 10;
        statusPill = task.is_completed
          ? `<span class="task-status done">${window.I18N ? I18N.t('task_status_done_today') : '✓ مكتمل اليوم'}</span>`
          : `<span class="task-status">${window.I18N ? I18N.t('repetition_count_pill', { count: reps, total: target }) : `${reps} / ${target} تكرار`}</span>`;

        progressHtml = `
          <div class="progress-wrap">
            <div class="progress-header">
              <span>${window.I18N ? I18N.t('task_progress_title') : 'التقدم الفردي للعملية'}</span>
              <span><strong>${reps}</strong> / ${target} (${percent}%)</span>
            </div>
            <div class="progress-bar"><div class="progress-fill fill-amber" style="width:${percent}%"></div></div>
          </div>`;
      } else {
        statusPill = task.is_completed
          ? `<span class="task-status done">${window.I18N ? I18N.t('task_status_done_today') : '✓ مكتمل اليوم'}</span>`
          : `<span class="task-status">${window.I18N ? I18N.t('page_count_pill', { count, total }) : `${count} / ${total} صفحة`}</span>`;

        const fillClass = type === 'HIFZ_JADID' ? 'fill-green' : (type === 'RABT' ? 'fill-blue' : 'fill-purple');
        progressHtml = `
          <div class="progress-wrap">
            <div class="progress-header">
              <span>${window.I18N ? I18N.t('task_progress_title') : 'التقدم الفردي للعملية'}</span>
              <span><strong>${count}</strong> ${window.I18N ? I18N.t('page_count_progress', { count, total, percent }).replace(/^[0-9]+\s*/, '') : `من ${total} صفحة (${percent}%)`}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${percent}%"></div></div>
          </div>`;
      }

      if (task.carried_over) {
        carriedFlag = `<span class="task-flag">${window.I18N ? I18N.t('task_flag_carried') : 'محولة من أمس'}</span>`;
      }
    } else {
      rangeHtml = window.I18N ? I18N.t('task_status_inactive_today') : 'غير مفعّل اليوم';
      statusPill = `<span class="task-status">${window.I18N ? I18N.t('task_status_inactive') : 'غير مفعّل'}</span>`;
    }

    return `
      <a href="${meta.url}" class="task-card ${meta.cls} ${task && task.is_completed ? 'is-completed' : ''} ${isDisabled ? 'is-disabled' : ''}">
        <div class="task-top">
          <div class="task-title-wrap">
            <span class="task-dot"></span>
            <h3>${cardTitle}</h3>
          </div>
          ${carriedFlag}
        </div>
        <p class="task-sub">${cardSub}</p>
        <div class="task-range">
          <span>${rangeHtml}</span>
          ${statusPill}
        </div>
        ${progressHtml}
        <span class="task-arrow">${arrowText}</span>
      </a>
    `;
  }).join('');
}

/* ---------------- 7. Dedicated Task Recitation Controller ---------------- */

async function initDedicatedTaskPage(taskType) {
  if (window.I18N && !window['_taskLangBound_' + taskType]) {
    I18N.onChange(() => {
      renderTaskPage(taskType);
    });
    window['_taskLangBound_' + taskType] = true;
  }

  try {
    await loadSharedData();
    if (window.PageNotes) PageNotes.init(sharedState);
    renderTaskPage(taskType);
    initMistakeModal();
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message, true);
    }
  }
}

function renderTaskPage(taskType) {
  const container = document.getElementById('task-content');
  if (!container) return;

  const task = sharedState.tasks.find((t) => t.task_type === taskType);

  if (!task) {
    const isTikrar = taskType === 'TIKRAR_AMS';
    const headText = isTikrar
      ? (window.I18N ? I18N.t('tikrar_inactive_head') : 'لا يوجد تكرار لحفظ الأمس اليوم')
      : (window.I18N ? I18N.t('task_inactive_head') : 'هذه المهمة غير نشطة اليوم');
    const descText = isTikrar
      ? (window.I18N ? I18N.t('tikrar_inactive_desc') : 'لم يتم إنجاز صفحة حفظ جديد بالأمس، أو تم إتمام تكرارها مسبقاً وتثبيتها في الربط.')
      : (window.I18N ? I18N.t('task_inactive_desc') : 'حسب مسار خطتك الحالي، هذه المهمة لا تتطلب إنجازاً اليوم.');

    container.innerHTML = `
      <div class="task-page-head">
        <h2>${headText}</h2>
        <p class="hint">${descText}</p>
        <div style="display:flex; gap:0.75rem; margin-top:1rem; flex-wrap:wrap;">
          <a href="dashboard.html" class="btn btn-primary">${window.I18N ? I18N.t('back_to_home') : 'العودة للرئيسية'}</a>
          <a href="hifz.html" class="btn btn-ghost">${window.I18N ? I18N.t('card_hifz_title') : 'الحفظ الجديد'}</a>
          <a href="rabt.html" class="btn btn-ghost">${window.I18N ? I18N.t('card_rabt_title') : 'الربط'}</a>
        </div>
      </div>`;
    return;
  }

  if (taskType === 'TIKRAR_AMS') {
    renderTikrarStage(task);
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
  const isValidStored = !isNaN(storedSelection) && storedSelection >= start && storedSelection <= end;
  const allowCompletedView = sessionStorage.getItem('view_completed_' + taskType) === '1';

  if (isValidStored && (!completedList.includes(storedSelection) || allowCompletedView || completedList.length >= totalPages)) {
    activePage = storedSelection;
  } else {
    let firstUncompleted = null;
    for (let p = start; p <= end; p++) {
      if (!completedList.includes(p)) {
        firstUncompleted = p;
        break;
      }
    }
    activePage = firstUncompleted !== null ? firstUncompleted : (isValidStored ? storedSelection : start);
  }

  // Header and Progress Bar
  const isAllDone = task.is_completed || completedCount >= totalPages;
  const taskTitle = (window.I18N && window.I18N.lang === 'en' && task.title_en) ? task.title_en : (task.title_ar || '');
  const fillClass = taskType === 'HIFZ_JADID' ? 'fill-green' : (taskType === 'RABT' ? 'fill-blue' : 'fill-purple');

  const rangeHint = window.I18N ? I18N.t('required_range_hint', { start, end }) : `النطاق المطلوب: من صفحة <strong>${start}</strong> إلى <strong>${end}</strong>`;
  const doneBadge = isAllDone
    ? (window.I18N ? I18N.t('all_pages_completed') : '✓ أنجزت جميع صفحات اليوم')
    : (window.I18N ? I18N.t('pages_completed_badge', { count: completedCount, total: totalPages }) : `${completedCount} من ${totalPages} صفحة منجزة`);
  const progressLbl = window.I18N ? I18N.t('daily_recitation_progress') : 'تقدم التلاوة اليومي';
  const chipsTitle = window.I18N ? I18N.t('chips_title_text') : 'اختر صفحة للتلاوة أو تسجيل خطأ:';
  const chipsHint = window.I18N ? I18N.t('chips_hint_text') : 'كل صفحة تُتلى وتُحدد تُسجل كصفحة منجزة بشكل فردي';

  const pageHtml = `
    <div class="task-page-head">
      <div class="task-page-title-row">
        <div>
          <h2>${taskTitle}</h2>
          <p class="hint">${rangeHint}</p>
        </div>
        <div class="task-page-badge ${isAllDone ? 'green' : 'blue'}">
          ${doneBadge}
        </div>
      </div>
      <div class="progress-wrap">
        <div class="progress-header">
          <span>${progressLbl}</span>
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
        <span>${chipsTitle}</span>
        <small class="hint">${chipsHint}</small>
      </div>
      <div class="page-chips" id="task-page-chips">
        <!-- Rendered chips -->
      </div>
    </div>
  `;

  container.innerHTML = pageHtml;
  renderChipsList(taskType, task, activePage);
  renderActivePageStage(taskType, task, activePage);
  if (window.PageNotes) {
    PageNotes.prefetchRange(start, end);
    PageNotes.decorateChips();
  }
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
      sessionStorage.setItem('view_completed_' + taskType, '1');
      renderTaskPage(taskType);
    });
  });
}

function renderTikrarStage(task) {
  const container = document.getElementById('task-content');
  if (!container) return;

  const activePage = task.start_page;
  const reps = Math.max(0, Math.min(10, parseInt(task.repetition_count, 10) || 0));
  const targetReps = parseInt(task.target_repetitions, 10) || 10;
  const isAllDone = task.is_completed || reps >= targetReps;
  const percent = Math.min(100, Math.round((reps / targetReps) * 100));
  const mistakeCount = sharedState.badges[activePage] || 0;

  const taskTitle = (window.I18N && window.I18N.lang === 'en' && task.title_en) ? task.title_en : (task.title_ar || 'تكرار حفظ الأمس');
  const pageTitle = window.I18N ? I18N.t('stage_page_label', { page: activePage }) : `📖 صفحة ${activePage}`;
  const stageMeta = window.I18N ? I18N.t('stage_meta_tikrar') : 'تكرار صفحة الأمس (10 مرات متتالية قبل الربط)';

  const doneBadge = isAllDone
    ? (window.I18N ? I18N.t('tikrar_done_badge') : '✓ أتممت تكرار صفحة الأمس (10 مرات) وانضمت للربط')
    : (window.I18N ? I18N.t('repetition_count_pill', { count: reps, target: targetReps }) : `${reps} / ${targetReps} تكرارات`);

  const progressLbl = window.I18N ? I18N.t('daily_recitation_progress') : 'تقدم التلاوة والتكرار';
  const rangeHint = window.I18N ? I18N.t('task_tikrar_sub') : 'تكرار صفحة الأمس 10 مرات قبل انتقالها للربط';

  const repTitle = window.I18N ? I18N.t('repetition_count_label', { count: reps, target: targetReps }) : `عدد التكرارات المنجزة: ${reps} من ${targetReps}`;
  const btnAddText = window.I18N ? I18N.t('btn_add_repetition') : 'تلاوة مرة واحدة (+1)';
  const btnAllText = window.I18N ? I18N.t('btn_complete_all_repetitions') : 'إتمام التكرار بالكامل (10/10)';
  const btnUndoText = window.I18N ? I18N.t('btn_undo_repetition') : 'تراجع عن تكرار (-1)';
  const btnRabtText = window.I18N ? I18N.t('btn_go_to_rabt') : 'الانتقال إلى ورد الربط ←';

  const mushafBtnText = window.I18N ? I18N.t('btn_view_mushaf') : '📖 تصفح المصحف';
  const mistakeBtnText = window.I18N ? I18N.t('btn_open_mistake') : '🔴 سجل خطأ';
  const kbdHintText = window.I18N ? I18N.t('kbd_hints') : '<span>مفاتيح سريعة:</span> <kbd>Enter</kbd> أو <kbd>Space</kbd> للتلاوة (+1) | <kbd>U</kbd> للتراجع | <kbd>M</kbd> لتسجيل خطأ';

  let beadsHtml = '';
  for (let i = 1; i <= targetReps; i++) {
    const isDone = i <= reps;
    beadsHtml += `<div class="repetition-bead ${isDone ? 'done' : ''}" data-rep="${i}">${isDone ? '✓' : i}</div>`;
  }

  const verseSummary = formatPageVerseSummary(activePage, window.I18N && window.I18N.lang === 'en');

  const html = `
    <div class="task-page-head">
      <div class="task-page-title-row">
        <div>
          <h2>${taskTitle}</h2>
          <p class="hint">${rangeHint}</p>
        </div>
        <div class="task-page-badge ${isAllDone ? 'green' : 'amber'}">
          ${doneBadge}
        </div>
      </div>
      <div class="progress-wrap">
        <div class="progress-header">
          <span>${progressLbl}</span>
          <span>${percent}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill fill-amber" style="width: ${percent}%;"></div>
        </div>
      </div>
    </div>

    <div class="recitation-stage" id="recitation-stage">
      <div class="stage-top">
        <div class="stage-page-title">
          <span>${pageTitle}</span>
          <span class="task-status ${isAllDone ? 'done' : ''}">
            ${isAllDone ? (window.I18N ? I18N.t('stage_page_recited') : '✓ تمت تلاوتها وانضمت للربط') : `${reps} / ${targetReps}`}
          </span>
        </div>
        ${verseSummary ? `<div class="stage-page-verses">${verseSummary}</div>` : ''}
        <div class="stage-meta">
          ${stageMeta}
        </div>
      </div>

      ${mistakeCount > 0 ? `
        <div class="stage-warning">
          <span>${window.I18N ? I18N.t('stage_warning_mistakes', { count: mistakeCount }) : `⚠ لديك <strong>${mistakeCount}</strong> أخطاء سابقة مسجلة على هذه الصفحة. ركز عليها أثناء التكرار!`}</span>
        </div>
      ` : ''}

      <div class="repetition-tracker">
        <div class="repetition-head">
          <span class="repetition-title">${repTitle}</span>
          <span class="repetition-counter-badge">${reps} / ${targetReps}</span>
        </div>
        <div class="repetition-beads" id="repetition-beads">
          ${beadsHtml}
        </div>
      </div>

      <div class="stage-actions" style="margin-top: 1.25rem;">
        ${!isAllDone ? `
          <button type="button" id="btn-add-rep" class="btn btn-repetition-primary">
            ${btnAddText}
          </button>
          <button type="button" id="btn-complete-all-rep" class="btn btn-ghost" style="font-size:0.85rem;">
            ${btnAllText}
          </button>
        ` : `
          <a href="rabt.html" class="btn btn-success">
            ${btnRabtText}
          </a>
        `}

        ${reps > 0 ? `
          <button type="button" id="btn-undo-rep" class="btn btn-warning-outline" title="${btnUndoText}">
            ${btnUndoText}
          </button>
        ` : ''}

        <button type="button" id="btn-view-mushaf" class="btn-mushaf-view" title="${mushafBtnText}">
          ${mushafBtnText}
        </button>

        <button type="button" id="btn-open-mistake" class="btn btn-danger">
          ${mistakeBtnText}
        </button>
      </div>

      <div class="kbd-hint">
        ${kbdHintText}
      </div>

      <!-- Per-page recall board (notes / anchors / cues) -->
      <div class="page-notes-root" id="page-notes-root"></div>
    </div>
  `;

  container.innerHTML = html;

  // Event handlers
  const addBtn = document.getElementById('btn-add-rep');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      try {
        const res = await API.call('tasks/update_progress.php', {
          method: 'POST',
          body: { task_type: 'TIKRAR_AMS', completed_page: activePage },
          redirectOn401: true,
        });

        if (res.task && (res.task.is_completed || res.task.repetition_count >= targetReps)) {
          if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
            AudioEngine.playCelebration();
          }
          showToast(window.I18N ? I18N.t('tikrar_celebration_toast') : 'ما شاء الله! أتممت تكرار صفحة الأمس 10 مرات، وانضمت الآن إلى نطاق الربط مباركاً 🎉');
        } else {
          if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') {
            AudioEngine.playSuccess();
          }
          const currentRep = res.task ? res.task.repetition_count : (reps + 1);
          showToast(window.I18N ? I18N.t('tikrar_page_recited_toast', { count: currentRep, page: activePage }) : `أحسنت! سُجل التكرار رقم ${currentRep} لصفحة ${activePage} 👏`);
        }

        await loadSharedData();
        renderTaskPage('TIKRAR_AMS');
      } catch (err) {
        showToast(err.message, true);
        addBtn.disabled = false;
      }
    });
  }

  const allBtn = document.getElementById('btn-complete-all-rep');
  if (allBtn) {
    allBtn.addEventListener('click', async () => {
      allBtn.disabled = true;
      try {
        await API.call('tasks/update_progress.php', {
          method: 'POST',
          body: { task_type: 'TIKRAR_AMS', completed_page: activePage, repetition_count: 10 },
          redirectOn401: true,
        });

        if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
          AudioEngine.playCelebration();
        }
        showToast(window.I18N ? I18N.t('tikrar_celebration_toast') : 'ما شاء الله! أتممت تكرار صفحة الأمس 10 مرات، وانضمت الآن إلى نطاق الربط مباركاً 🎉');

        await loadSharedData();
        renderTaskPage('TIKRAR_AMS');
      } catch (err) {
        showToast(err.message, true);
        allBtn.disabled = false;
      }
    });
  }

  const undoBtn = document.getElementById('btn-undo-rep');
  if (undoBtn) {
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      try {
        await API.call('tasks/undo_progress.php', {
          method: 'POST',
          body: { task_type: 'TIKRAR_AMS', page: activePage, completed_page: activePage },
          redirectOn401: true,
        });

        if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
          AudioEngine.playUndo();
        }
        showToast(window.I18N ? I18N.t('tikrar_page_undone_toast', { page: activePage }) : `تم التراجع عن التكرار لصفحة ${activePage}`);

        await loadSharedData();
        renderTaskPage('TIKRAR_AMS');
      } catch (err) {
        showToast(err.message, true);
        undoBtn.disabled = false;
      }
    });
  }

  const mushafBtn = document.getElementById('btn-view-mushaf');
  if (mushafBtn) {
    mushafBtn.addEventListener('click', () => {
      openMushafModal(activePage);
    });
  }

  const mistakeBtn = document.getElementById('btn-open-mistake');
  if (mistakeBtn) {
    mistakeBtn.addEventListener('click', () => {
      openMistakeModal(activePage);
    });
  }

  if (window.PageNotes) PageNotes.mount(activePage, 'TIKRAR_AMS');
}

function renderActivePageStage(taskType, task, activePage) {
  const stage = document.getElementById('recitation-stage');
  if (!stage) return;

  const completedList = task.completed_pages || [];
  const isPageDone = completedList.includes(activePage);
  const mistakeCount = sharedState.badges[activePage] || 0;
  const taskTitle = (window.I18N && window.I18N.lang === 'en' && task.title_en) ? task.title_en : (task.title_ar || '');

  const pageTitle = window.I18N ? I18N.t('stage_page_label', { page: activePage }) : `📖 صفحة ${activePage}`;
  const statusPill = isPageDone
    ? `<span class="task-status done">${window.I18N ? I18N.t('stage_page_recited') : '✓ تمت تلاوتها'}</span>`
    : `<span class="task-status">${window.I18N ? I18N.t('stage_page_pending') : 'بانتظار التلاوة'}</span>`;
  const stageMeta = taskType === 'HIFZ_JADID'
    ? (window.I18N ? I18N.t('stage_meta_hifz') : 'الحفظ الجديد (صفحة اليوم)')
    : (window.I18N ? I18N.t('stage_meta_range', { task: taskTitle }) : ('صفحة داخل نطاق ' + taskTitle));

  const completeBtnText = isPageDone
    ? (window.I18N ? I18N.t('btn_complete_page_reconfirm') : '✓ تم إتمام هذه الصفحة (إعادة التأكيد)')
    : (window.I18N ? I18N.t('btn_complete_page_init') : '✓ تمت تلاوة الصفحة (إتمام)');

  const undoBtnText = window.I18N ? I18N.t('btn_undo_page') : '↩ التراجع عن إتمام الصفحة';
  const undoBtnTitle = window.I18N ? I18N.t('btn_undo_page_title') : 'إلغاء وسم هذه الصفحة كمنجزة وإعادتها كصفحة غير متلوة';

  const mushafBtnText = window.I18N ? I18N.t('btn_view_mushaf') : '📖 تصفح المصحف';
  const mistakeBtnText = window.I18N ? I18N.t('btn_open_mistake') : '🔴 سجل خطأ';
  const prevBtnText = window.I18N ? I18N.t('btn_prev_page', { page: activePage - 1 }) : `السابقة (${activePage - 1})`;
  const nextBtnText = window.I18N ? I18N.t('btn_next_page', { page: activePage + 1 }) : `التالية (${activePage + 1})`;
  const kbdHintText = window.I18N ? I18N.t('kbd_hints') : '<span>مفاتيح سريعة:</span> <kbd>→</kbd> <kbd>←</kbd> للتنقل | <kbd>Enter</kbd> للإتمام | <kbd>U</kbd> للتراجع | <kbd>M</kbd> لتسجيل خطأ';

  const verseSummary = formatPageVerseSummary(activePage, window.I18N && window.I18N.lang === 'en');

  stage.innerHTML = `
    <div class="stage-top">
      <div class="stage-page-title">
        <span>${pageTitle}</span>
        ${statusPill}
      </div>
      ${verseSummary ? `<div class="stage-page-verses">${verseSummary}</div>` : ''}
      <div class="stage-meta">
        ${stageMeta}
      </div>
    </div>

    ${mistakeCount > 0 ? `
      <div class="stage-warning">
        <span>${window.I18N ? I18N.t('stage_warning_mistakes', { count: mistakeCount }) : `⚠ لديك <strong>${mistakeCount}</strong> أخطاء سابقة مسجلة على هذه الصفحة. ركز عليها أثناء التلاوة!`}</span>
      </div>
    ` : ''}

    <div class="stage-actions">
      ${!isPageDone ? `
        <button type="button" id="btn-complete-page" class="btn btn-success">
          ${completeBtnText}
        </button>
      ` : `
        <button type="button" id="btn-undo-page" class="btn btn-warning-outline" title="${undoBtnTitle}">
          ${undoBtnText}
        </button>
        <button type="button" id="btn-complete-page" class="btn btn-ghost" style="font-size:0.85rem;" title="${completeBtnText}">
          ${completeBtnText}
        </button>
      `}

      <button type="button" id="btn-view-mushaf" class="btn-mushaf-view" title="${mushafBtnText}">
        ${mushafBtnText}
      </button>

      <button type="button" id="btn-open-mistake" class="btn btn-danger">
        ${mistakeBtnText}
      </button>

      <div class="stage-nav-group" style="margin-right:auto; display:flex; gap:0.5rem">
        ${activePage > task.start_page ? `<button type="button" id="btn-prev-page" class="btn btn-ghost">${prevBtnText}</button>` : ''}
        ${activePage < task.end_page ? `<button type="button" id="btn-next-page" class="btn btn-ghost">${nextBtnText}</button>` : ''}
      </div>
    </div>
    <div class="kbd-hint">
      ${kbdHintText}
    </div>

    <!-- Per-page recall board (notes / anchors / cues) -->
    <div class="page-notes-root" id="page-notes-root"></div>
  `;

  // Action listeners
  const completeBtn = document.getElementById('btn-complete-page');
  if (completeBtn) {
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
          showToast(window.I18N ? I18N.t('task_celebration_toast', { title: taskTitle }) : `🎉 مبارك! تم إنجاز جميع صفحات ${taskTitle} لليوم!`);
        } else {
          AudioEngine.playSuccess();
          showToast(window.I18N ? I18N.t('page_completed_toast', { page: activePage }) : `تم تسجيل إتمام صفحة ${activePage} بنجاح ✓`);
        }

        await loadSharedData();

        // Calculate next uncompleted page to display automatically
        const updatedTask = sharedState.tasks.find((t) => t.task_type === taskType) || task;
        const updatedCompleted = (updatedTask.completed_pages || []).slice();
        if (!updatedCompleted.includes(activePage)) {
          updatedCompleted.push(activePage);
        }

        let nextCandidate = null;
        // 1. Search forward after activePage
        for (let p = activePage + 1; p <= updatedTask.end_page; p++) {
          if (!updatedCompleted.includes(p)) {
            nextCandidate = p;
            break;
          }
        }
        // 2. Wrap around to search earlier pages in task range
        if (nextCandidate === null) {
          for (let p = updatedTask.start_page; p < activePage; p++) {
            if (!updatedCompleted.includes(p)) {
              nextCandidate = p;
              break;
            }
          }
        }
        // 3. Fallback if all pages are done
        if (nextCandidate === null) {
          nextCandidate = Math.min(updatedTask.end_page, activePage + 1);
        }

        sessionStorage.setItem('selected_page_' + taskType, nextCandidate);
        sessionStorage.removeItem('view_completed_' + taskType);
        renderTaskPage(taskType);
      } catch (err) {
        showToast(err.message, true);
        completeBtn.disabled = false;
      }
    });
  }

  const undoBtn = document.getElementById('btn-undo-page');
  if (undoBtn) {
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      undoBtn.textContent = window.I18N ? I18N.t('undo_in_progress') : 'جاري التراجع…';
      try {
        await API.call('tasks/undo_progress.php', {
          method: 'POST',
          body: { task_type: taskType, page: activePage, completed_page: activePage },
          redirectOn401: true,
        });

        if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
          AudioEngine.playUndo();
        }
        showToast(window.I18N ? I18N.t('page_undone_toast', { page: activePage }) : `تم التراجع عن إتمام صفحة ${activePage} بنجاح ↩`);

        sessionStorage.setItem('selected_page_' + taskType, activePage);
        sessionStorage.removeItem('view_completed_' + taskType);
        await loadSharedData();
        renderTaskPage(taskType);
      } catch (err) {
        showToast(err.message, true);
        undoBtn.disabled = false;
        undoBtn.textContent = undoBtnText;
      }
    });
  }

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
      sessionStorage.setItem('view_completed_' + taskType, '1');
      renderTaskPage(taskType);
    });
  }

  const nextBtn = document.getElementById('btn-next-page');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      sessionStorage.setItem('selected_page_' + taskType, activePage + 1);
      sessionStorage.setItem('view_completed_' + taskType, '1');
      renderTaskPage(taskType);
    });
  }

  if (window.PageNotes) PageNotes.mount(activePage, taskType);
}

/* ---------------- 8. Mistake Logging Modal (Shared) ---------------- */

let modalActivePage = 1;
let modalSelectedTag = 'TRANSITION_FAILURE';
let modalSeverity = 1;

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

// Precomputed 604-page verse ranges for Madinah Mushaf (0 errors, 6236 ayahs)
const MADINAH_PAGE_VERSES = [[[1,1,7]],[[2,1,5]],[[2,6,16]],[[2,17,24]],[[2,25,29]],[[2,30,37]],[[2,38,48]],[[2,49,57]],[[2,58,61]],[[2,62,69]],[[2,70,76]],[[2,77,83]],[[2,84,88]],[[2,89,93]],[[2,94,101]],[[2,102,105]],[[2,106,112]],[[2,113,119]],[[2,120,126]],[[2,127,134]],[[2,135,141]],[[2,142,145]],[[2,146,153]],[[2,154,163]],[[2,164,169]],[[2,170,176]],[[2,177,181]],[[2,182,186]],[[2,187,190]],[[2,191,196]],[[2,197,202]],[[2,203,210]],[[2,211,215]],[[2,216,219]],[[2,220,224]],[[2,225,230]],[[2,231,233]],[[2,234,237]],[[2,238,245]],[[2,246,248]],[[2,249,252]],[[2,253,256]],[[2,257,259]],[[2,260,264]],[[2,265,269]],[[2,270,274]],[[2,275,281]],[[2,282,282]],[[2,283,286]],[[3,1,9]],[[3,10,15]],[[3,16,22]],[[3,23,29]],[[3,30,37]],[[3,38,45]],[[3,46,52]],[[3,53,61]],[[3,62,70]],[[3,71,77]],[[3,78,83]],[[3,84,91]],[[3,92,100]],[[3,101,108]],[[3,109,115]],[[3,116,121]],[[3,122,132]],[[3,133,140]],[[3,141,148]],[[3,149,153]],[[3,154,157]],[[3,158,165]],[[3,166,173]],[[3,174,180]],[[3,181,186]],[[3,187,194]],[[3,195,200]],[[4,1,6]],[[4,7,11]],[[4,12,14]],[[4,15,19]],[[4,20,23]],[[4,24,26]],[[4,27,33]],[[4,34,37]],[[4,38,44]],[[4,45,51]],[[4,52,59]],[[4,60,65]],[[4,66,74]],[[4,75,79]],[[4,80,86]],[[4,87,91]],[[4,92,94]],[[4,95,101]],[[4,102,105]],[[4,106,113]],[[4,114,121]],[[4,122,127]],[[4,128,134]],[[4,135,140]],[[4,141,147]],[[4,148,154]],[[4,155,162]],[[4,163,170]],[[4,171,175]],[[4,176,176],[5,1,2]],[[5,3,5]],[[5,6,9]],[[5,10,13]],[[5,14,17]],[[5,18,23]],[[5,24,31]],[[5,32,36]],[[5,37,41]],[[5,42,45]],[[5,46,50]],[[5,51,57]],[[5,58,64]],[[5,65,70]],[[5,71,76]],[[5,77,82]],[[5,83,89]],[[5,90,95]],[[5,96,103]],[[5,104,108]],[[5,109,113]],[[5,114,120]],[[6,1,8]],[[6,9,18]],[[6,19,27]],[[6,28,35]],[[6,36,44]],[[6,45,52]],[[6,53,59]],[[6,60,68]],[[6,69,73]],[[6,74,81]],[[6,82,90]],[[6,91,94]],[[6,95,101]],[[6,102,110]],[[6,111,118]],[[6,119,124]],[[6,125,131]],[[6,132,137]],[[6,138,142]],[[6,143,146]],[[6,147,151]],[[6,152,157]],[[6,158,165]],[[7,1,11]],[[7,12,22]],[[7,23,30]],[[7,31,37]],[[7,38,43]],[[7,44,51]],[[7,52,57]],[[7,58,67]],[[7,68,73]],[[7,74,81]],[[7,82,87]],[[7,88,95]],[[7,96,104]],[[7,105,120]],[[7,121,130]],[[7,131,137]],[[7,138,143]],[[7,144,149]],[[7,150,155]],[[7,156,159]],[[7,160,163]],[[7,164,170]],[[7,171,178]],[[7,179,187]],[[7,188,195]],[[7,196,206]],[[8,1,8]],[[8,9,16]],[[8,17,25]],[[8,26,33]],[[8,34,40]],[[8,41,45]],[[8,46,52]],[[8,53,61]],[[8,62,69]],[[8,70,75]],[[9,1,6]],[[9,7,13]],[[9,14,20]],[[9,21,26]],[[9,27,31]],[[9,32,36]],[[9,37,40]],[[9,41,47]],[[9,48,54]],[[9,55,61]],[[9,62,68]],[[9,69,72]],[[9,73,79]],[[9,80,86]],[[9,87,93]],[[9,94,99]],[[9,100,106]],[[9,107,111]],[[9,112,117]],[[9,118,122]],[[9,123,129]],[[10,1,6]],[[10,7,14]],[[10,15,20]],[[10,21,25]],[[10,26,33]],[[10,34,42]],[[10,43,53]],[[10,54,61]],[[10,62,70]],[[10,71,78]],[[10,79,88]],[[10,89,97]],[[10,98,106]],[[10,107,109],[11,1,5]],[[11,6,12]],[[11,13,19]],[[11,20,28]],[[11,29,37]],[[11,38,45]],[[11,46,53]],[[11,54,62]],[[11,63,71]],[[11,72,81]],[[11,82,88]],[[11,89,97]],[[11,98,108]],[[11,109,117]],[[11,118,123],[12,1,4]],[[12,5,14]],[[12,15,22]],[[12,23,30]],[[12,31,37]],[[12,38,43]],[[12,44,52]],[[12,53,63]],[[12,64,69]],[[12,70,78]],[[12,79,86]],[[12,87,95]],[[12,96,103]],[[12,104,111]],[[13,1,5]],[[13,6,13]],[[13,14,18]],[[13,19,28]],[[13,29,34]],[[13,35,42]],[[13,43,43],[14,1,5]],[[14,6,10]],[[14,11,18]],[[14,19,24]],[[14,25,33]],[[14,34,42]],[[14,43,52]],[[15,1,15]],[[15,16,31]],[[15,32,51]],[[15,52,70]],[[15,71,90]],[[15,91,99],[16,1,6]],[[16,7,14]],[[16,15,26]],[[16,27,34]],[[16,35,42]],[[16,43,54]],[[16,55,64]],[[16,65,72]],[[16,73,79]],[[16,80,87]],[[16,88,93]],[[16,94,102]],[[16,103,110]],[[16,111,118]],[[16,119,128]],[[17,1,7]],[[17,8,17]],[[17,18,27]],[[17,28,38]],[[17,39,49]],[[17,50,58]],[[17,59,66]],[[17,67,75]],[[17,76,86]],[[17,87,96]],[[17,97,104]],[[17,105,111],[18,1,4]],[[18,5,15]],[[18,16,20]],[[18,21,27]],[[18,28,34]],[[18,35,45]],[[18,46,53]],[[18,54,61]],[[18,62,74]],[[18,75,83]],[[18,84,97]],[[18,98,110]],[[19,1,11]],[[19,12,25]],[[19,26,38]],[[19,39,51]],[[19,52,64]],[[19,65,76]],[[19,77,95]],[[19,96,98],[20,1,12]],[[20,13,37]],[[20,38,51]],[[20,52,64]],[[20,65,76]],[[20,77,87]],[[20,88,98]],[[20,99,113]],[[20,114,125]],[[20,126,135]],[[21,1,10]],[[21,11,24]],[[21,25,35]],[[21,36,44]],[[21,45,57]],[[21,58,72]],[[21,73,81]],[[21,82,90]],[[21,91,101]],[[21,102,112]],[[22,1,5]],[[22,6,15]],[[22,16,23]],[[22,24,30]],[[22,31,38]],[[22,39,46]],[[22,47,55]],[[22,56,64]],[[22,65,72]],[[22,73,78]],[[23,1,17]],[[23,18,27]],[[23,28,42]],[[23,43,59]],[[23,60,74]],[[23,75,89]],[[23,90,104]],[[23,105,118]],[[24,1,10]],[[24,11,20]],[[24,21,27]],[[24,28,31]],[[24,32,36]],[[24,37,43]],[[24,44,53]],[[24,54,58]],[[24,59,61]],[[24,62,64],[25,1,2]],[[25,3,11]],[[25,12,20]],[[25,21,32]],[[25,33,43]],[[25,44,55]],[[25,56,67]],[[25,68,77]],[[26,1,19]],[[26,20,39]],[[26,40,60]],[[26,61,83]],[[26,84,111]],[[26,112,136]],[[26,137,159]],[[26,160,183]],[[26,184,206]],[[26,207,227]],[[27,1,13]],[[27,14,22]],[[27,23,35]],[[27,36,44]],[[27,45,55]],[[27,56,63]],[[27,64,76]],[[27,77,88]],[[27,89,93],[28,1,5]],[[28,6,13]],[[28,14,21]],[[28,22,28]],[[28,29,35]],[[28,36,43]],[[28,44,50]],[[28,51,59]],[[28,60,70]],[[28,71,77]],[[28,78,84]],[[28,85,88],[29,1,6]],[[29,7,14]],[[29,15,23]],[[29,24,30]],[[29,31,38]],[[29,39,45]],[[29,46,52]],[[29,53,63]],[[29,64,69],[30,1,5]],[[30,6,15]],[[30,16,24]],[[30,25,32]],[[30,33,41]],[[30,42,50]],[[30,51,60]],[[31,1,11]],[[31,12,19]],[[31,20,28]],[[31,29,34]],[[32,1,11]],[[32,12,20]],[[32,21,30]],[[33,1,6]],[[33,7,15]],[[33,16,22]],[[33,23,30]],[[33,31,35]],[[33,36,43]],[[33,44,50]],[[33,51,54]],[[33,55,62]],[[33,63,73]],[[34,1,7]],[[34,8,14]],[[34,15,22]],[[34,23,31]],[[34,32,39]],[[34,40,48]],[[34,49,54],[35,1,3]],[[35,4,11]],[[35,12,18]],[[35,19,30]],[[35,31,38]],[[35,39,44]],[[35,45,45],[36,1,12]],[[36,13,27]],[[36,28,40]],[[36,41,54]],[[36,55,70]],[[36,71,83]],[[37,1,24]],[[37,25,51]],[[37,52,76]],[[37,77,102]],[[37,103,126]],[[37,127,153]],[[37,154,182]],[[38,1,16]],[[38,17,26]],[[38,27,42]],[[38,43,61]],[[38,62,83]],[[38,84,88],[39,1,5]],[[39,6,10]],[[39,11,21]],[[39,22,31]],[[39,32,40]],[[39,41,47]],[[39,48,56]],[[39,57,67]],[[39,68,74]],[[39,75,75],[40,1,7]],[[40,8,16]],[[40,17,25]],[[40,26,33]],[[40,34,40]],[[40,41,49]],[[40,50,58]],[[40,59,66]],[[40,67,77]],[[40,78,85]],[[41,1,11]],[[41,12,20]],[[41,21,29]],[[41,30,38]],[[41,39,46]],[[41,47,54]],[[42,1,10]],[[42,11,15]],[[42,16,22]],[[42,23,31]],[[42,32,44]],[[42,45,51]],[[42,52,53],[43,1,10]],[[43,11,22]],[[43,23,33]],[[43,34,47]],[[43,48,60]],[[43,61,73]],[[43,74,89]],[[44,1,18]],[[44,19,39]],[[44,40,59]],[[45,1,13]],[[45,14,22]],[[45,23,32]],[[45,33,37],[46,1,5]],[[46,6,14]],[[46,15,20]],[[46,21,28]],[[46,29,35]],[[47,1,11]],[[47,12,19]],[[47,20,29]],[[47,30,38]],[[48,1,9]],[[48,10,15]],[[48,16,23]],[[48,24,28]],[[48,29,29],[49,1,4]],[[49,5,11]],[[49,12,18]],[[50,1,15]],[[50,16,35]],[[50,36,45],[51,1,6]],[[51,7,30]],[[51,31,51]],[[51,52,60],[52,1,14]],[[52,15,31]],[[52,32,49]],[[53,1,26]],[[53,27,44]],[[53,45,62],[54,1,6]],[[54,7,27]],[[54,28,49]],[[54,50,55],[55,1,16]],[[55,17,40]],[[55,41,67]],[[55,68,78],[56,1,16]],[[56,17,50]],[[56,51,76]],[[56,77,96],[57,1,3]],[[57,4,11]],[[57,12,18]],[[57,19,24]],[[57,25,29]],[[58,1,6]],[[58,7,11]],[[58,12,21]],[[58,22,22],[59,1,3]],[[59,4,9]],[[59,10,16]],[[59,17,24]],[[60,1,5]],[[60,6,11]],[[60,12,13],[61,1,5]],[[61,6,14]],[[62,1,8]],[[62,9,11],[63,1,4]],[[63,5,11]],[[64,1,9]],[[64,10,18]],[[65,1,5]],[[65,6,12]],[[66,1,7]],[[66,8,12]],[[67,1,12]],[[67,13,26]],[[67,27,30],[68,1,15]],[[68,16,42]],[[68,43,52],[69,1,8]],[[69,9,34]],[[69,35,52],[70,1,10]],[[70,11,39]],[[70,40,44],[71,1,10]],[[71,11,28]],[[72,1,13]],[[72,14,28]],[[73,1,19]],[[73,20,20],[74,1,17]],[[74,18,47]],[[74,48,56],[75,1,19]],[[75,20,40],[76,1,5]],[[76,6,25]],[[76,26,31],[77,1,19]],[[77,20,50]],[[78,1,30]],[[78,31,40],[79,1,15]],[[79,16,46]],[[80,1,42]],[[81,1,29]],[[82,1,19],[83,1,6]],[[83,7,34]],[[83,35,36],[84,1,25]],[[85,1,22]],[[86,1,17],[87,1,15]],[[87,16,19],[88,1,26]],[[89,1,23]],[[89,24,30],[90,1,20]],[[91,1,15],[92,1,14]],[[92,15,21],[93,1,11],[94,1,8]],[[95,1,8],[96,1,19]],[[97,1,5],[98,1,7]],[[98,8,8],[99,1,8],[100,1,9]],[[100,10,11],[101,1,11],[102,1,8]],[[103,1,3],[104,1,9],[105,1,5]],[[106,1,4],[107,1,7],[108,1,3]],[[109,1,6],[110,1,3],[111,1,5]],[[112,1,4],[113,1,5],[114,1,6]]];

function getPageVerseSections(pageNumber) {
  if (!pageNumber || pageNumber < 1 || pageNumber > 604) return [];
  const raw = MADINAH_PAGE_VERSES[pageNumber - 1];
  if (!raw) return [];
  const list = window.SURAHS_DATA || SURAHS_LIST;
  return raw.map(([sId, fromA, toA]) => {
    const sData = list.find((s) => s.id === sId) || {};
    return {
      surahId: sId,
      fromAyah: fromA,
      toAyah: toA,
      surahNameAr: sData.name_ar || sData.name || '',
      surahNameEn: window.I18N ? window.I18N.getSurahName(sId) : (sData.name_en || sData.name || ''),
      totalAyahs: sData.ayahs || 0,
    };
  });
}

function formatPageVerseSummary(pageNumber, isEnglish = false) {
  const sections = getPageVerseSections(pageNumber);
  if (!sections || sections.length === 0) return '';
  return sections.map((sec) => {
    const sName = isEnglish ? sec.surahNameEn : sec.surahNameAr;
    const prefix = isEnglish ? `Surah ${sName}` : `سورة ${sName}`;
    const range = (sec.fromAyah === sec.toAyah)
      ? (isEnglish ? `v. ${sec.fromAyah}` : `الآية ${sec.fromAyah}`)
      : (isEnglish ? `vv. ${sec.fromAyah}–${sec.toAyah}` : `الآيات ${sec.fromAyah}–${sec.toAyah}`);
    return `${prefix} (${range})`;
  }).join(isEnglish ? ' • ' : '، ');
}

let modalShowAllAyahs = false;

function populateSurahOptions(pageNumber) {
  const surahSelect = document.getElementById('mistake-surah');
  if (!surahSelect) return;
  const currentVal = parseInt(surahSelect.value, 10);
  surahSelect.innerHTML = `<option value="">${window.I18N ? window.I18N.t('mistake_surah_placeholder') : '— اختر السورة —'}</option>`;
  const list = window.SURAHS_DATA || SURAHS_LIST;

  const sections = pageNumber ? getPageVerseSections(pageNumber) : [];
  const pageSurahIds = sections.map((s) => s.surahId);

  if (pageSurahIds.length > 0) {
    const pageGroup = document.createElement('optgroup');
    pageGroup.label = window.I18N ? window.I18N.t('optgroup_page_surahs') : 'سور هذه الصفحة';
    pageSurahIds.forEach((sId) => {
      const s = list.find((item) => item.id === sId);
      if (s) {
        const opt = document.createElement('option');
        opt.value = s.id;
        const sName = window.I18N ? window.I18N.getSurahName(s.id) : (s.name_ar || s.name);
        opt.textContent = `${s.id}. ${(window.I18N && window.I18N.lang === 'en') ? 'Surah ' + sName : 'سورة ' + sName}`;
        pageGroup.appendChild(opt);
      }
    });
    surahSelect.appendChild(pageGroup);

    const otherGroup = document.createElement('optgroup');
    otherGroup.label = window.I18N ? window.I18N.t('optgroup_all_surahs') : 'باقي سور القرآن';
    list.forEach((s) => {
      if (!pageSurahIds.includes(s.id)) {
        const opt = document.createElement('option');
        opt.value = s.id;
        const sName = window.I18N ? window.I18N.getSurahName(s.id) : (s.name_ar || s.name);
        opt.textContent = `${s.id}. ${(window.I18N && window.I18N.lang === 'en') ? 'Surah ' + sName : 'سورة ' + sName}`;
        otherGroup.appendChild(opt);
      }
    });
    surahSelect.appendChild(otherGroup);
  } else {
    list.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const sName = window.I18N ? window.I18N.getSurahName(s.id) : (s.name_ar || s.name);
      opt.textContent = `${s.id}. ${(window.I18N && window.I18N.lang === 'en') ? 'Surah ' + sName : 'سورة ' + sName}`;
      surahSelect.appendChild(opt);
    });
  }

  if (currentVal) surahSelect.value = currentVal;
}

function renderAyahOptions(sId, pageNumber, showAll = false) {
  const ayahSelect = document.getElementById('mistake-ayah');
  if (!ayahSelect) return;

  const currentAyah = parseInt(ayahSelect.value, 10);
  ayahSelect.innerHTML = `<option value="">${window.I18N ? I18N.t('mistake_ayah_placeholder') : '— اختر الآية —'}</option>`;

  const list = window.SURAHS_DATA || SURAHS_LIST;
  const sData = list.find((s) => s.id === sId);
  if (!sData) return;

  const sections = pageNumber ? getPageVerseSections(pageNumber) : [];
  const matchingSection = sections.find((sec) => sec.surahId === sId);

  const chipsWrap = document.getElementById('ayah-chips-wrap');
  const chipsGroup = document.getElementById('ayah-chips-group');
  const toggleBtn = document.getElementById('btn-toggle-all-ayahs');

  let startAyah = 1;
  let endAyah = sData.ayahs;
  const isPageRestricted = matchingSection && !showAll;

  if (isPageRestricted) {
    startAyah = matchingSection.fromAyah;
    endAyah = matchingSection.toAyah;
  }

  for (let i = startAyah; i <= endAyah; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = window.I18N ? I18N.t('ayah_label', { num: i }) : ('الآية ' + i);
    ayahSelect.appendChild(opt);
  }

  if (currentAyah >= startAyah && currentAyah <= endAyah) {
    ayahSelect.value = currentAyah;
  }

  // Render quick chips for this page's verses
  if (matchingSection && chipsWrap && chipsGroup) {
    chipsWrap.classList.remove('hidden');
    let chipsHtml = '';
    for (let i = matchingSection.fromAyah; i <= matchingSection.toAyah; i++) {
      const isSelected = (ayahSelect.value && parseInt(ayahSelect.value, 10) === i);
      chipsHtml += `<button type="button" class="ayah-chip ${isSelected ? 'active' : ''}" data-ayah="${i}">${i}</button>`;
    }
    chipsGroup.innerHTML = chipsHtml;

    chipsGroup.querySelectorAll('.ayah-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.ayah, 10);
        ayahSelect.value = val;
        chipsGroup.querySelectorAll('.ayah-chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  } else if (chipsWrap) {
    chipsWrap.classList.add('hidden');
  }

  // Toggle button state
  if (toggleBtn) {
    if (matchingSection) {
      toggleBtn.classList.remove('hidden');
      if (showAll) {
        const count = matchingSection.toAyah - matchingSection.fromAyah + 1;
        toggleBtn.textContent = window.I18N ? I18N.t('btn_show_page_ayahs_only', { count }) : `الاقتصار على آيات الصفحة (${count} آية)`;
      } else {
        toggleBtn.textContent = window.I18N ? I18N.t('btn_show_all_ayahs', { total: sData.ayahs }) : `عرض جميع آيات السورة (${sData.ayahs} آية)`;
      }
    } else {
      toggleBtn.classList.add('hidden');
    }
  }
}

function populateConfusedSurahOptions() {
  const sel = document.getElementById('mistake-confused-surah');
  if (!sel) return;
  const current = sel.value;
  const list = window.SURAHS_DATA || SURAHS_LIST;
  sel.innerHTML = `<option value="">${window.I18N ? I18N.t('mistake_confused_placeholder') : '— لا يوجد التباس —'}</option>`;
  list.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    const sName = window.I18N ? I18N.getSurahName(s.id) : (s.name_ar || s.name);
    opt.textContent = `${s.id}. ${(window.I18N && window.I18N.lang === 'en') ? 'Surah ' + sName : 'سورة ' + sName}`;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderConfusedAyahOptions(sId) {
  const sel = document.getElementById('mistake-confused-ayah');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${window.I18N ? I18N.t('mistake_confused_placeholder') : '— لا يوجد التباس —'}</option>`;
  const list = window.SURAHS_DATA || SURAHS_LIST;
  const sData = list.find((s) => s.id === sId);
  if (!sData) return;
  for (let i = 1; i <= sData.ayahs; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = window.I18N ? I18N.t('ayah_label', { num: i }) : ('الآية ' + i);
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

function refreshMistakeModalLabels() {
  populateSurahOptions(modalActivePage);
  populateConfusedSurahOptions();
  if (document.getElementById('mistake-surah')) {
    const currentSurah = parseInt(document.getElementById('mistake-surah').value, 10);
    if (currentSurah) {
      renderAyahOptions(currentSurah, modalActivePage, modalShowAllAyahs);
    }
  }
  document.querySelectorAll('#mistake-tags .tag-btn').forEach((btn) => {
    if (window.I18N) btn.textContent = I18N.getMistakeLabel(btn.dataset.type);
  });
}

function initMistakeModal() {
  const modal = document.getElementById('mistake-modal');
  if (!modal) return;

  const surahSelect = document.getElementById('mistake-surah');
  const ayahSelect = document.getElementById('mistake-ayah');
  const toggleBtn = document.getElementById('btn-toggle-all-ayahs');

  refreshMistakeModalLabels();

  if (window.I18N && !window._mistakeModalLangBound) {
    I18N.onChange(refreshMistakeModalLabels);
    window._mistakeModalLangBound = true;
  }

  if (surahSelect) {
    surahSelect.addEventListener('change', () => {
      const sId = parseInt(surahSelect.value, 10);
      modalShowAllAyahs = false;
      renderAyahOptions(sId, modalActivePage, false);
    });
  }

  if (ayahSelect) {
    ayahSelect.addEventListener('change', () => {
      const val = parseInt(ayahSelect.value, 10);
      const chipsGroup = document.getElementById('ayah-chips-group');
      if (chipsGroup) {
        chipsGroup.querySelectorAll('.ayah-chip').forEach((b) => {
          b.classList.toggle('active', parseInt(b.dataset.ayah, 10) === val);
        });
      }
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      modalShowAllAyahs = !modalShowAllAyahs;
      const sId = parseInt(surahSelect.value, 10);
      renderAyahOptions(sId, modalActivePage, modalShowAllAyahs);
    });
  }

  document.querySelectorAll('#mistake-tags .tag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mistake-tags .tag-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      modalSelectedTag = btn.dataset.type;
      const wrap = document.getElementById('mistake-confused-wrap');
      if (wrap) wrap.classList.toggle('hidden', modalSelectedTag !== 'MUTASHABIHAT');
    });
  });

  document.querySelectorAll('#mistake-severity .tag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mistake-severity .tag-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      modalSeverity = parseInt(btn.dataset.sev, 10) || 1;
    });
  });

  populateConfusedSurahOptions();
  const confusedSurahSel = document.getElementById('mistake-confused-surah');
  if (confusedSurahSel) {
    confusedSurahSel.addEventListener('change', () => {
      renderConfusedAyahOptions(parseInt(confusedSurahSel.value, 10));
    });
  }

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
        showToast(window.I18N ? I18N.t('mistake_select_required') : 'يرجى اختيار السورة ورقم الآية أولاً', true);
        return;
      }

      saveBtn.disabled = true;
      try {
        const confusedSurahEl = document.getElementById('mistake-confused-surah');
        const confusedAyahEl = document.getElementById('mistake-confused-ayah');
        const confusedSurah = confusedSurahEl && confusedSurahEl.value ? parseInt(confusedSurahEl.value, 10) : null;
        const confusedAyah = confusedAyahEl && confusedAyahEl.value ? parseInt(confusedAyahEl.value, 10) : null;

        const res = await API.call('mistakes/record_mistake.php', {
          method: 'POST',
          body: {
            page_number: modalActivePage,
            surah_number: surahVal,
            ayah_number: ayahVal,
            mistake_type: modalSelectedTag,
            notes: notesVal || null,
            severity: modalSeverity,
            confused_with_surah: confusedSurah,
            confused_with_ayah: confusedAyah,
            source_task: document.body.dataset.taskType || null,
          },
          redirectOn401: true,
        });

        if (res && res.merged) {
          showToast(window.I18N ? I18N.t('mistake_merged_toast') : 'هذا الخطأ مسجل مسبقاً — تم تحديث عدد تكراره 🔁');
        } else {
          showToast(window.I18N ? I18N.t('mistake_logged_toast') : 'تم تسجيل الخطأ بنجاح 🔴 وسيظهر في بطاقات المعالجة');
        }
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

function openMistakeModal(pageNumber) {
  modalActivePage = pageNumber;
  modalShowAllAyahs = false;
  const modal = document.getElementById('mistake-modal');
  if (!modal) return;

  const pageBadge = document.getElementById('modal-page');
  if (pageBadge) pageBadge.textContent = (window.I18N ? window.I18N.t('page_prefix') : 'صفحة ') + pageNumber;

  const verseSummary = formatPageVerseSummary(pageNumber, window.I18N && window.I18N.lang === 'en');
  let versesBadge = document.getElementById('modal-page-verses');
  if (!versesBadge) {
    const headTitle = modal.querySelector('.modal-head h3');
    if (headTitle) {
      versesBadge = document.createElement('div');
      versesBadge.id = 'modal-page-verses';
      versesBadge.className = 'modal-page-verses';
      headTitle.parentNode.insertBefore(versesBadge, headTitle.nextSibling);
    }
  }
  if (versesBadge) {
    versesBadge.textContent = verseSummary;
    versesBadge.classList.toggle('hidden', !verseSummary);
  }

  document.getElementById('mistake-note').value = '';

  // Reset severity + mutashabihat pairing
  modalSeverity = 1;
  const sevFirst = document.querySelector('#mistake-severity .tag-btn');
  if (sevFirst) {
    document.querySelectorAll('#mistake-severity .tag-btn').forEach((b) => b.classList.remove('active'));
    sevFirst.classList.add('active');
  }
  const confusedWrap = document.getElementById('mistake-confused-wrap');
  if (confusedWrap) confusedWrap.classList.add('hidden');
  if (document.getElementById('mistake-confused-surah')) document.getElementById('mistake-confused-surah').value = '';
  if (document.getElementById('mistake-confused-ayah')) document.getElementById('mistake-confused-ayah').value = '';
  populateConfusedSurahOptions();

  // Auto-detect and populate Surahs for this page
  populateSurahOptions(pageNumber);

  const surahSelect = document.getElementById('mistake-surah');
  if (surahSelect) {
    const sections = getPageVerseSections(pageNumber);
    const detectedSurah = sections.length > 0 ? sections[0].surahId : (SURAH_START_PAGES[0]?.id || 1);
    surahSelect.value = detectedSurah;
    renderAyahOptions(detectedSurah, pageNumber, false);
  }

  // Reset tag selection to first tag
  const firstTag = document.querySelector('#mistake-tags .tag-btn');
  if (firstTag) {
    document.querySelectorAll('#mistake-tags .tag-btn').forEach((b) => b.classList.remove('active'));
    firstTag.classList.add('active');
    modalSelectedTag = firstTag.dataset?.type || 'TRANSITION_FAILURE';
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
  const modalTitle = window.I18N ? I18N.t('mushaf_modal_title', { page: pageNumber }) : `📖 مصحف المدينة — صفحة ${pageNumber}`;
  const openExternalText = window.I18N ? I18N.t('mushaf_open_external') : 'فتح على Quran.com ↗';
  const offlineErr = window.I18N ? I18N.t('mushaf_offline_error') : 'تعذر تحميل صورة الصفحة في وضع عدم الاتصال';
  const offlineHint = window.I18N ? I18N.t('mushaf_offline_hint') : 'يمكنك تلاوة الصفحة مباشرة من مصحفك أو النقر أدناه لفتحها على الويب:';
  const offlineBtn = window.I18N ? I18N.t('mushaf_open_btn') : 'فتح الصفحة على Quran.com';

  modal.innerHTML = `
    <div class="mushaf-modal-content" role="dialog" aria-modal="true">
      <div class="mushaf-modal-head">
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <h3 style="font-size:1.1rem;">${modalTitle}</h3>
          <a href="${quranComUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="padding:0.25rem 0.6rem; font-size:0.75rem;">
            ${openExternalText}
          </a>
        </div>
        <button type="button" id="btn-close-mushaf" class="btn btn-ghost" style="padding:0.35rem 0.65rem; font-size:1.1rem;" aria-label="إغلاق">✕</button>
      </div>
      <div class="mushaf-img-frame">
        <img src="${imgUrl}" alt="${modalTitle}" class="mushaf-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'mushaf-fallback-box\\'><h3>${offlineErr}</h3><p class=\\'hint\\'>${offlineHint}</p><a href=\\'${quranComUrl}\\' target=\\'_blank\\' class=\\'btn btn-primary\\'>${offlineBtn}</a></div>';">
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
    } else if (e.key === 'Enter' || e.key === ' ') {
      const addRepBtn = document.getElementById('btn-add-rep');
      const compBtn = document.getElementById('btn-complete-page');
      if (addRepBtn && !addRepBtn.disabled) {
        if (e.key === ' ') e.preventDefault();
        addRepBtn.click();
      } else if (compBtn && !compBtn.disabled) {
        compBtn.click();
      }
    } else if (e.key === 'u' || e.key === 'U' || e.key === 'ع') {
      const undoRepBtn = document.getElementById('btn-undo-rep');
      const undoBtn = document.getElementById('btn-undo-page');
      if (undoRepBtn && !undoRepBtn.disabled) {
        undoRepBtn.click();
      } else if (undoBtn && !undoBtn.disabled) {
        undoBtn.click();
      }
    } else if (e.key === 'm' || e.key === 'M' || e.key === 'ة') {
      const mistBtn = document.getElementById('btn-open-mistake');
      if (mistBtn) mistBtn.click();
    } else if (e.key === 'n' || e.key === 'N') {
      const pnToggle = document.getElementById('pn-toggle');
      if (pnToggle) {
        e.preventDefault();
        pnToggle.click();
        if (window.PageNotes && PageNotes.collapsed === false) {
          const ta = document.getElementById('pn-note');
          if (ta) ta.focus();
        }
      }
    }
  });
}

/* ---------------- 9. DOM Ready Initialization ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  initThemeEngine();
  initWakeLockEngine();
  AudioEngine.init();
  initKeyboardShortcuts();
  initPWAEngine();

  // Route by current page element
  if (document.getElementById('register-form')) {
    initAuthPage();
  } else if (document.getElementById('tasks-grid')) {
    initDashboard();
  } else if (document.body.dataset.taskType) {
    initDedicatedTaskPage(document.body.dataset.taskType);
  }
});
