'use strict';

/* ==========================================================================
   Rafeequl Hifz — shared mobile navigation
   5 tabs only: Home · Hifz · Review hub · Flashcards · More
   Everything else lives in the "More" bottom sheet.
   ========================================================================== */

(function () {
  const ICONS = {
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
    hifz: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    review: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    cards: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
    more: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle></svg>',
    tikrar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
    rabt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    kalimaat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><path d="M8 7h8M8 11h6"></path></svg>',
    murajaah: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    rub: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"></path></svg>',
    history: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
  };

  const MORE_PAGES = ['kalimaat.html', 'tikrar.html', 'rabt.html', 'murajaah.html', 'rub.html', 'history.html'];

  function currentPage() {
    const parts = location.pathname.split('/');
    const last = parts[parts.length - 1];
    return last || 'dashboard.html';
  }

  function t(key, fallback) {
    return window.I18N ? I18N.t(key) : fallback;
  }

  function build() {
    if (document.querySelector('.mobile-bottom-nav')) return;

    const page = currentPage();
    const isMorePage = MORE_PAGES.indexOf(page) !== -1;
    const active = {
      home: page === 'dashboard.html',
      hifz: page === 'hifz.html',
      review: page === 'review.html',
      cards: page === 'flashcards.html',
      more: isMorePage,
    };

    const nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', t('nav_quick', 'التنقل السريع'));
    nav.innerHTML = `
      <a href="dashboard.html" class="mobile-nav-link ${active.home ? 'active' : ''}" title="${t('nav_home', 'الرئيسية')}" data-i18n-title="nav_home">
        ${ICONS.home}<span data-i18n="nav_home">${t('nav_home', 'الرئيسية')}</span>
      </a>
      <a href="hifz.html" class="mobile-nav-link ${active.hifz ? 'active' : ''}" title="${t('nav_hifz', 'حفظ جديد')}" data-i18n-title="nav_hifz">
        ${ICONS.hifz}<span data-i18n="nav_hifz">${t('nav_hifz', 'حفظ جديد')}</span>
      </a>
      <a href="review.html" class="mobile-nav-link ${active.review ? 'active' : ''}" title="${t('nav_review', 'المراجعة')}" data-i18n-title="nav_review">
        ${ICONS.review}<span data-i18n="nav_review">${t('nav_review', 'المراجعة')}</span>
      </a>
      <a href="flashcards.html" class="mobile-nav-link ${active.cards ? 'active' : ''}" title="${t('nav_flashcards', 'البطاقات')}" data-i18n-title="nav_flashcards">
        ${ICONS.cards}<span data-i18n="nav_flashcards">${t('nav_flashcards', 'البطاقات')}</span>
      </a>
      <button type="button" class="mobile-nav-link ${active.more ? 'active' : ''}" id="nav-more-btn" aria-haspopup="dialog" aria-expanded="false" title="${t('nav_more', 'المزيد')}" data-i18n-title="nav_more">
        ${ICONS.more}<span data-i18n="nav_more">${t('nav_more', 'المزيد')}</span>
      </button>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'nav-sheet-overlay';
    overlay.id = 'nav-sheet-overlay';
    overlay.innerHTML = `
      <div class="nav-sheet" id="nav-sheet" role="dialog" aria-modal="true" aria-labelledby="nav-sheet-title">
        <div class="nav-sheet-handle" aria-hidden="true"></div>
        <div class="nav-sheet-head">
          <h3 id="nav-sheet-title" data-i18n="nav_more_title">${t('nav_more_title', 'المزيد')}</h3>
          <button type="button" class="nav-sheet-close" id="nav-sheet-close" aria-label="${t('nav_close', 'إغلاق')}">✕</button>
        </div>
        <div class="nav-sheet-grid">
          <a href="tikrar.html" class="nav-sheet-item ${page === 'tikrar.html' ? 'is-active' : ''}">${ICONS.tikrar}<span><span data-i18n="nav_tikrar">${t('nav_tikrar', 'تكرار الأمس')}</span><small data-i18n="nav_tikrar_sub">${t('nav_tikrar_sub', 'تثبيت حفظ الأمس')}</small></span></a>
          <a href="rabt.html" class="nav-sheet-item ${page === 'rabt.html' ? 'is-active' : ''}">${ICONS.rabt}<span><span data-i18n="nav_rabt">${t('nav_rabt', 'الربط')}</span><small data-i18n="nav_rabt_sub">${t('nav_rabt_sub', 'ربط الصفحات المحفوظة')}</small></span></a>
          <a href="kalimaat.html" class="nav-sheet-item ${page === 'kalimaat.html' ? 'is-active' : ''}">${ICONS.kalimaat}<span><span data-i18n="nav_kalimaat">${t('nav_kalimaat', 'معاني الكلمات')}</span><small data-i18n="nav_kalimaat_sub">${t('nav_kalimaat_sub', 'كلمة حتى ١٠٠٠ تكرار')}</small></span></a>
          <a href="rub.html" class="nav-sheet-item ${page === 'rub.html' ? 'is-active' : ''}">${ICONS.rub}<span><span data-i18n="nav_rub">${t('nav_rub', 'تثبيت الربع')}</span><small data-i18n="nav_rub_sub">${t('nav_rub_sub', 'ربع واحد كل يوم')}</small></span></a>
          <a href="murajaah.html" class="nav-sheet-item ${page === 'murajaah.html' ? 'is-active' : ''}">${ICONS.murajaah}<span><span data-i18n="nav_murajaah">${t('nav_murajaah', 'المراجعة')}</span><small data-i18n="nav_murajaah_sub">${t('nav_murajaah_sub', 'الختمة الدورية')}</small></span></a>
          <div class="nav-sheet-sep" aria-hidden="true"></div>
          <a href="history.html" class="nav-sheet-item ${page === 'history.html' ? 'is-active' : ''}">${ICONS.history}<span><span data-i18n="nav_history">${t('nav_history', 'السجل')}</span><small data-i18n="nav_history_sub">${t('nav_history_sub', 'سجل الأخطاء والإتقان')}</small></span></a>
        </div>
      </div>
    `;

    document.body.appendChild(nav);
    document.body.appendChild(overlay);

    overlay.inert = true;
    overlay.setAttribute('aria-hidden', 'true');

    const moreBtn = document.getElementById('nav-more-btn');
    const closeBtn = document.getElementById('nav-sheet-close');
    const sheet = document.getElementById('nav-sheet');

    function openSheet() {
      overlay.inert = false;
      overlay.removeAttribute('aria-hidden');
      overlay.classList.add('is-open');
      sheet.classList.add('is-open');
      document.body.classList.add('nav-sheet-open');
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
      if (closeBtn) closeBtn.focus();
    }

    function closeSheet() {
      overlay.classList.remove('is-open');
      sheet.classList.remove('is-open');
      document.body.classList.remove('nav-sheet-open');
      overlay.inert = true;
      overlay.setAttribute('aria-hidden', 'true');
      if (moreBtn) {
        moreBtn.setAttribute('aria-expanded', 'false');
        moreBtn.focus();
      }
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', (event) => {
        event.preventDefault();
        openSheet();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSheet();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
        closeSheet();
      }
    });

    // Labels carry data-i18n attributes, so I18N.apply() translates them
    // automatically on every language switch — no listener needed here.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
