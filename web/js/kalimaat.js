'use strict';

/* ==========================================================================
   Rafeequl Hifz - معاني كلمات القرآن
   Dedicated page + dashboard summary. The entry gate lives in entry-gate.js.
   ========================================================================== */

(function () {
  const state = {
    entry: null,
    zone: null,
    view: 'study',
    juz: null,
    page: null,
    status: '',
    q: '',
    list: null,
    test: null,
    testSession: null,
    testResult: null,
    adding: false,
    loading: false,
    searchTimer: null,
  };

  const $ = (id) => document.getElementById(id);

  function t(key, fallback, params) {
    try {
      if (window.I18N && typeof I18N.t === 'function') {
        const value = I18N.t(key, params);
        if (value && value !== key) return value;
      }
    } catch (e) {}
    return fallback;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmt(value) {
    const n = Number(value) || 0;
    try {
      return n.toLocaleString(window.I18N && I18N.lang === 'en' ? 'en-US' : 'ar-EG');
    } catch (e) {
      return String(n);
    }
  }

  function surahName(id) {
    try {
      if (window.I18N && typeof I18N.getSurahName === 'function') {
        return I18N.getSurahName(Number(id));
      }
    } catch (e) {}
    return t('kalimaat_surah', 'سورة') + ' ' + id;
  }

  /**
   * One test session per browser tab/app session. The API counts only the first
   * correct answer per word per session, so mastery needs three separate app
   * sessions rather than three clicks in one sitting.
   */
  function appTestSession() {
    const key = 'rh_kalimaat_test_session';
    let session = '';
    try {
      session = sessionStorage.getItem(key) || '';
    } catch (e) {}
    if (/^[a-f0-9]{32}$/i.test(session)) return session;

    const bytes = new Uint8Array(16);
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
    } catch (e) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    session = Array.prototype.map.call(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(key, session); } catch (e) {}
    return session;
  }

  function toast(message) {
    if (!message) return;
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else {
      console.log('[Kalimaat]', message);
    }
  }

  async function api(path, options) {
    const opts = Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({}, opts.headers, { 'Content-Type': 'application/json' });
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = { success: false, error: 'Invalid server response.' };
    }
    if (res.status === 401) {
      window.location.href = 'index.html';
      throw new Error('Unauthorized');
    }
    return { ok: res.ok, status: res.status, data };
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function statusText(status) {
    const key = 'kalimaat_status_' + String(status || '').toLowerCase();
    const fallbacks = {
      new: 'جديدة',
      locked: 'مثبتة',
      ready: 'جاهزة للاختبار',
      mastered: 'متقنة',
    };
    return t(key, fallbacks[String(status || '').toLowerCase()] || status || '');
  }

  /* ------------------------------------------------------------------------
     Dashboard summary
     ------------------------------------------------------------------------ */

  async function refreshDashboard() {
    if (!$('kalimaat-dashboard-card')) return;
    try {
      const { data } = await api('api/kalimaat/get_entry.php', { method: 'GET' });
      if (data && data.success) renderDashboard(data);
    } catch (e) {
      // Dashboard app.js already handles auth/network states.
    }
  }

  function renderDashboard(data) {
    const card = $('kalimaat-dashboard-card');
    if (!card) return;
    const k = data.kalimaat || {};
    const stats = k.stats || {};
    const locked = k.locked || null;
    const zone = data.zone || {};

    const count = $('kalimaat-dash-count');
    const sub = $('kalimaat-dash-sub');
    const bar = $('kalimaat-dash-progress');

    if (locked) {
      if (count) count.textContent = `${fmt(locked.repeat_count)} / ${fmt(k.target || 1000)}`;
      if (sub) sub.textContent = `${locked.text} — ${locked.meaning}`;
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(locked.progress_percent) || 0))}%`;
      card.classList.remove('is-empty');
    } else if (!k.catalog_ok) {
      if (count) count.textContent = '—';
      if (sub) sub.textContent = t('kalimaat_catalog_missing', 'محتوى الكلمات غير مثبت على الخادم.');
      if (bar) bar.style.width = '0%';
    } else if (zone.end < zone.start) {
      if (count) count.textContent = '—';
      if (sub) sub.textContent = t('kalimaat_zone_missing', 'حدّد صفحة الحفظ الحالية أولًا لتبدأ.');
      if (bar) bar.style.width = '0%';
    } else {
      if (count) count.textContent = `${fmt(stats.ready_words)} ${t('kalimaat_ready_short', 'جاهزة')}`;
      if (sub) sub.textContent = t('kalimaat_no_locked_short', 'اختر كلمة جديدة من صفحة الكلمات.');
      if (bar) bar.style.width = `${stats.ready_words > 0 ? '100' : '0'}%`;
    }
  }

  /* ------------------------------------------------------------------------
     Page: header + locked card
     ------------------------------------------------------------------------ */

  async function initPage() {
    if (!$('kalimaat-locked')) return;
    bindTabs();
    bindBrowser();
    bindLocked();
    bindTest();

    try {
      const { data } = await api('api/kalimaat/get_entry.php', { method: 'GET' });
      if (!data || !data.success) {
        setText('kalimaat-zone-badge', t('kalimaat_load_error', 'تعذر تحميل بيانات الكلمات.'));
        return;
      }
      state.entry = data;
      state.zone = data.zone || null;
      renderHeader();
      renderLocked();
      populateJuz();
      if (state.juz == null && data.kalimaat && data.kalimaat.juz_counts) {
        const keys = Object.keys(data.kalimaat.juz_counts).map(Number).sort((a, b) => a - b);
        state.juz = keys.length ? keys[0] : null;
      }
      if (location.hash === '#test') switchView('test');
      else await loadList();
    } catch (e) {
      setText('kalimaat-zone-badge', t('kalimaat_load_error', 'تعذر تحميل بيانات الكلمات.'));
    }
  }

  function renderHeader() {
    const k = (state.entry && state.entry.kalimaat) || {};
    const stats = k.stats || {};
    const zone = state.zone || {};

    setText(
      'kalimaat-zone-badge',
      zone.end >= zone.start
        ? t('kalimaat_zone_value', 'نطاق الحفظ: {start}–{end}', { start: fmt(zone.start), end: fmt(zone.end) })
        : t('kalimaat_zone_none', 'لم تحدد نطاق الحفظ')
    );
    setText('kalimaat-stat-locked', fmt(stats.locked_words));
    setText('kalimaat-stat-ready', fmt(stats.ready_words));
    setText('kalimaat-stat-mastered', fmt(stats.mastered_words));
    setText('kalimaat-stat-total', fmt(stats.total_repetitions));
  }

  function renderLocked() {
    const box = $('kalimaat-locked');
    if (!box) return;
    const k = (state.entry && state.entry.kalimaat) || {};
    const word = k.locked || null;
    const target = Number(k.target) || 1000;

    setText('kalimaat-locked-counter', word
      ? `${fmt(word.repeat_count)} / ${fmt(target)}`
      : `${fmt((k.stats || {}).locked_words)} / ${fmt((k.stats || {}).locked_words)}`);

    if (!word) {
      const reason = k.reason || '';
      const title = reason === 'NO_ZONE'
        ? t('kalimaat_no_zone_title', 'حدّد نطاق حفظك أولًا')
        : reason === 'ALL_WORDS_STARTED'
          ? t('kalimaat_all_started_title', 'كل الكلمات بدأت بالفعل')
          : t('kalimaat_no_locked_title', 'لا توجد كلمة مثبتة الآن');
      const desc = reason === 'NO_ZONE'
        ? t('kalimaat_no_zone_desc', 'اذهب إلى دفتر اليوم وحدّد صفحة الحفظ الحالية، ثم عد إلى هنا.')
        : reason === 'ALL_WORDS_STARTED'
          ? t('kalimaat_all_started_desc', 'أكمل الكلمات المثبتة أو ابدأ الاختبار للكلمات الجاهزة.')
          : t('kalimaat_no_locked_desc', 'اختر كلمة من القائمة بالأسفل لتثبيتها والبدء في التكرار.');

      box.innerHTML = `
        <div class="kalimaat-empty">
          <div class="kalimaat-empty-icon" aria-hidden="true">📖</div>
          <strong>${esc(title)}</strong>
          <p>${esc(desc)}</p>
          ${k.test_pool > 0 ? `<button type="button" class="btn btn-primary" id="kalimaat-empty-test" style="margin-top:0.8rem;">${esc(t('kalimaat_go_test', 'اذهب إلى الاختبار'))}</button>` : ''}
        </div>`;
      const testBtn = $('kalimaat-empty-test');
      if (testBtn) testBtn.addEventListener('click', () => switchView('test'));
      return;
    }

    box.innerHTML = `
      <div class="entry-gate-word-card" dir="rtl">
        <div class="entry-gate-word">${esc(word.text)}</div>
        <div class="entry-gate-kind">${word.kind === 'expression' ? esc(t('entry_gate_kind_expression', 'تعبير قرآني')) : esc(t('entry_gate_kind_word', 'كلمة قرآنية'))}</div>
        <div class="entry-gate-meaning">${esc(word.meaning)}</div>
        <div class="entry-gate-ref">
          <span>${esc(surahName(word.surah_number))}</span>
          <span>${esc(t('entry_gate_ayah', 'الآية'))} ${fmt(word.ayah_number)}</span>
          <span>${esc(t('entry_gate_page', 'صفحة'))} ${fmt(word.page_number)}</span>
        </div>
        ${word.book ? `<div class="entry-gate-book">${esc(word.book)}</div>` : ''}
      </div>
      <div class="kalimaat-locked-meta">
        <span>${esc(t('kalimaat_lifetime', 'إجمالي التكرار'))}</span>
        <strong>${fmt(word.repeat_count)} / ${fmt(target)}</strong>
      </div>
      <div class="kalimaat-progress"><span style="width:${Math.max(0, Math.min(100, Number(word.progress_percent) || 0))}%"></span></div>
      <div class="kalimaat-locked-actions">
        <button type="button" class="btn btn-primary" data-kalimaat-add="1">${esc(t('kalimaat_add_one', 'سجّل تكرارًا (+1)'))}</button>
        <button type="button" class="btn btn-ghost" data-kalimaat-add="10">+10</button>
        <button type="button" class="btn btn-ghost" data-kalimaat-add="50">+50</button>
      </div>
      <p class="entry-gate-hint">${esc(t('kalimaat_locked_hint', 'تظل الكلمة مثبتة حتى تصل إلى ١٠٠٠ تكرار، ثم تنتقل تلقائيًا إلى الاختبار.'))}</p>`;
  }

  function populateJuz() {
    const select = $('kalimaat-juz');
    if (!select) return;
    const counts = ((state.entry && state.entry.kalimaat && state.entry.kalimaat.juz_counts) || {});
    const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (!keys.length) {
      select.innerHTML = `<option value="">${esc(t('kalimaat_no_juz', 'لا توجد أجزاء في نطاقك'))}</option>`;
      select.disabled = true;
      return;
    }
    select.disabled = false;
    if (state.juz == null || keys.indexOf(Number(state.juz)) === -1) state.juz = keys[0];
    select.innerHTML = keys.map((juz) => `
      <option value="${juz}" ${Number(state.juz) === juz ? 'selected' : ''}>
        ${esc(t('kalimaat_juz_option', 'الجزء {n} · {count} كلمة', { n: fmt(juz), count: fmt(counts[juz]) }))}
      </option>`).join('');
  }

  async function addRepetitions(amount) {
    if (state.adding) return;
    const k = state.entry && state.entry.kalimaat;
    const word = k && k.locked;
    if (!word) return;

    state.adding = true;
    document.querySelectorAll('[data-kalimaat-add]').forEach((btn) => { btn.disabled = true; });

    try {
      const { ok, data } = await api('api/kalimaat/repeat.php', {
        method: 'POST',
        body: { word_key: word.key, amount },
      });

      if (ok && data && data.success) {
        state.entry.kalimaat.locked = data.word || word;
        state.entry.kalimaat.stats = data.stats || k.stats;
        state.entry.kalimaat.test_available = Number((data.stats || {}).test_pool || 0) > 0;
        renderHeader();
        renderLocked();
        toast(t('kalimaat_saved', 'تم حفظ التكرار.'));
        if (data.completed || (data.word && data.word.status !== 'LOCKED')) {
          await refreshEntry();
          await loadList();
        } else if (state.list) {
          loadList();
        }
      } else if (data && data.code === 'NOT_LOCKED') {
        await refreshEntry();
        toast(t('kalimaat_not_locked', 'تم تحديث الكلمة المثبتة.'));
      } else {
        toast((data && data.error) || t('kalimaat_save_error', 'تعذر حفظ التكرار.'));
      }
    } catch (e) {
      toast(t('kalimaat_network_error', 'تعذر الاتصال بالخادم.'));
    } finally {
      state.adding = false;
      document.querySelectorAll('[data-kalimaat-add]').forEach((btn) => { btn.disabled = false; });
    }
  }

  async function refreshEntry() {
    const { data } = await api('api/kalimaat/get_entry.php', { method: 'GET' });
    if (data && data.success) {
      state.entry = data;
      state.zone = data.zone || null;
      renderHeader();
      renderLocked();
      populateJuz();
    }
  }

  /* ------------------------------------------------------------------------
     Page: browser
     ------------------------------------------------------------------------ */

  function bindBrowser() {
    const juz = $('kalimaat-juz');
    const status = $('kalimaat-status');
    const search = $('kalimaat-search');
    const list = $('kalimaat-list');
    const chips = $('kalimaat-page-chips');

    if (juz) {
      juz.addEventListener('change', () => {
        state.juz = Number(juz.value) || null;
        state.page = null;
        loadList();
      });
    }
    if (status) {
      status.addEventListener('change', () => {
        state.status = status.value || '';
        state.page = null;
        loadList();
      });
    }
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          state.q = search.value.trim();
          state.page = null;
          loadList();
        }, 320);
      });
    }
    if (chips) {
      chips.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-kalimaat-page]');
        if (!btn) return;
        const value = btn.dataset.kalimaatPage;
        state.page = value === '' ? null : Number(value);
        loadList();
      });
    }
    if (list) {
      list.addEventListener('click', (event) => {
        const row = event.target.closest('[data-lock-key]');
        if (row) {
          lockWord(row.dataset.lockKey, Number(row.dataset.lockPage));
        }
      });
      list.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('[data-lock-key]');
        if (row) {
          event.preventDefault();
          lockWord(row.dataset.lockKey, Number(row.dataset.lockPage));
        }
      });
    }
  }

  async function loadList() {
    const list = $('kalimaat-list');
    if (!list) return;
    if (state.loading) return;
    state.loading = true;
    list.innerHTML = `<div class="kalimaat-empty"><p>${esc(t('kalimaat_loading', 'جارٍ التحميل…'))}</p></div>`;

    try {
      const params = new URLSearchParams();
      if (state.juz) params.set('juz', String(state.juz));
      if (state.page) params.set('page', String(state.page));
      if (state.status) params.set('status', state.status);
      if (state.q) params.set('q', state.q);

      const { ok, data } = await api('api/kalimaat/list.php?' + params.toString(), { method: 'GET' });
      if (!ok || !data || !data.success) {
        state.list = null;
        list.innerHTML = `<div class="kalimaat-empty"><p>${esc((data && data.error) || t('kalimaat_load_error', 'تعذر تحميل الكلمات.'))}</p></div>`;
        return;
      }
      state.list = data;
      if (data.juz && Number(state.juz) !== Number(data.juz)) {
        state.juz = Number(data.juz);
        populateJuz();
      }
      renderPageChips(data);
      renderList(data);
      setText('kalimaat-browser-count', `${fmt(data.count)} ${t('kalimaat_word_unit', 'كلمة')}`);
    } catch (e) {
      state.list = null;
      list.innerHTML = `<div class="kalimaat-empty"><p>${esc(t('kalimaat_network_error', 'تعذر الاتصال بالخادم.'))}</p></div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderPageChips(data) {
    const chips = $('kalimaat-page-chips');
    if (!chips) return;
    const pages = data.pages || {};
    const keys = Object.keys(pages).map(Number).sort((a, b) => a - b);
    if (!keys.length) {
      chips.innerHTML = '';
      return;
    }
    let html = `<button type="button" class="kalimaat-page-chip ${state.page == null ? 'is-active' : ''}" data-kalimaat-page="">${esc(t('kalimaat_all_pages', 'الكل'))}</button>`;
    keys.forEach((page) => {
      html += `<button type="button" class="kalimaat-page-chip ${Number(state.page) === page ? 'is-active' : ''}" data-kalimaat-page="${page}">${esc(t('kalimaat_page_short', 'ص {n}', { n: fmt(page) }))}</button>`;
    });
    chips.innerHTML = html;
    const active = chips.querySelector('.is-active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function renderList(data) {
    const list = $('kalimaat-list');
    if (!list) return;
    const words = data.words || [];
    if (!words.length) {
      list.innerHTML = `
        <div class="kalimaat-empty">
          <div class="kalimaat-empty-icon" aria-hidden="true">🔎</div>
          <strong>${esc(t('kalimaat_no_results_title', 'لا توجد نتائج'))}</strong>
          <p>${esc(t('kalimaat_no_results_desc', 'غيّر الجزء أو الحالة أو كلمة البحث.'))}</p>
        </div>`;
      return;
    }

    list.innerHTML = words.map((word) => {
      const status = word.status || 'NEW';
      const isNew = status === 'NEW';
      const statusClass = status === 'LOCKED' ? 'is-locked' : status === 'READY' ? 'is-ready' : status === 'MASTERED' ? 'is-mastered' : '';
      return `
        <div class="kalimaat-row ${isNew ? 'is-new' : ''}" ${isNew ? `role="button" tabindex="0" data-lock-key="${esc(word.key)}" data-lock-page="${Number(word.page_number) || 0}"` : ''}>
          <div class="kalimaat-row-text">${esc(word.text)}</div>
          <span class="kalimaat-status ${statusClass}">${esc(statusText(status))}</span>
          <div class="kalimaat-row-meaning">${esc(word.meaning)}</div>
          <div class="kalimaat-row-meta">
            <span>${esc(surahName(word.surah_number))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${fmt(word.ayah_number)}</span>
            <span>${esc(t('entry_gate_page', 'صفحة'))} ${fmt(word.page_number)}</span>
            ${word.book ? `<span>${esc(word.book)}</span>` : ''}
            <span>${fmt(word.repeat_count)} / ${fmt(word.target || 1000)}</span>
          </div>
        </div>`;
    }).join('');
  }

  async function lockWord(key, page) {
    if (!key || !page) return;
    try {
      const { ok, data } = await api('api/kalimaat/lock.php', {
        method: 'POST',
        body: { word_key: key, page_number: page },
      });
      if (ok && data && data.success) {
        toast(data.already_locked
          ? t('kalimaat_already_locked', 'لديك كلمة مثبتة بالفعل؛ أكملها أولًا.')
          : t('kalimaat_locked_saved', 'تم تثبيت الكلمة وبدأ التكرار.'));
        await refreshEntry();
        await loadList();
        const locked = $('kalimaat-locked');
        if (locked && locked.scrollIntoView) locked.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        toast((data && data.error) || t('kalimaat_lock_error', 'تعذر تثبيت الكلمة.'));
        if (data && data.code === 'ALREADY_STARTED') loadList();
      }
    } catch (e) {
      toast(t('kalimaat_network_error', 'تعذر الاتصال بالخادم.'));
    }
  }

  /* ------------------------------------------------------------------------
     Test
     ------------------------------------------------------------------------ */

  function bindTest() {
    const body = $('kalimaat-test-body');
    if (!body) return;
    body.addEventListener('click', (event) => {
      const option = event.target.closest('[data-test-option]');
      if (option && !state.testResult) {
        answerTest(option.dataset.testOption, option.dataset.testMeaning || '');
        return;
      }
      if (event.target.closest('#kalimaat-test-next')) {
        loadTest();
      }
      if (event.target.closest('#kalimaat-test-study')) {
        switchView('study');
      }
      if (event.target.closest('#kalimaat-test-start')) {
        loadTest();
      }
    });
  }

  async function loadTest() {
    const body = $('kalimaat-test-body');
    if (!body) return;
    state.testResult = null;
    body.innerHTML = `<div class="kalimaat-test-empty"><p>${esc(t('kalimaat_loading', 'جارٍ التحميل…'))}</p></div>`;
    try {
      const { ok, data } = await api('api/kalimaat/test.php', { method: 'GET' });
      if (!ok || !data || !data.success) {
        body.innerHTML = `<div class="kalimaat-test-empty"><strong>${esc(t('kalimaat_test_error_title', 'تعذر تحميل الاختبار'))}</strong><p>${esc((data && data.error) || t('kalimaat_network_error', 'تعذر الاتصال بالخادم.'))}</p></div>`;
        return;
      }
      state.test = data;
      state.testSession = appTestSession();
      renderTest();
    } catch (e) {
      body.innerHTML = `<div class="kalimaat-test-empty"><strong>${esc(t('kalimaat_test_error_title', 'تعذر تحميل الاختبار'))}</strong></div>`;
    }
  }

  function renderTest() {
    const body = $('kalimaat-test-body');
    if (!body) return;
    const data = state.test || {};
    const q = data.question;
    if (!q) {
      setText('kalimaat-test-counter', '0 / 3');
      body.innerHTML = `
        <div class="kalimaat-test-empty">
          <div class="kalimaat-empty-icon" aria-hidden="true">🎯</div>
          <strong>${esc(t('kalimaat_test_empty_title', 'لا توجد كلمات جاهزة بعد'))}</strong>
          <p>${esc(t('kalimaat_test_empty_desc', 'أكمل ١٠٠٠ تكرار لكلمة واحدة على الأقل ليبدأ الاختبار.'))}</p>
          <button type="button" class="btn btn-primary" id="kalimaat-test-study" style="margin-top:0.8rem;">${esc(t('kalimaat_back_study', 'العودة إلى المراجعة'))}</button>
        </div>`;
      return;
    }

    const word = q.word || {};
    const options = q.options || [];
    const result = state.testResult;
    setText('kalimaat-test-counter', `${fmt(word.test_correct || 0)} / ${fmt(data.mastery_correct || 3)}`);

    body.innerHTML = `
      <div class="kalimaat-test-word" dir="rtl">${esc(word.text)}</div>
      <div class="kalimaat-test-ref">
        ${esc(surahName(word.surah_number))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${fmt(word.ayah_number)}
        • ${esc(t('entry_gate_page', 'صفحة'))} ${fmt(word.page_number)}
      </div>
      <div class="kalimaat-options">
        ${options.map((option, index) => {
          let cls = '';
          if (result) {
            if (option.text === result.correct_meaning) cls = 'is-correct';
            else if (option.text === result.selected_meaning) cls = 'is-wrong';
          }
          return `
            <button type="button" class="kalimaat-option ${cls}" data-test-option="${esc(option.id)}" data-test-meaning="${esc(option.text)}" ${result ? 'disabled' : ''}>
              <span class="kalimaat-option-index">${fmt(index + 1)}</span>
              <span>${esc(option.text)}</span>
            </button>`;
        }).join('')}
      </div>
      ${result ? testFeedbackHtml(result) : ''}
      <div class="kalimaat-test-actions">
        ${result ? `<button type="button" class="btn btn-primary" id="kalimaat-test-next">${esc(t('kalimaat_test_next', 'سؤال جديد'))}</button>` : ''}
        <button type="button" class="btn btn-ghost" id="kalimaat-test-study">${esc(t('kalimaat_back_study', 'العودة إلى المراجعة'))}</button>
      </div>
      <div class="kalimaat-test-stats">
        <span>${esc(t('kalimaat_test_attempts', 'المحاولات: {n}', { n: fmt(word.test_attempts) }))}</span>
        <span>${esc(t('kalimaat_test_correct_count', 'الإجابات المحسوبة: {n}', { n: fmt(word.test_correct) }))}</span>
      </div>`;
  }

  function testFeedbackHtml(result) {
    if (result.correct && result.mastered) {
      return `<div class="kalimaat-test-feedback is-correct">✓ ${esc(t('kalimaat_test_mastered', 'أتقنت هذه الكلمة! ثلاث إجابات صحيحة في جلسات منفصلة.'))}</div>`;
    }
    if (result.correct && result.counted) {
      return `<div class="kalimaat-test-feedback is-correct">✓ ${esc(t('kalimaat_test_correct_counted', 'إجابة صحيحة، وتم احتسابها. تبقّى {n} إجابة في جلسات قادمة.', { n: Math.max(0, Number(result.mastery_correct || 3) - Number((result.word || {}).test_correct || 0)) }))}</div>`;
    }
    if (result.correct && !result.counted) {
      return `<div class="kalimaat-test-feedback is-correct">✓ ${esc(t('kalimaat_test_correct_repeat', 'إجابة صحيحة، لكن هذه الجلسة محسوبة مسبقًا. ستُحتسب في اختبار جديد.'))}</div>`;
    }
    return `<div class="kalimaat-test-feedback is-wrong">${esc(t('kalimaat_test_wrong', 'الإجابة الصحيحة: {meaning}', { meaning: result.correct_meaning || '' }))}</div>`;
  }

  async function answerTest(optionId, selectedMeaning) {
    const data = state.test;
    if (!data || !data.question || state.testResult) return;
    const word = data.question.word || {};
    const body = $('kalimaat-test-body');
    if (body) {
      body.querySelectorAll('[data-test-option]').forEach((btn) => { btn.disabled = true; });
    }

    try {
      const { ok, data: result } = await api('api/kalimaat/test_answer.php', {
        method: 'POST',
        body: {
          word_key: word.key,
          selected_meaning: selectedMeaning,
          test_session: state.testSession,
        },
      });

      if (!ok || !result || !result.success) {
        toast((result && result.error) || t('kalimaat_save_error', 'تعذر حفظ الإجابة.'));
        if (body) {
          body.querySelectorAll('[data-test-option]').forEach((btn) => { btn.disabled = false; });
        }
        return;
      }

      state.testResult = Object.assign({}, result, {
        selected_meaning: selectedMeaning,
        mastery_correct: result.mastery_correct || data.mastery_correct || 3,
      });
      state.test.question.word = result.word || word;
      if (result.stats && state.entry && state.entry.kalimaat) {
        state.entry.kalimaat.stats = result.stats;
        renderHeader();
      }
      renderTest();
      if (result.mastered) {
        toast(t('kalimaat_mastered_toast', 'أتقنت الكلمة!'));
      }
    } catch (e) {
      toast(t('kalimaat_network_error', 'تعذر الاتصال بالخادم.'));
      if (body) {
        body.querySelectorAll('[data-test-option]').forEach((btn) => { btn.disabled = false; });
      }
    }
  }

  /* ------------------------------------------------------------------------
     Tabs + initialisation
     ------------------------------------------------------------------------ */

  function bindTabs() {
    document.querySelectorAll('.kalimaat-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });
  }

  function switchView(view) {
    if (view !== 'study' && view !== 'test') return;
    state.view = view;
    const study = $('kalimaat-study');
    const test = $('kalimaat-test');
    if (study) study.classList.toggle('hidden', view !== 'study');
    if (test) test.classList.toggle('hidden', view !== 'test');
    document.querySelectorAll('.kalimaat-tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (view === 'test') {
      if (!state.test || state.testResult) loadTest();
      else renderTest();
    }
    if (view === 'study' && !state.list) loadList();
  }

  function bindLocked() {
    const box = $('kalimaat-locked');
    if (!box) return;
    box.addEventListener('click', (event) => {
      const add = event.target.closest('[data-kalimaat-add]');
      if (add) {
        event.preventDefault();
        addRepetitions(Number(add.dataset.kalimaatAdd) || 1);
      }
    });
  }

  function boot() {
    if (document.getElementById('kalimaat-locked')) {
      initPage();
    } else {
      refreshDashboard();
    }

    document.addEventListener('entrygate:done', () => {
      if (document.getElementById('kalimaat-dashboard-card')) {
        refreshDashboard();
      } else if (state.entry) {
        refreshEntry().then(() => {
          if (state.view === 'study' && state.list) loadList();
        });
      }
    });

    if (window.I18N && typeof I18N.onChange === 'function') {
      I18N.onChange(() => {
        if (state.entry) {
          renderHeader();
          renderLocked();
          populateJuz();
          if (state.list) {
            renderPageChips(state.list);
            renderList(state.list);
          }
          if (state.view === 'test') renderTest();
        } else if (!$('kalimaat-locked')) {
          refreshDashboard();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
