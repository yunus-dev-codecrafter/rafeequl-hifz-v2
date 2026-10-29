'use strict';

/* ==========================================================================
   Rafeequl Hifz - entry gate
   A single blocking overlay with two sequential steps:
     1. معاني كلمات القرآن (10 repetitions per entry, 1000 lifetime)
     2. بطاقة خطأ واحدة (10 repetitions per entry, 40 lifetime)
   The gate is re-armed once per browser app-session. It fails open only when
   the API or the optional catalog is unavailable, so a server problem never
   locks the user out of the app.
   ========================================================================== */

(function () {
  const SESSION_KEY = 'rh_entry_gate_done_v2';
  try { sessionStorage.removeItem('rh_entry_gate_done'); } catch (e) {}
  let alreadyDone = false;
  try { alreadyDone = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) {}
  if (alreadyDone) return;

  const state = {
    data: null,
    quran: null,
    quranPromise: null,
    step: 'kalimaat',
    kalimaat: null,
    mistake: null,
    overlay: null,
    busy: false,
  };

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

  function surahName(id) {
    try {
      if (window.I18N && typeof I18N.getSurahName === 'function') {
        const name = I18N.getSurahName(Number(id));
        if (name) return name;
      }
    } catch (e) {}
    return t('entry_gate_surah', 'سورة') + ' ' + id;
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
    return { ok: res.ok, status: res.status, data };
  }

  function markDone() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
    if (state.overlay && state.overlay.parentNode) {
      state.overlay.parentNode.removeChild(state.overlay);
    }
    state.overlay = null;
    document.body.classList.remove('entry-gate-open');
    document.dispatchEvent(new CustomEvent('entrygate:done'));
  }

  function updateSteps() {
    if (!state.overlay) return;
    state.overlay.querySelectorAll('[data-entry-step]').forEach((el) => {
      const step = el.dataset.entryStep;
      const active = step === state.step;
      el.classList.toggle('is-active', active);
      const done = (step === 'kalimaat' && state.kalimaat && state.kalimaat.done)
        || (step === 'mistake' && state.mistake && state.mistake.done);
      el.classList.toggle('is-done', !!done);
    });
  }

  function shell(kicker, title, subtitle, bodyHtml) {
    return `
      <div class="entry-gate-top">
        <div>
          <span class="entry-gate-kicker">${esc(kicker)}</span>
          <div class="entry-gate-steps" aria-label="${esc(t('entry_gate_steps', 'خطوات الدخول'))}">
            <span class="entry-gate-step" data-entry-step="kalimaat">${esc(t('entry_gate_step_kalimaat', 'معاني الكلمات'))}</span>
            <span class="entry-gate-step" data-entry-step="mistake">${esc(t('entry_gate_step_mistake', 'بطاقة الخطأ'))}</span>
          </div>
        </div>
        <span class="entry-gate-lock" aria-hidden="true">🔒</span>
      </div>
      <div class="entry-gate-heading">
        <h2 id="entry-gate-title">${esc(title)}</h2>
        <p>${esc(subtitle)}</p>
      </div>
      <div class="entry-gate-body">${bodyHtml}</div>`;
  }

  function render(html) {
    if (!state.overlay) return;
    const card = state.overlay.querySelector('.entry-gate-card');
    if (card) card.innerHTML = html;
    updateSteps();
  }

  function progressHtml(value, max, label) {
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    return `
      <div class="entry-gate-progress">
        <div class="entry-gate-progress-head"><span>${esc(label)}</span><strong>${value} / ${max}</strong></div>
        <div class="entry-gate-progress-track"><span style="width:${pct}%"></span></div>
      </div>`;
  }

  function wordCardHtml(word, showMeaning) {
    return `
      <div class="entry-gate-word-card" dir="rtl">
        <div class="entry-gate-word">${esc(word.text)}</div>
        <div class="entry-gate-kind">${word.kind === 'expression'
          ? esc(t('entry_gate_kind_expression', 'تعبير قرآني'))
          : esc(t('entry_gate_kind_word', 'كلمة قرآنية'))}</div>
        ${showMeaning ? `<div class="entry-gate-meaning">${esc(word.meaning)}</div>` : ''}
        <div class="entry-gate-ref">
          <span>${esc(surahName(word.surah_number))}</span>
          <span>${esc(t('entry_gate_ayah', 'الآية'))} ${Number(word.ayah_number) || ''}</span>
          <span>${esc(t('entry_gate_page', 'صفحة'))} ${Number(word.page_number) || ''}</span>
        </div>
        ${word.book ? `<div class="entry-gate-book">${esc(word.book)}</div>` : ''}
      </div>`;
  }

  function startKalimaat() {
    const payload = state.data && state.data.kalimaat;
    if (!payload || !payload.available || !payload.locked) {
      state.step = 'mistake';
      startMistake();
      return;
    }

    const word = payload.locked;
    const remaining = Math.max(0, Number(word.remaining) || 0);
    const target = Math.max(1, Math.min(10, remaining));

    state.step = 'kalimaat';
    state.kalimaat = {
      done: 0,
      target,
      word,
      startCount: Number(word.repeat_count) || 0,
    };
    renderKalimaat();
  }

  function renderKalimaat() {
    const k = state.kalimaat;
    if (!k) return;
    const word = k.word;
    const body = `
      ${progressHtml(k.done, k.target, t('entry_gate_this_entry', 'هذا الدخول'))}
      ${wordCardHtml(word, true)}
      <div class="entry-gate-lifetime">
        <span>${esc(t('entry_gate_lifetime', 'إجمالي التكرار'))}</span>
        <strong>${Number(word.repeat_count) || 0} / 1000</strong>
      </div>
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-repeat">
          <span>${esc(t('entry_gate_repeat_btn', 'تم التكرار'))}</span>
          <span aria-hidden="true">+1</span>
        </button>
      </div>
      <p class="entry-gate-hint" id="entry-gate-status">
        ${esc(t('entry_gate_kalimaat_hint', 'راجع الكلمة ثم اضغط «تم التكرار». يلزم إتمام العدد المطلوب قبل دخول التطبيق.'))}
      </p>`;

    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_kalimaat_title', 'معاني كلمات القرآن'),
      t('entry_gate_kalimaat_sub', 'مراجعة قصيرة قبل بدء المهام'),
      body
    ));

    const btn = document.getElementById('entry-gate-repeat');
    if (btn) btn.addEventListener('click', repeatKalimaat);
  }

  async function repeatKalimaat() {
    if (state.busy || !state.kalimaat) return;
    const k = state.kalimaat;
    state.busy = true;
    const btn = document.getElementById('entry-gate-repeat');
    if (btn) btn.disabled = true;
    const status = document.getElementById('entry-gate-status');
    if (status) status.textContent = t('entry_gate_saving', 'جارٍ الحفظ...');

    try {
      const { ok, data } = await api('../api/kalimaat/repeat.php', {
        method: 'POST',
        body: { word_key: k.word.key, amount: 1 },
      });

      if (ok && data && data.success) {
        k.done += 1;
        k.word = data.word || k.word;
        if (k.done >= k.target || data.completed || (data.word && data.word.status !== 'LOCKED')) {
          showKalimaatDone();
          return;
        }
        renderKalimaat();
      } else if (data && data.code === 'NOT_LOCKED') {
        k.done = k.target;
        showKalimaatDone();
      } else {
        if (status) status.textContent = (data && data.error) || t('entry_gate_error', 'تعذر الحفظ. أعد المحاولة.');
        if (btn) btn.disabled = false;
      }
    } catch (e) {
      if (status) status.textContent = t('entry_gate_network_error', 'تعذر الاتصال بالخادم. أعد المحاولة.');
      if (btn) btn.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  function showKalimaatDone() {
    const k = state.kalimaat;
    if (!k) return;
    k.done = true;
    const body = `
      <div class="entry-gate-success" role="status">
        <span class="entry-gate-success-icon" aria-hidden="true">✓</span>
        <div>
          <strong>${esc(t('entry_gate_kalimaat_done_title', 'أتممت مراجعة الكلمة'))}</strong>
          <p>${esc(t('entry_gate_kalimaat_done_desc', 'وصلت الكلمة إلى العدد المطلوب لهذا الدخول. يمكنك متابعة التكرار لاحقًا من صفحة معاني الكلمات.'))}</p>
        </div>
      </div>
      ${wordCardHtml(k.word, false)}
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-next">
          ${esc(t('entry_gate_next', 'التالي'))} ←
        </button>
      </div>`;
    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_kalimaat_title', 'معاني كلمات القرآن'),
      t('entry_gate_step_done', 'تمت الخطوة الأولى'),
      body
    ));
    const next = document.getElementById('entry-gate-next');
    if (next) next.addEventListener('click', () => { state.step = 'mistake'; startMistake(); });
  }

  async function loadQuran() {
    if (state.quran) return state.quran;
    if (!state.quranPromise) {
      state.quranPromise = fetch('data/quran-uthmani.json', { credentials: 'same-origin' })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          state.quran = data || {};
          return state.quran;
        })
        .catch(() => {
          state.quran = {};
          return state.quran;
        });
    }
    return state.quranPromise;
  }

  function ayahText(card) {
    if (!state.quran || !card) return '';
    const surah = state.quran[String(card.surah_number)];
    if (!Array.isArray(surah)) return '';
    return surah[Number(card.ayah_number) - 1] || '';
  }

  function startMistake() {
    const payload = state.data && state.data.mistake;
    const card = payload && payload.card;
    if (!payload || !payload.available || !card) {
      finish();
      return;
    }

    const remaining = Math.max(0, Number(card.remaining) || 0);
    const target = Math.max(1, Math.min(10, remaining));
    state.step = 'mistake';
    state.mistake = {
      done: 0,
      target,
      card,
      lastResult: '',
    };

    renderMistake();
    loadQuran().then(() => {
      if (state.step === 'mistake' && state.mistake) renderMistake();
    });
  }

  function renderMistake() {
    const m = state.mistake;
    if (!m) return;
    const card = m.card;
    const text = ayahText(card);
    const body = `
      ${progressHtml(m.done, m.target, t('entry_gate_this_entry', 'هذا الدخول'))}
      <div class="entry-gate-mistake-card" dir="rtl">
        <div class="entry-gate-mistake-ref">
          <span>${esc(surahName(card.surah_number))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${Number(card.ayah_number) || ''}</span>
          <span>${esc(t('entry_gate_page', 'صفحة'))} ${Number(card.page_number) || ''}</span>
        </div>
        <div class="entry-gate-ayah" id="entry-gate-ayah">${text ? esc(text) : `<span class="entry-gate-loading">${esc(t('entry_gate_loading_ayah', 'جارٍ تحميل الآية...'))}</span>`}</div>
        ${card.notes ? `<p class="entry-gate-note">${esc(card.notes)}</p>` : ''}
        <div class="entry-gate-lifetime">
          <span>${esc(t('entry_gate_mistake_lifetime', 'تكرار البطاقة'))}</span>
          <strong>${Number(card.practice_count) || 0} / ${Number(card.practice_target) || 40}</strong>
        </div>
      </div>
      <div class="entry-gate-actions entry-gate-actions-split">
        <button type="button" class="btn btn-success entry-gate-main-btn" id="entry-gate-correct">
          ${esc(t('entry_gate_correct', 'أعدت صحيحًا'))} ✓
        </button>
        <button type="button" class="btn btn-ghost entry-gate-main-btn" id="entry-gate-slip">
          ${esc(t('entry_gate_slip', 'تعثرت'))}
        </button>
      </div>
      <p class="entry-gate-hint" id="entry-gate-status">
        ${esc(m.lastResult === 'slip'
          ? t('entry_gate_slip_hint', 'التعثر لا يُحسب. أعد المحاولة حتى تصل إلى العدد المطلوب.')
          : t('entry_gate_mistake_hint', 'أعد الآية مرة واحدة ثم اختر النتيجة. تُحسب المحاولة الصحيحة فقط.'))}
      </p>`;

    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_mistake_title', 'بطاقة خطأ للمراجعة'),
      t('entry_gate_mistake_sub', 'ثلاثون ثانية تصنع فرقًا في الحفظ'),
      body
    ));

    const correct = document.getElementById('entry-gate-correct');
    const slip = document.getElementById('entry-gate-slip');
    if (correct) correct.addEventListener('click', () => reviewMistake('CORRECT'));
    if (slip) slip.addEventListener('click', () => reviewMistake('SLIP'));
  }

  async function reviewMistake(result) {
    if (state.busy || !state.mistake) return;
    const m = state.mistake;
    state.busy = true;
    const correctBtn = document.getElementById('entry-gate-correct');
    const slipBtn = document.getElementById('entry-gate-slip');
    if (correctBtn) correctBtn.disabled = true;
    if (slipBtn) slipBtn.disabled = true;
    const status = document.getElementById('entry-gate-status');
    if (status) status.textContent = t('entry_gate_saving', 'جارٍ الحفظ...');

    try {
      const { ok, data } = await api('../api/mistakes/review_mistake.php', {
        method: 'POST',
        body: { mistake_id: m.card.mistake_id, result },
      });

      if (ok && data && data.success) {
        m.card.practice_count = Number(data.practice_count) || m.card.practice_count;
        m.card.practice_target = Number(data.practice_target) || m.card.practice_target;
        m.card.remaining = Math.max(0, m.card.practice_target - m.card.practice_count);

        if (result === 'CORRECT') {
          m.done += 1;
          if (m.done >= m.target || data.completed || data.status === 'ARCHIVED' || m.card.remaining <= 0) {
            showMistakeDone();
            return;
          }
          m.lastResult = 'correct';
        } else {
          m.lastResult = 'slip';
        }
        renderMistake();
      } else if (data && /already completed/i.test(String(data.error || ''))) {
        showMistakeDone();
      } else {
        m.lastResult = result === 'CORRECT' ? '' : 'slip';
        if (status) status.textContent = (data && data.error) || t('entry_gate_error', 'تعذر الحفظ. أعد المحاولة.');
        if (correctBtn) correctBtn.disabled = false;
        if (slipBtn) slipBtn.disabled = false;
      }
    } catch (e) {
      if (status) status.textContent = t('entry_gate_network_error', 'تعذر الاتصال بالخادم. أعد المحاولة.');
      if (correctBtn) correctBtn.disabled = false;
      if (slipBtn) slipBtn.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  function showMistakeDone() {
    const m = state.mistake;
    if (!m) return;
    m.done = true;
    const body = `
      <div class="entry-gate-success" role="status">
        <span class="entry-gate-success-icon" aria-hidden="true">✓</span>
        <div>
          <strong>${esc(t('entry_gate_mistake_done_title', 'أتممت بطاقة الخطأ'))}</strong>
          <p>${esc(t('entry_gate_mistake_done_desc', 'ستعود البطاقة في دخول قادم حتى تصل إلى 40 تكرارًا، أو تُؤرشف تلقائيًا عند اكتمالها.'))}</p>
        </div>
      </div>
      <div class="entry-gate-lifetime">
        <span>${esc(t('entry_gate_mistake_lifetime', 'تكرار البطاقة'))}</span>
        <strong>${Number(m.card.practice_count) || 0} / ${Number(m.card.practice_target) || 40}</strong>
      </div>
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-enter">
          ${esc(t('entry_gate_enter', 'ادخل إلى التطبيق'))} ←
        </button>
      </div>`;
    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_mistake_title', 'بطاقة خطأ للمراجعة'),
      t('entry_gate_step_done', 'تمت الخطوة الثانية'),
      body
    ));
    const enter = document.getElementById('entry-gate-enter');
    if (enter) enter.addEventListener('click', finish);
  }

  function finish() {
    if (!state.overlay) {
      markDone();
      return;
    }
    state.step = 'done';
    const body = `
      <div class="entry-gate-finish" role="status">
        <span class="entry-gate-finish-icon" aria-hidden="true">✓</span>
        <h3>${esc(t('entry_gate_finish_title', 'بوابة الدخول مكتملة'))}</h3>
        <p>${esc(t('entry_gate_finish_desc', 'أنت جاهز لمهام اليوم. لن تظهر هذه البوابة مرة أخرى في هذه الجلسة.'))}</p>
      </div>
      <div class="entry-gate-summary">
        <div><span>${esc(t('entry_gate_step_kalimaat', 'معاني الكلمات'))}</span><strong>${state.kalimaat ? '✓' : '—'}</strong></div>
        <div><span>${esc(t('entry_gate_step_mistake', 'بطاقة الخطأ'))}</span><strong>${state.mistake ? '✓' : '—'}</strong></div>
      </div>
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-close">
          ${esc(t('entry_gate_close', 'متابعة إلى التطبيق'))} ←
        </button>
      </div>`;
    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_finish_title', 'بوابة الدخول مكتملة'),
      t('entry_gate_finish_sub', 'بارك الله فيك'),
      body
    ));
    const close = document.getElementById('entry-gate-close');
    if (close) close.addEventListener('click', markDone);
  }

  function showOverlay() {
    if (state.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'entry-gate-overlay';
    overlay.id = 'entry-gate-overlay';
    overlay.innerHTML = `<div class="entry-gate-card" role="dialog" aria-modal="true" aria-labelledby="entry-gate-title"></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('entry-gate-open');
    state.overlay = overlay;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = overlay.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  async function boot() {
    let done = false;
    try { done = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) {}
    if (done) return;
    try {
      const { ok, status, data } = await api('../api/kalimaat/get_entry.php', { method: 'GET' });
      if (status === 401) return;
      if (!ok || !data || !data.success) {
        markDone();
        return;
      }
      if (data.must_change_password) {
        markDone();
        return;
      }

      state.data = data;
      const hasKalimaat = !!(data.kalimaat && data.kalimaat.available);
      const hasMistake = !!(data.mistake && data.mistake.available);
      if (!hasKalimaat && !hasMistake) {
        markDone();
        return;
      }

      showOverlay();
      if (hasKalimaat) startKalimaat();
      else startMistake();
    } catch (e) {
      markDone();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
