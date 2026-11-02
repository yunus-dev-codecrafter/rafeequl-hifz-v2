'use strict';

/* ==========================================================================
   Rafeequl Hifz — Native Mushaf Reader (web/mushaf.html)
   --------------------------------------------------------------------------
   Renders a page of the Madinah Mushaf from web/data/quran-uthmani.json using
   the 604-page verse map already shipped with the app. No page images and no
   new API: every ayah, surah band, juz/hizb label and basmala is drawn from
   data the project already has.

   Opening page priority:
     ?page=N  →  last-read bookmark  →  current_hifz_page  →  page 1
   ========================================================================== */

(function () {
  const TOTAL_PAGES = 604;
  const LAST_PAGE_KEY = 'rh_mushaf_last_page';
  const FONT_SCALE_KEY = 'rh_mushaf_font_scale';
  const MIN_FONT_SCALE = 0.8;
  const MAX_FONT_SCALE = 1.8;
  const FONT_STEP = 0.1;

  const state = {
    quran: null,
    meta: null,
    basmala: '',
    page: 1,
    rendered: false,
    requestedPage: 1,
    user: null,
    authPromise: null,
    autoJumpAllowed: false,
    fontScale: 1,
    active: null,
    playMode: null, // 'page' | 'ayah' | null
    playlist: [],
    playIndex: -1,
    audio: null,
    noteToken: 0,
    surahStarts: {},
    juzStarts: {},
  };

  const els = {};

  /* ---------------- Small helpers ---------------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function toArabicDigits(value) {
    return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  }

  function isEnglish() {
    return window.I18N && I18N.lang === 'en';
  }

  function t(key, params) {
    return window.I18N ? I18N.t(key, params) : key;
  }

  function validPage(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 1 && n <= TOTAL_PAGES ? n : null;
  }

  function clampPage(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(TOTAL_PAGES, Math.max(1, n));
  }

  function recitationUrl(surah, ayah) {
    const pad = (n) => String(n).padStart(3, '0');
    return 'https://everyayah.com/data/Alafasy_128kbps/' + pad(surah) + pad(ayah) + '.mp3';
  }

  function getUrlPage() {
    try {
      return clampPage(new URLSearchParams(location.search).get('page'));
    } catch (e) {
      return null;
    }
  }

  function getBookmark() {
    try {
      return clampPage(localStorage.getItem(LAST_PAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function saveBookmark(page) {
    try {
      localStorage.setItem(LAST_PAGE_KEY, String(page));
    } catch (e) {}
  }

  function getAyahText(surah, ayah) {
    if (!state.quran) return '';
    const list = state.quran[String(surah)];
    if (!Array.isArray(list)) return '';
    return list[ayah - 1] || '';
  }

  function surahName(id) {
    return window.I18N ? I18N.getSurahName(id) : String(id);
  }

  function showStatus() {
    if (els.status) els.status.classList.remove('hidden');
    if (els.error) els.error.classList.add('hidden');
    if (els.page) els.page.classList.add('hidden');
  }

  function hideStatus() {
    if (els.status) els.status.classList.add('hidden');
    if (els.error) els.error.classList.add('hidden');
  }

  function showError() {
    if (els.status) els.status.classList.add('hidden');
    if (els.page) els.page.classList.add('hidden');
    if (els.error) els.error.classList.remove('hidden');
  }

  /* ---------------- Data loading ---------------- */

  async function loadData() {
    const [quranRes, metaRes] = await Promise.all([
      fetch('data/quran-uthmani.json'),
      fetch('data/mushaf_meta.json'),
    ]);

    if (!quranRes.ok) throw new Error('quran-uthmani.json: HTTP ' + quranRes.status);
    if (!metaRes.ok) throw new Error('mushaf_meta.json: HTTP ' + metaRes.status);

    const quran = await quranRes.json();
    const meta = await metaRes.json();

    if (!quran || typeof quran !== 'object') throw new Error('Invalid Qur’an text bundle');
    if (!meta || !Array.isArray(meta.pages) || meta.pages.length !== TOTAL_PAGES) {
      throw new Error('Invalid mushaf metadata');
    }

    state.quran = quran;
    state.meta = meta.pages;
    state.basmala = (Array.isArray(quran['1']) && quran['1'][0]) || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
  }

  async function loadAuth() {
    try {
      const res = await API.call('auth/me.php');
      state.user = (res && res.user) || null;
    } catch (e) {
      state.user = null;
    }
    applyAuthUI();
    if (state.rendered) loadPageNote(state.page);
    return state.user;
  }

  function applyAuthUI() {
    const myPageBtn = els.myPage;
    const current = state.user && validPage(state.user.current_hifz_page);
    if (myPageBtn) myPageBtn.classList.toggle('hidden', !current);

    if (els.ayahMistake) {
      els.ayahMistake.classList.toggle('hidden', !state.user);
    }
  }

  /* ---------------- Surah / juz jump tables ---------------- */

  function buildJumpTables() {
    const surahStarts = {};
    for (let page = 1; page <= TOTAL_PAGES; page++) {
      const sections = getPageVerseSections(page);
      for (const section of sections) {
        if (section.fromAyah === 1 && surahStarts[section.surahId] === undefined) {
          surahStarts[section.surahId] = page;
        }
      }
    }
    state.surahStarts = surahStarts;

    const juzStarts = {};
    state.meta.forEach((row, index) => {
      const juz = row && row[0];
      if (juz && juzStarts[juz] === undefined) juzStarts[juz] = index + 1;
    });
    state.juzStarts = juzStarts;
  }

  function buildJumps() {
    if (!els.surahJump || !els.juzJump) return;

    const surahList = window.SURAHS_DATA || [];
    els.surahJump.innerHTML =
      '<option value="">' + esc(t('mushaf_jump_surah')) + '</option>' +
      surahList.map((s) => {
        const labelNumber = isEnglish() ? s.id : toArabicDigits(s.id);
        return '<option value="' + s.id + '">' + labelNumber + '. ' + esc(surahName(s.id)) + '</option>';
      }).join('');

    let juzOptions = '<option value="">' + esc(t('mushaf_jump_juz')) + '</option>';
    for (let juz = 1; juz <= 30; juz++) {
      const labelNumber = isEnglish() ? juz : toArabicDigits(juz);
      juzOptions += '<option value="' + juz + '">' + esc(t('mushaf_juz_label', { n: labelNumber })) + '</option>';
    }
    els.juzJump.innerHTML = juzOptions;
  }

  /* ---------------- Rendering ---------------- */

  function renderPage(page) {
    if (!state.quran || !state.meta) return;

    const sections = getPageVerseSections(page);
    if (!sections.length) return;

    const meta = state.meta[page - 1] || [null, null, null];
    const juz = meta[0];
    const hizb = meta[1];
    const rub = meta[2];

    const names = sections.map((s) => surahName(s.surahId)).join(' • ');
    const lang = isEnglish() ? 'en' : 'ar';
    const num = (value) => (lang === 'ar' ? toArabicDigits(value) : String(value));

    let body = '';
    sections.forEach((section) => {
      const isSurahStart = section.fromAyah === 1;
      body += '<section class="mushaf-surah" data-surah="' + section.surahId + '">';

      if (isSurahStart) {
        body +=
          '<div class="mushaf-surah-band">' +
            '<span class="mushaf-surah-name">' +
              esc(t('mushaf_surah_word')) + ' ' + esc(surahName(section.surahId)) +
            '</span>' +
            '<span class="mushaf-surah-meta">' +
              esc(t('mushaf_verses_count', { n: num(section.totalAyahs) })) +
            '</span>' +
          '</div>';

        // Al-Fatiha's 1:1 *is* the basmala, and At-Tawbah has none.
        if (section.surahId !== 1 && section.surahId !== 9) {
          body += '<div class="mushaf-basmala">' + esc(state.basmala) + '</div>';
        }
      }

      body += '<p class="mushaf-ayat">';
      for (let ayah = section.fromAyah; ayah <= section.toAyah; ayah++) {
        const text = getAyahText(section.surahId, ayah);
        const displayNumber = lang === 'ar' ? toArabicDigits(ayah) : String(ayah);
        const label = t('mushaf_ayah_ref', { surah: surahName(section.surahId), ayah: displayNumber });
        body +=
          '<span class="mushaf-ayah" role="button" tabindex="0"' +
            ' data-surah="' + section.surahId + '" data-ayah="' + ayah + '"' +
            ' aria-label="' + esc(label) + '">' +
            esc(text) +
            ' <span class="mushaf-ayah-num" aria-hidden="true">' + toArabicDigits(ayah) + '</span>' +
          '</span> ';
      }
      body += '</p></section>';
    });

    const head =
      '<div class="mushaf-page-head">' +
        '<span class="mushaf-page-no" title="' + esc(t('mushaf_page_ref', { n: num(page) })) + '">' +
          toArabicDigits(page) +
        '</span>' +
        '<span class="mushaf-page-surahs">' + esc(names) + '</span>' +
        '<span class="mushaf-page-meta">' +
          (juz ? esc(t('mushaf_juz_label', { n: num(juz) })) : '') +
        '</span>' +
      '</div>';

    const foot =
      '<div class="mushaf-page-foot">' +
        '<span>' + (hizb ? esc(t('mushaf_hizb_label', { n: num(hizb) })) : '') + '</span>' +
        '<span class="mushaf-foot-page">' + toArabicDigits(page) + '</span>' +
        '<span>' + (rub ? esc(t('mushaf_rub_label', { n: num(rub) })) : '') + '</span>' +
      '</div>';

    els.page.innerHTML = head + '<div class="mushaf-page-body">' + body + '</div>' + foot;
    els.page.classList.remove('hidden');
    hideStatus();

    state.page = page;
    state.rendered = true;

    if (els.pageInput) els.pageInput.value = String(page);
    if (els.prev) els.prev.disabled = page <= 1;
    if (els.next) els.next.disabled = page >= TOTAL_PAGES;

    saveBookmark(page);
  }

  function updateUrl(page) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('page', String(page));
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  function goToPage(page, options) {
    const opts = options || {};
    const target = clampPage(page);
    if (target === null) return;

    if (opts.user !== false) state.autoJumpAllowed = false;
    if (!state.quran) {
      state.requestedPage = target;
      return;
    }

    if (target === state.page && state.rendered) {
      updateUrl(target);
      if (els.pageInput) els.pageInput.value = String(target);
      return;
    }

    stopAudio();
    hideAyahBar();
    renderPage(target);
    updateUrl(target);
    loadPageNote(target);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- Page note (read-only) ---------------- */

  async function loadPageNote(page) {
    if (!els.note || !els.noteBody) return;

    const token = ++state.noteToken;
    els.note.classList.add('hidden');
    els.note.classList.remove('is-open');
    els.noteBody.textContent = '';
    if (els.noteToggle) els.noteToggle.setAttribute('aria-expanded', 'false');

    if (!state.user) return;

    try {
      const res = await API.call('notes/get_page_notes.php?page_number=' + page);
      if (token !== state.noteToken || state.page !== page) return;
      if (!res || !res.available) return;

      const note = typeof res.note === 'string' ? res.note.trim() : '';
      if (!note) return;

      els.noteBody.textContent = note;
      els.note.classList.remove('hidden');
    } catch (e) {
      // Logged-out / offline / unmigrated notes table: silently hide the card.
    }
  }

  /* ---------------- Ayah selection & actions ---------------- */

  function highlightAyah(surah, ayah) {
    if (!els.page) return;
    els.page.querySelectorAll('.mushaf-ayah.is-active').forEach((el) => el.classList.remove('is-active'));
    const target = els.page.querySelector(
      '.mushaf-ayah[data-surah="' + surah + '"][data-ayah="' + ayah + '"]'
    );
    if (target) target.classList.add('is-active');
  }

  function clearActiveAyah() {
    state.active = null;
    if (els.page) {
      els.page.querySelectorAll('.mushaf-ayah.is-active').forEach((el) => el.classList.remove('is-active'));
    }
  }

  function updateAyahBarText() {
    if (!els.ayahRef) return;
    if (!state.active) {
      els.ayahRef.textContent = '';
      return;
    }
    const displayNumber = isEnglish() ? String(state.active.ayah) : toArabicDigits(state.active.ayah);
    els.ayahRef.textContent = t('mushaf_ayah_ref', {
      surah: surahName(state.active.surah),
      ayah: displayNumber,
    });
  }

  function updateAyahPlayButton() {
    if (!els.ayahPlay) return;
    const playing = !!state.playMode && !!state.active;
    els.ayahPlay.textContent = playing ? '⏸' : '▶';
    els.ayahPlay.setAttribute('aria-label', t(playing ? 'mushaf_stop_ayah' : 'mushaf_play_ayah'));
    els.ayahPlay.title = t(playing ? 'mushaf_stop_ayah' : 'mushaf_play_ayah');
  }

  function selectAyah(surah, ayah, options) {
    const opts = options || {};
    state.active = { surah, ayah };
    highlightAyah(surah, ayah);
    updateAyahBarText();
    updateAyahPlayButton();

    if (els.ayahBar) els.ayahBar.classList.remove('hidden');
    if (els.ayahMistake) els.ayahMistake.classList.toggle('hidden', !state.user);

    if (opts.scroll) {
      const target = els.page && els.page.querySelector(
        '.mushaf-ayah[data-surah="' + surah + '"][data-ayah="' + ayah + '"]'
      );
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function hideAyahBar() {
    if (els.ayahBar) els.ayahBar.classList.add('hidden');
    if (!state.playMode) clearActiveAyah();
    updateAyahBarText();
    updateAyahPlayButton();
  }

  /* ---------------- Audio ---------------- */

  function ensureAudio() {
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = 'none';
    }
    return state.audio;
  }

  function updatePagePlayButton(playing) {
    if (!els.playPage) return;
    const label = t(playing ? 'mushaf_stop_page' : 'mushaf_play_page');
    els.playPage.textContent = label;
    els.playPage.classList.toggle('is-playing', playing);
    els.playPage.setAttribute('aria-label', label);
    els.playPage.title = label;
  }

  function stopAudio() {
    if (state.audio) {
      state.audio.onended = null;
      state.audio.onerror = null;
      try { state.audio.pause(); } catch (e) {}
    }
    state.playMode = null;
    state.playlist = [];
    state.playIndex = -1;
    updatePagePlayButton(false);
    updateAyahPlayButton();
    clearActiveAyah();
  }

  function playCurrent() {
    const item = state.playlist[state.playIndex];
    if (!item) {
      stopAudio();
      return;
    }

    if (state.playMode === 'page') {
      // Keep the page clean while the whole page plays: highlight the current
      // ayah without opening the per-ayah action bar.
      state.active = { surah: item.surah, ayah: item.ayah };
      highlightAyah(item.surah, item.ayah);
      updateAyahBarText();
      updateAyahPlayButton();
    } else {
      selectAyah(item.surah, item.ayah, { scroll: false });
    }

    const audio = ensureAudio();
    audio.onended = () => {
      state.playIndex += 1;
      if (state.playIndex < state.playlist.length) {
        playCurrent();
      } else {
        stopAudio();
      }
    };
    audio.onerror = () => {
      showToast(t('mushaf_audio_error'), true);
      stopAudio();
    };

    audio.src = recitationUrl(item.surah, item.ayah);
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        showToast(t('mushaf_audio_error'), true);
        stopAudio();
      });
    }
  }

  function playPage() {
    if (!state.quran || !state.rendered) return;
    stopAudio();
    hideAyahBar();

    const playlist = [];
    getPageVerseSections(state.page).forEach((section) => {
      for (let ayah = section.fromAyah; ayah <= section.toAyah; ayah++) {
        playlist.push({ surah: section.surahId, ayah });
      }
    });
    if (!playlist.length) return;

    state.playMode = 'page';
    state.playlist = playlist;
    state.playIndex = 0;
    updatePagePlayButton(true);
    playCurrent();
  }

  function playAyah(surah, ayah) {
    const same = state.playMode && state.active &&
      state.active.surah === surah && state.active.ayah === ayah;

    stopAudio();
    if (same) {
      hideAyahBar();
      return;
    }

    state.playMode = 'ayah';
    state.playlist = [{ surah, ayah }];
    state.playIndex = 0;
    updatePagePlayButton(false);
    playCurrent();
  }

  /* ---------------- Copy & mistake logging ---------------- */

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // Fall through to the legacy path.
    }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function copyActiveAyah() {
    if (!state.active) return;
    const text = getAyahText(state.active.surah, state.active.ayah);
    if (!text) return;

    const displayNumber = isEnglish() ? String(state.active.ayah) : toArabicDigits(state.active.ayah);
    const reference = t('mushaf_ayah_ref', {
      surah: surahName(state.active.surah),
      ayah: displayNumber,
    });
    const ok = await copyText(text + '\n' + reference);
    showToast(t(ok ? 'mushaf_copied' : 'mushaf_copy_failed'), !ok);
  }

  function logActiveMistake() {
    const active = state.active;
    if (!active) return;
    if (!state.user) {
      showToast(t('mushaf_login_required'), true);
      return;
    }
    stopAudio();
    hideAyahBar();
    if (typeof openMistakeModalForAyah === 'function') {
      openMistakeModalForAyah(state.page, active.surah, active.ayah, 'AYAH_MISTAKE');
    }
  }

  /* ---------------- Font scale ---------------- */

  function loadFontScale() {
    try {
      const stored = parseFloat(localStorage.getItem(FONT_SCALE_KEY));
      if (Number.isFinite(stored)) {
        return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, stored));
      }
    } catch (e) {}
    return 1;
  }

  function applyFontScale(scale) {
    const value = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale));
    state.fontScale = Math.round(value * 10) / 10;
    document.documentElement.style.setProperty('--mushaf-font-scale', String(state.fontScale));
    try { localStorage.setItem(FONT_SCALE_KEY, String(state.fontScale)); } catch (e) {}
  }

  /* ---------------- Language changes ---------------- */

  function updateDirectionalIcons() {
    const rtl = !isEnglish();
    if (els.back) {
      const glyph = els.back.querySelector('span');
      if (glyph) glyph.textContent = rtl ? '→' : '←';
    }
    if (els.prev) els.prev.textContent = rtl ? '›' : '‹';
    if (els.next) els.next.textContent = rtl ? '‹' : '›';
  }

  function onLanguageChange() {
    buildJumps();
    updateDirectionalIcons();
    if (state.rendered) {
      const scrollY = window.scrollY;
      stopAudio();
      renderPage(state.page);
      hideAyahBar();
      window.scrollTo(0, scrollY);
    }
    updatePagePlayButton(state.playMode === 'page');
    updateAyahBarText();
    if (typeof updateThemeIcon === 'function') updateThemeIcon();
  }

  /* ---------------- Initial page resolution ---------------- */

  async function resolveInitialPage(urlPage, bookmark) {
    if (urlPage) return urlPage;
    if (bookmark) return bookmark;

    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
    const user = await Promise.race([state.authPromise, timeout]);

    const current = user && validPage(user.current_hifz_page);
    if (current) return current;

    // The auth call may still finish after the timeout; jump then, unless the
    // reader has already been used.
    state.autoJumpAllowed = true;
    return 1;
  }

  /* ---------------- UI wiring ---------------- */

  function bindUI() {
    if (els.back) {
      els.back.addEventListener('click', () => {
        const sameOriginReferrer = document.referrer && document.referrer.indexOf(location.origin) === 0;
        if (sameOriginReferrer && history.length > 1) {
          history.back();
        } else {
          location.href = 'dashboard.html';
        }
      });
    }

    if (els.prev) {
      els.prev.addEventListener('click', () => goToPage(state.page - 1));
    }
    if (els.next) {
      els.next.addEventListener('click', () => goToPage(state.page + 1));
    }

    if (els.pageInput) {
      const commit = () => {
        const target = clampPage(els.pageInput.value);
        if (target === null) {
          els.pageInput.value = String(state.page);
          return;
        }
        goToPage(target);
      };
      els.pageInput.addEventListener('change', commit);
      els.pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          els.pageInput.blur();
          commit();
        }
      });
    }

    if (els.surahJump) {
      els.surahJump.addEventListener('change', () => {
        const id = parseInt(els.surahJump.value, 10);
        els.surahJump.value = '';
        if (id && state.surahStarts[id]) goToPage(state.surahStarts[id]);
      });
    }

    if (els.juzJump) {
      els.juzJump.addEventListener('change', () => {
        const juz = parseInt(els.juzJump.value, 10);
        els.juzJump.value = '';
        if (juz && state.juzStarts[juz]) goToPage(state.juzStarts[juz]);
      });
    }

    if (els.fontDec) {
      els.fontDec.addEventListener('click', () => applyFontScale(state.fontScale - FONT_STEP));
    }
    if (els.fontInc) {
      els.fontInc.addEventListener('click', () => applyFontScale(state.fontScale + FONT_STEP));
    }

    if (els.playPage) {
      els.playPage.addEventListener('click', () => {
        if (state.playMode === 'page') stopAudio();
        else playPage();
      });
    }

    if (els.myPage) {
      els.myPage.addEventListener('click', () => {
        const current = state.user && validPage(state.user.current_hifz_page);
        if (current) goToPage(current);
      });
    }

    if (els.retry) {
      els.retry.addEventListener('click', retryLoad);
    }

    if (els.noteToggle) {
      els.noteToggle.addEventListener('click', () => {
        if (!els.note) return;
        const open = els.note.classList.toggle('is-open');
        els.noteToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    // Ayah bar actions
    if (els.ayahPlay) {
      els.ayahPlay.addEventListener('click', () => {
        if (!state.active) return;
        playAyah(state.active.surah, state.active.ayah);
      });
    }
    if (els.ayahCopy) {
      els.ayahCopy.addEventListener('click', copyActiveAyah);
    }
    if (els.ayahMistake) {
      els.ayahMistake.addEventListener('click', logActiveMistake);
    }
    if (els.ayahClose) {
      els.ayahClose.addEventListener('click', hideAyahBar);
    }

    // Click / keyboard on a verse
    if (els.page) {
      els.page.addEventListener('click', (e) => {
        const ayah = e.target.closest ? e.target.closest('.mushaf-ayah') : null;
        if (!ayah) return;
        selectAyah(parseInt(ayah.dataset.surah, 10), parseInt(ayah.dataset.ayah, 10), { scroll: false });
      });

      els.page.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const ayah = e.target.closest ? e.target.closest('.mushaf-ayah') : null;
        if (!ayah) return;
        e.preventDefault();
        selectAyah(parseInt(ayah.dataset.surah, 10), parseInt(ayah.dataset.ayah, 10), { scroll: false });
      });
    }

    // Click outside the bar / verse closes the bar.
    document.addEventListener('click', (e) => {
      if (!els.ayahBar || els.ayahBar.classList.contains('hidden')) return;
      if (e.target.closest && (e.target.closest('#mushaf-ayah-bar') || e.target.closest('.mushaf-ayah'))) return;
      hideAyahBar();
    });

    // Keyboard page navigation (same convention as the rest of the app:
    // ArrowLeft = next page in RTL, ArrowRight = previous page).
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

      const mistakeModal = document.getElementById('mistake-modal');
      if (mistakeModal && !mistakeModal.classList.contains('hidden')) return;

      if (e.key === 'Escape') {
        if (els.ayahBar && !els.ayahBar.classList.contains('hidden')) {
          hideAyahBar();
          return;
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(state.page + 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(state.page - 1);
      }
    });
  }

  /* ---------------- Boot ---------------- */

  function cacheElements() {
    els.back = document.getElementById('mushaf-back');
    els.myPage = document.getElementById('mushaf-my-page');
    els.prev = document.getElementById('mushaf-prev');
    els.next = document.getElementById('mushaf-next');
    els.pageInput = document.getElementById('mushaf-page-input');
    els.surahJump = document.getElementById('mushaf-surah-jump');
    els.juzJump = document.getElementById('mushaf-juz-jump');
    els.fontDec = document.getElementById('mushaf-font-dec');
    els.fontInc = document.getElementById('mushaf-font-inc');
    els.playPage = document.getElementById('mushaf-play-page');
    els.status = document.getElementById('mushaf-status');
    els.page = document.getElementById('mushaf-page');
    els.error = document.getElementById('mushaf-error');
    els.retry = document.getElementById('mushaf-retry');
    els.note = document.getElementById('mushaf-note');
    els.noteToggle = document.getElementById('mushaf-note-toggle');
    els.noteBody = document.getElementById('mushaf-note-body');
    els.ayahBar = document.getElementById('mushaf-ayah-bar');
    els.ayahRef = document.getElementById('mushaf-ayah-ref');
    els.ayahPlay = document.getElementById('mushaf-ayah-play');
    els.ayahCopy = document.getElementById('mushaf-ayah-copy');
    els.ayahMistake = document.getElementById('mushaf-ayah-mistake');
    els.ayahClose = document.getElementById('mushaf-ayah-close');
  }

  function cleanupFocusMode() {
    document.body.classList.remove('focus-mode');
    const exit = document.getElementById('focus-exit');
    if (exit) exit.remove();
  }

  async function retryLoad() {
    showStatus();
    try {
      await loadData();
      buildJumpTables();
      buildJumps();
      const page = clampPage(state.requestedPage) || 1;
      renderPage(page);
      updateUrl(page);
      loadPageNote(page);
    } catch (e) {
      showError();
    }
  }

  async function boot() {
    cacheElements();
    cleanupFocusMode();
    updateDirectionalIcons();

    applyFontScale(loadFontScale());
    bindUI();

    if (typeof initMistakeModal === 'function') {
      try { initMistakeModal(); } catch (e) { console.warn('[Mushaf] mistake modal init failed', e); }
    }
    if (window.I18N && typeof I18N.onChange === 'function') {
      I18N.onChange(onLanguageChange);
    }

    const urlPage = getUrlPage();
    const bookmark = getBookmark();
    state.requestedPage = urlPage || bookmark || 1;

    state.authPromise = loadAuth();
    showStatus();

    try {
      await loadData();
      buildJumpTables();
      buildJumps();

      const page = await resolveInitialPage(urlPage, bookmark);
      state.requestedPage = page;
      renderPage(page);
      updateUrl(page);
      loadPageNote(page);
    } catch (e) {
      console.warn('[Mushaf] load failed', e);
      showError();
    }

    // If auth was slow, jump to the user's current page once it arrives.
    state.authPromise.then((user) => {
      if (!state.autoJumpAllowed || !state.rendered) return;
      const current = user && validPage(user.current_hifz_page);
      if (current && current !== state.page) {
        state.autoJumpAllowed = false;
        goToPage(current, { user: false });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
