'use strict';

/* ==========================================================================
   Rafeequl Hifz — Rub' Consolidation (تثبيت الربع)

   One random rub' per day, consolidated one verse at a time:
     • the verse's words are shuffled together with three decoy words taken
       from the whole Qur'an;
     • the user taps the words in order to rebuild the verse;
     • a wrong word only shakes that word — correct placements are never lost,
       and the board is never re-scattered or restarted automatically;
     • each completed verse is marked in the verse rail, and the next verse
       opens in the same compact stage (no long mobile scrolling).

   Server: api/tasks/get_rub_verses.php + update_rub.php
   Local:  per-task completed verse keys + an offline queue (latest state wins)
   ========================================================================== */

const RUB_STATE_PREFIX = 'hifz-rub-state-v2-';
const RUB_DATA_PREFIX = 'hifz-rub-data-v2-';
const RUB_QUEUE_KEY = 'hifz-rub-queue-v2';
const RUB_LAST_TASK_KEY = 'hifz-rub-last-task';

function rubHashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rubRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rubShuffle(items, seed) {
  const rand = rubRandom(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

const RubPage = {
  taskId: 0,
  taskDate: '',
  task: null,
  rub: null,
  verses: [],
  verseByKey: {},
  completed: new Set(),
  boards: {},
  pools: {},
  tafsirOpen: {},
  activeIndex: 0,
  saving: false,
  saveTimer: null,
  queued: false,
  wrongTimer: null,
  offlineNotified: false,
  initialized: false,
  completedShown: false,

  get storageKey() {
    return RUB_STATE_PREFIX + this.taskId;
  },

  t(key, params, fallback) {
    if (window.I18N && typeof I18N.t === 'function') {
      const value = I18N.t(key, params || {});
      if (value != null && value !== key) return value;
    }
    return fallback != null ? fallback : key;
  },

  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  refLabel(surah, ayah) {
    const name = window.I18N && typeof I18N.getSurahName === 'function'
      ? I18N.getSurahName(surah)
      : ('سورة ' + surah);
    return name + ' ' + ayah;
  },

  verseKey(verse) {
    return (verse && verse.key) ? String(verse.key) : (verse.surah + ':' + verse.ayah);
  },

  isEnglish() {
    return !!(window.I18N && I18N.lang === 'en');
  },

  async boot() {
    if (this.initialized) return;
    this.initialized = true;

    this.bindUI();

    try {
      const data = await this.resolveTask();
      if (!data) {
        this.showInactive();
        return;
      }
      this.cacheData(data);
      this.applyData(data);
      this.render();
      this.hideLoading();
      this.attachSession();
      await this.flushQueue();
      if (this.pendingLocalSync) {
        this.scheduleSync();
      }
    } catch (err) {
      this.hideLoading();
      if (err && err.status === 401) return;
      if (err && err.status === 404) {
        this.showInactive();
        return;
      }

      // Offline (or a server hiccup): keep consolidating from the last cache.
      const cached = this.loadCached();
      if (cached) {
        this.applyData(cached);
        this.render();
        this.attachSession();
        showToast(this.t('rub_offline_open', {}, 'أنت غير متصل — تم فتح آخر ربع محفوظ على جهازك'), true);
        return;
      }

      if (err && err.status !== 401) {
        showToast((err && err.message) || this.t('rub_load_error', {}, 'تعذر تحميل ربع اليوم'), true);
      }
      this.showInactive();
    }
  },

  cacheData(data) {
    try {
      if (!data || !data.task || !data.task.id) return;
      const currentKey = RUB_DATA_PREFIX + data.task.id;

      // Keep the device cache small: only the last few rub' payloads.
      const cached = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(RUB_DATA_PREFIX) === 0) cached.push(key);
      }
      if (cached.length >= 8) {
        cached
          .filter((key) => key !== currentKey)
          .sort((a, b) => parseInt(a.slice(RUB_DATA_PREFIX.length), 10) - parseInt(b.slice(RUB_DATA_PREFIX.length), 10))
          .slice(0, cached.length - 7)
          .forEach((key) => localStorage.removeItem(key));
      }

      localStorage.setItem(currentKey, JSON.stringify(data));
      localStorage.setItem(RUB_LAST_TASK_KEY, String(data.task.id));
    } catch (e) {}
  },

  loadCached() {
    try {
      const id = localStorage.getItem(RUB_LAST_TASK_KEY);
      if (!id) return null;
      const raw = localStorage.getItem(RUB_DATA_PREFIX + id);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.task && data.verses && data.verses.length ? data : null;
    } catch (e) {
      return null;
    }
  },

  async resolveTask() {
    const params = new URLSearchParams(location.search);
    let taskId = parseInt(params.get('task') || '0', 10);

    if (!taskId) {
      const daily = await API.call('tasks/get_daily_tasks.php', { redirectOn401: true });
      const task = (daily.tasks || []).find((item) => item.task_type === 'RUB_TAMKIN');
      if (!task || !task.id) return null;
      taskId = task.id;
    }

    if (!taskId) return null;
    return API.call('tasks/get_rub_verses.php?task_id=' + encodeURIComponent(taskId), {
      redirectOn401: true,
    });
  },

  applyData(data) {
    this.taskId = data.task ? data.task.id : 0;
    this.taskDate = data.task ? data.task.task_date : (data.today || '');
    this.task = data.task || null;
    this.taskCompletedOnServer = !!(data.task && data.task.is_completed);
    this.rub = data.rub;
    this.verses = Array.isArray(data.verses) ? data.verses : [];
    this.verseByKey = {};
    this.boards = {};
    this.pools = {};
    this.tafsirOpen = {};

    this.verses.forEach((verse) => {
      const key = this.verseKey(verse);
      verse.key = key;
      if (!Array.isArray(verse.words)) verse.words = [];
      if (!Array.isArray(verse.distractors)) verse.distractors = [];
      this.verseByKey[key] = verse;
      this.boards[key] = { placed: [] };
    });

    const local = this.readLocal();
    const serverDone = new Set(
      Array.isArray(data.completed_verses)
        ? data.completed_verses
        : (data.task && Array.isArray(data.task.completed_verses) ? data.task.completed_verses : [])
    );

    const merged = new Set();
    const addIfValid = (key) => {
      if (typeof key === 'string' && this.verseByKey[key]) merged.add(key);
    };
    serverDone.forEach(addIfValid);

    const localDone = Array.isArray(local.completed) ? local.completed : [];
    localDone.forEach(addIfValid);
    this.completed = merged;

    // Restore only a valid sequential prefix of each local board.
    const localBoards = local.boards && typeof local.boards === 'object' ? local.boards : {};
    Object.keys(localBoards).forEach((key) => {
      const verse = this.verseByKey[key];
      if (!verse) return;
      const raw = localBoards[key] && Array.isArray(localBoards[key].placed)
        ? localBoards[key].placed
        : [];
      const placed = [];
      for (let i = 0; i < raw.length; i++) {
        if (Number(raw[i]) !== i) break;
        placed.push(i);
      }
      this.boards[key] = { placed };
    });

    // A verse may be complete on the server (or in the local completion list)
    // without a saved board on this device. Show its full arranged text instead
    // of an empty "completed" stage.
    this.completed.forEach((key) => {
      const verse = this.verseByKey[key];
      if (!verse || !this.boards[key]) return;
      if (this.boards[key].placed.length === verse.words.length) return;
      this.boards[key] = { placed: verse.words.map((_, index) => index) };
    });

    this.pendingLocalSync = localDone.some((key) => this.verseByKey[key] && !serverDone.has(key));

    const first = this.firstIncomplete();
    this.activeIndex = first >= 0 ? first : 0;
    this.completedShown = false;
  },

  readLocal() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') {
        return { completed: [], boards: {} };
      }
      return {
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        boards: parsed.boards && typeof parsed.boards === 'object' ? parsed.boards : {},
      };
    } catch (e) {
      return { completed: [], boards: {} };
    }
  },

  persistLocal() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        completed: Array.from(this.completed),
        boards: this.boards,
        savedAt: Date.now(),
      }));
    } catch (e) {
      // Storage full / private mode: the page still works for this session.
    }
  },

  showLoading() {
    const loading = document.getElementById('rub-loading');
    const root = document.getElementById('rub-root');
    if (loading) loading.classList.remove('hidden');
    if (root) root.classList.add('hidden');
  },

  hideLoading() {
    const loading = document.getElementById('rub-loading');
    if (loading) loading.classList.add('hidden');
  },

  attachSession() {
    if (!window.RubSession || typeof window.RubSession.attach !== 'function') return;
    try {
      window.RubSession.attach(this);
    } catch (e) {
      // The legacy arrangement flow must keep working even if the session
      // controller fails to initialise (for example on an older browser).
      if (window.console && console.warn) console.warn('RubSession failed', e);
    }
  },

  showInactive() {
    this.hideLoading();
    const root = document.getElementById('rub-root');
    const inactive = document.getElementById('rub-inactive');
    const dock = document.getElementById('rub-dock');
    if (root) root.classList.add('hidden');
    if (inactive) inactive.classList.remove('hidden');
    if (dock) dock.classList.add('hidden');
  },

  /* ---------------- Rendering ---------------- */

  render() {
    const root = document.getElementById('rub-root');
    if (!root || !this.rub) {
      this.showInactive();
      return;
    }
    root.classList.remove('hidden');

    const badge = document.getElementById('page-task-badge');
    if (badge) {
      badge.innerHTML = '🟢 ' + this.esc(this.t('task_rub_title', {}, 'تثبيت الربع'));
    }

    const label = document.getElementById('rub-label');
    if (label) {
      label.textContent = this.t('rub_quarter_label', {}, 'الربع') + ' ' + this.rub.id;
    }

    const refs = document.getElementById('rub-refs');
    if (refs) {
      refs.textContent =
        this.t('rub_from', {}, 'من') + ' ' + this.refLabel(this.rub.start.surah, this.rub.start.ayah) +
        ' ' + this.t('rub_to', {}, 'إلى') + ' ' + this.refLabel(this.rub.end.surah, this.rub.end.ayah);
    }

    const juz = document.getElementById('rub-chip-juz');
    if (juz) juz.textContent = this.t('rub_juz', {}, 'الجزء') + ' ' + this.rub.juz;

    const pages = document.getElementById('rub-chip-pages');
    if (pages) {
      pages.textContent = this.rub.start_page === this.rub.end_page
        ? this.t('rub_page_one', {}, 'صفحة') + ' ' + this.rub.start_page
        : this.t('rub_pages_range', {}, 'صفحات') + ' ' + this.rub.start_page + '–' + this.rub.end_page;
    }

    const versesChip = document.getElementById('rub-chip-verses');
    if (versesChip) {
      versesChip.textContent = this.verses.length + ' ' + this.t('rub_verses_unit', {}, 'آية');
    }

    this.updateCarryChip();
    this.renderRail();
    this.renderStage();
    this.updateProgress();
    this.updateHeroCompletionUI(!!(this.taskCompletedOnServer || (this.task && this.task.is_completed)));

    const dock = document.getElementById('rub-dock');
    if (dock) {
      const practiceActive = !window.RubSession || window.RubSession.activeTab === 'practice';
      dock.classList.toggle('hidden', !practiceActive);
    }

    // Optional microphone self-test. It owns its own overlay and reads the
    // same verse payload; it never changes the arrangement progress.
    this.mountRecitation();
  },

  mountRecitation() {
    if (window.RubRecitation && typeof window.RubRecitation.attach === 'function') {
      try {
        window.RubRecitation.attach(this);
      } catch (e) {
        // The microphone test is optional: never break the rub' page for it.
        if (window.console) console.warn('[RubRecitation] attach failed', e);
      }
    }
  },

  updateCarryChip() {
    if (!this.rub) return;
    const carry = document.getElementById('rub-chip-carry');
    if (!carry) return;
    const rolloverCount = Number(this.task && this.task.rollover_count ? this.task.rollover_count : 0);
    const carried = rolloverCount > 0 || this.isCarriedOver();
    carry.classList.toggle('hidden', !carried);
    if (!carried) return;
    carry.textContent = rolloverCount > 0
      ? this.t('task_flag_carried_count', { count: rolloverCount }, `مُرجَّلة ×${rolloverCount}`)
      : this.t('task_flag_carried', {}, 'محولة من أمس');
  },

  isCarriedOver() {
    if (this.task && typeof this.task.carried_over === 'boolean') {
      return this.task.carried_over;
    }
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return this.taskDate !== y + '-' + m + '-' + d;
  },

  activeVerse() {
    return this.verses[this.activeIndex] || null;
  },

  boardFor(verse) {
    const key = this.verseKey(verse);
    if (!this.boards[key]) this.boards[key] = { placed: [] };
    return this.boards[key];
  },

  isVerseDone(verse) {
    return !!verse && this.completed.has(this.verseKey(verse));
  },

  buildPool(verse) {
    const key = this.verseKey(verse);
    if (this.pools[key]) return this.pools[key];

    const tokens = [];
    (verse.words || []).forEach((word) => {
      tokens.push({
        id: 'w' + Number(word.i),
        text: String(word.text || ''),
        index: Number(word.i),
        correct: true,
      });
    });
    (verse.distractors || []).forEach((text, index) => {
      tokens.push({
        id: 'd' + index,
        text: String(text || ''),
        index: null,
        correct: false,
      });
    });

    this.pools[key] = rubShuffle(tokens, rubHashString(key));
    return this.pools[key];
  },

  renderRail() {
    const rail = document.getElementById('rub-verse-rail');
    if (!rail) return;

    rail.innerHTML = this.verses.map((verse, index) => {
      const done = this.isVerseDone(verse);
      const active = index === this.activeIndex;
      const label = this.refLabel(verse.surah, verse.ayah);
      return `
        <button type="button"
                class="rub-rail-chip${done ? ' is-done' : ''}${active ? ' is-active' : ''}"
                data-index="${index}"
                role="listitem"
                aria-current="${active ? 'step' : 'false'}"
                title="${this.esc(label)}">
          <span class="rub-rail-no">${index + 1}</span>
          <span class="rub-rail-ayah">${this.esc(this.t('rub_ayah_short', { ayah: verse.ayah }, 'آية ' + verse.ayah))}</span>
          ${done ? '<span class="rub-rail-check" aria-hidden="true">✓</span>' : ''}
        </button>`;
    }).join('');

    const count = document.getElementById('rub-rail-count');
    if (count) {
      count.textContent = this.completed.size + ' / ' + this.verses.length;
    }

    const activeChip = rail.querySelector('.rub-rail-chip.is-active');
    if (activeChip) {
      requestAnimationFrame(() => {
        try {
          activeChip.scrollIntoView({ block: 'nearest', inline: 'center' });
        } catch (e) {
          const target = activeChip.offsetLeft - (rail.clientWidth - activeChip.offsetWidth) / 2;
          rail.scrollLeft = Math.max(0, target);
        }
      });
    }
  },

  renderStage() {
    const stage = document.getElementById('rub-stage');
    if (!stage) return;
    const verse = this.activeVerse();
    if (!verse) {
      stage.innerHTML = '';
      return;
    }

    const done = this.isVerseDone(verse);
    const surahName = window.I18N && typeof I18N.getSurahName === 'function'
      ? I18N.getSurahName(verse.surah)
      : ('سورة ' + verse.surah);
    const page = verse.page
      ? `<span class="rub-stage-page">${this.esc(this.t('page_prefix', {}, 'صفحة '))}${verse.page}</span>`
      : '';
    const total = this.verses.length;

    stage.innerHTML = `
      <article class="rub-stage-card${done ? ' is-done' : ''}" data-verse-key="${this.esc(this.verseKey(verse))}">
        <header class="rub-stage-head">
          <div class="rub-stage-title">
            <span class="rub-stage-surah">${this.esc(surahName)}</span>
            <span class="rub-stage-ref">${this.esc(this.t('rub_ayah', {}, 'الآية'))} ${verse.ayah}</span>
            ${page}
          </div>
          <div class="rub-stage-nav">
            <button type="button" class="rub-nav-btn" data-rub-act="prev" ${this.activeIndex <= 0 ? 'disabled' : ''}>
              ${this.esc(this.t('rub_prev_verse', {}, 'السابقة'))}
            </button>
            <button type="button" class="rub-nav-btn" data-rub-act="next" ${this.activeIndex >= total - 1 ? 'disabled' : ''}>
              ${this.esc(this.t('rub_next_verse', {}, 'التالية'))}
            </button>
          </div>
        </header>

        ${done ? `
          <div class="rub-stage-success" role="status">
            <span class="rub-stage-success-icon" aria-hidden="true">✓</span>
            <div>
              <strong>${this.esc(this.t('rub_verse_done', {}, 'أتممت ترتيب هذه الآية'))}</strong>
              <p>${this.esc(this.t('rub_verse_done_hint', {}, 'يمكنك الانتقال إلى الآية التالية، أو إعادة ترتيبها للتثبيت.'))}</p>
            </div>
          </div>` : ''}

        <div class="rub-board${done ? ' is-done' : ''}">
          <div class="rub-board-head">
            <div>
              <strong>${this.esc(done ? this.t('rub_verse_text_label', {}, 'نص الآية') : this.t('rub_arrange_title', {}, 'رتّب كلمات الآية'))}</strong>
              <p class="rub-board-hint" id="rub-board-status"></p>
            </div>
            <span class="rub-word-count" id="rub-word-count"></span>
          </div>

          <div class="rub-answer" id="rub-answer" aria-live="polite"></div>
          <div class="rub-bank" id="rub-bank"></div>

          <div class="rub-board-foot">
            <button type="button" class="btn btn-ghost rub-board-btn" data-rub-act="undo" id="rub-undo-word">
              ↩ ${this.esc(this.t('rub_undo_word', {}, 'تراجع' ))}
            </button>
            <button type="button" class="btn btn-ghost rub-board-btn" data-rub-act="reset" id="rub-reset-verse">
              ↺ ${this.esc(done ? this.t('rub_reset_verse_done', {}, 'أعد الترتيب') : this.t('rub_reset_verse', {}, 'إعادة'))}
            </button>
          </div>
        </div>

        ${this.renderTafsir(verse)}
      </article>`;

    const details = stage.querySelector('details.rub-tafsir');
    if (details) {
      details.addEventListener('toggle', () => {
        this.tafsirOpen[this.verseKey(verse)] = !!details.open;
      });
    }

    this.paintBoard();
  },

  paintBoard() {
    const verse = this.activeVerse();
    if (!verse) return;
    const board = this.boardFor(verse);
    const done = this.isVerseDone(verse);
    const placed = board.placed.map((index) => verse.words[index]).filter(Boolean);
    const total = verse.words.length;

    const answer = document.getElementById('rub-answer');
    if (answer) {
      if (placed.length) {
        answer.innerHTML = placed.map((word, index) => `
          <span class="rub-placed-word${done ? ' is-final' : ''}" data-order="${index + 1}">
            ${this.esc(word.text)}
            ${done ? '' : '<span class="rub-placed-x" aria-hidden="true">×</span>'}
          </span>`).join('');
      } else {
        answer.innerHTML = `<span class="rub-answer-placeholder">${this.esc(this.t('rub_answer_placeholder', {}, 'ابدأ بالكلمة الأولى من الآية…'))}</span>`;
      }
    }

    const bank = document.getElementById('rub-bank');
    if (bank) {
      if (done) {
        bank.innerHTML = '';
      } else {
        const placedSet = new Set(board.placed);
        const tokens = this.buildPool(verse).filter((token) => !(token.correct && placedSet.has(token.index)));
        bank.innerHTML = tokens.map((token) => `
          <button type="button" class="rub-token" data-token="${this.esc(token.id)}" lang="ar" dir="rtl">
            ${this.esc(token.text)}
          </button>`).join('');
      }
    }

    const status = document.getElementById('rub-board-status');
    if (status) {
      status.textContent = done
        ? this.t('rub_verse_done_short', {}, 'تم ترتيب الآية كاملة ✓')
        : this.t('rub_arrange_hint', {}, 'اضغط الكلمات بالترتيب. الكلمة الخاطئة تهتز وتبقى في مكانها.');
    }

    const count = document.getElementById('rub-word-count');
    if (count) count.textContent = placed.length + ' / ' + total;

    const undo = document.getElementById('rub-undo-word');
    if (undo) undo.disabled = done || placed.length === 0;
  },

  tafsirForVerse(verse) {
    const ar = verse && verse.tafsir_ar ? String(verse.tafsir_ar).trim() : '';
    const en = verse && verse.tafsir_en ? String(verse.tafsir_en).trim() : '';
    const wantsEnglish = this.isEnglish();

    if (wantsEnglish) {
      if (en) return { text: en, lang: 'en', dir: 'ltr' };
      if (ar) return { text: ar, lang: 'ar', dir: 'rtl' };
    } else {
      if (ar) return { text: ar, lang: 'ar', dir: 'rtl' };
      if (en) return { text: en, lang: 'en', dir: 'ltr' };
    }

    return null;
  },

  renderTafsir(verse) {
    const tafsir = this.tafsirForVerse(verse);
    if (!tafsir) return '';

    const key = this.verseKey(verse);
    const open = this.tafsirOpen[key] ? ' open' : '';
    const title = this.t('rub_tafsir_title', {}, 'تفسير الآية');
    const source = this.t('rub_tafsir_source', {}, 'المختصر في التفسير');

    return `
      <details class="rub-tafsir" data-tafsir-key="${this.esc(key)}"${open}>
        <summary class="rub-tafsir-summary">
          <svg class="rub-tafsir-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <span class="rub-tafsir-title">${this.esc(title)}</span>
          <span class="rub-tafsir-source">${this.esc(source)}</span>
          <svg class="rub-tafsir-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </summary>
        <div class="rub-tafsir-body" lang="${this.esc(tafsir.lang)}" dir="${this.esc(tafsir.dir)}">${this.esc(tafsir.text)}</div>
      </details>`;
  },

  updateProgress() {
    const total = this.verses.length;
    const done = this.completed.size;
    const isTaskDone = (total > 0 && done >= total) || !!this.taskCompletedOnServer || !!(this.task && this.task.is_completed);
    const percent = isTaskDone ? 100 : (total > 0 ? Math.round((done / total) * 100) : 0);
    const allDone = total > 0 && done >= total;

    const percentEl = document.getElementById('rub-percent');
    if (percentEl) percentEl.textContent = percent + '%';

    const ring = document.getElementById('rub-ring-fg');
    if (ring) {
      const c = 2 * Math.PI * 18;
      ring.style.strokeDasharray = String(c);
      ring.style.strokeDashoffset = String(c * (1 - percent / 100));
    }

    const hero = document.getElementById('rub-hero');
    if (hero) hero.classList.toggle('is-complete', isTaskDone);

    const endCard = document.getElementById('rub-end-card');
    if (endCard) endCard.classList.toggle('hidden', !allDone);

    const step1 = document.getElementById('rub-step-1');
    const step2 = document.getElementById('rub-step-2');
    const step3 = document.getElementById('rub-step-3');
    if (step1) step1.classList.add('is-on');
    if (step2) step2.classList.toggle('is-on', done > 0 || isTaskDone);
    if (step3) step3.classList.toggle('is-on', isTaskDone);

    this.updateDock();
    this.updateHeroCompletionUI(isTaskDone);

    if (!allDone) {
      this.completedShown = false;
    } else if (!this.completedShown) {
      this.completedShown = true;
      this.celebrate();
    }
  },

  updateDock() {
    const total = this.verses.length;
    const done = this.completed.size;
    const allDone = total > 0 && done >= total;
    const verse = this.activeVerse();
    const verseDone = verse ? this.isVerseDone(verse) : false;

    const count = document.getElementById('rub-dock-count');
    if (count) count.textContent = done + ' / ' + total;

    const next = document.getElementById('rub-dock-next');
    if (next) {
      if (allDone) {
        next.textContent = this.t('rub_all_done', {}, 'تم تثبيت الربع');
      } else if (verse) {
        next.textContent = this.refLabel(verse.surah, verse.ayah);
      } else {
        next.textContent = '';
      }
    }

    const action = document.getElementById('rub-dock-action');
    const btn = document.getElementById('btn-dock-next');
    if (action) {
      action.textContent = allDone
        ? this.t('rub_all_done', {}, 'تم تثبيت الربع')
        : (verseDone
            ? this.t('rub_next_verse', {}, 'الآية التالية')
            : this.t('rub_finish_arrange', {}, 'رتّب كلمات الآية'));
    }
    if (btn) {
      btn.disabled = allDone || !verseDone;
    }
  },

  /* ---------------- Actions ---------------- */

  selectVerse(index, scroll) {
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= this.verses.length) return;
    this.activeIndex = next;
    this.renderRail();
    this.renderStage();
    this.updateDock();

    if (scroll) {
      const stage = document.getElementById('rub-stage');
      if (stage) {
        const rect = stage.getBoundingClientRect();
        if (rect.top < 90 || rect.top > window.innerHeight * 0.6) {
          stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  },

  firstIncomplete() {
    for (let i = 0; i < this.verses.length; i++) {
      if (!this.isVerseDone(this.verses[i])) return i;
    }
    return -1;
  },

  nextIncompleteIndex(afterIndex) {
    const total = this.verses.length;
    for (let step = 1; step <= total; step++) {
      const index = (afterIndex + step) % total;
      if (!this.isVerseDone(this.verses[index])) return index;
    }
    return -1;
  },

  nextVerse() {
    const target = this.nextIncompleteIndex(this.activeIndex);
    if (target >= 0) {
      this.selectVerse(target, true);
      return;
    }
    // All complete: advance sequentially for review.
    if (this.activeIndex < this.verses.length - 1) {
      this.selectVerse(this.activeIndex + 1, true);
    }
  },

  prevVerse() {
    if (this.activeIndex > 0) {
      this.selectVerse(this.activeIndex - 1, true);
    }
  },

  placeToken(tokenId) {
    const verse = this.activeVerse();
    if (!verse || this.isVerseDone(verse)) return;
    const board = this.boardFor(verse);
    const token = this.buildPool(verse).find((item) => item.id === tokenId);
    if (!token) return;

    if (token.correct && token.index === board.placed.length) {
      board.placed.push(token.index);
      this.boards[this.verseKey(verse)] = board;

      if (board.placed.length >= verse.words.length) {
        this.completeVerse(verse);
        return;
      }

      this.persistLocal();
      this.paintBoard();
      if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') {
        AudioEngine.playSuccess();
      }
      return;
    }

    // Wrong word (a distractor, or a correct word placed too early): only this
    // token reacts. Nothing already placed is removed and the bank is not
    // re-scattered.
    this.flashWrong(tokenId);
  },

  flashWrong(tokenId) {
    const token = document.querySelector('.rub-token[data-token="' + this.cssEscape(tokenId) + '"]');
    if (token) {
      token.classList.remove('is-wrong');
      // Force the animation to restart if the same token is tapped again.
      void token.offsetWidth;
      token.classList.add('is-wrong');
      window.setTimeout(() => token.classList.remove('is-wrong'), 650);
    }

    const status = document.getElementById('rub-board-status');
    if (status) {
      status.textContent = this.t('rub_wrong_word', {}, 'ليست الكلمة التالية — جرّب كلمة أخرى.');
      status.classList.add('is-wrong');
      clearTimeout(this.wrongTimer);
      this.wrongTimer = window.setTimeout(() => {
        status.classList.remove('is-wrong');
        this.paintBoard();
      }, 1600);
    }
  },

  completeVerse(verse) {
    const key = this.verseKey(verse);
    if (this.completed.has(key)) return;

    this.completed.add(key);
    this.persistLocal();
    if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') {
      AudioEngine.playSuccess();
    }

    this.renderRail();
    this.updateProgress();
    this.renderStage();
    this.scheduleSync();

    const index = this.verses.findIndex((item) => this.verseKey(item) === key);
    if (index >= 0 && index < this.verses.length - 1 && this.completed.size < this.verses.length) {
      showToast(this.t('rub_verse_saved_toast', {}, 'تم ترتيب الآية ✓ — انتقل إلى الآية التالية.'), false);
    }
  },

  undoWord() {
    const verse = this.activeVerse();
    if (!verse || this.isVerseDone(verse)) return;
    const board = this.boardFor(verse);
    if (!board.placed.length) return;

    board.placed.pop();
    this.persistLocal();
    this.paintBoard();
    if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
      AudioEngine.playUndo();
    }
  },

  resetVerse() {
    const verse = this.activeVerse();
    if (!verse) return;
    const key = this.verseKey(verse);
    const wasDone = this.completed.has(key);

    if (wasDone) {
      const ok = window.confirm(this.t('rub_reset_verse_confirm', {}, 'إعادة ترتيب هذه الآية؟ سيُلغى تعليمها كمكتملة.'));
      if (!ok) return;
    }

    this.boards[key] = { placed: [] };
    if (wasDone) this.completed.delete(key);
    this.persistLocal();

    this.renderRail();
    this.updateProgress();
    this.renderStage();
    if (wasDone) this.scheduleSync();
  },

  resetAll() {
    const ok = window.confirm(this.t('rub_reset_confirm', {}, 'هل تريد إعادة ضبط الربع كاملاً والبدء من جديد؟'));
    if (!ok) return;

    this.completed = new Set();
    this.boards = {};
    this.verses.forEach((verse) => {
      this.boards[this.verseKey(verse)] = { placed: [] };
    });
    this.pools = {};
    this.tafsirOpen = {};
    this.completedShown = false;
    this.activeIndex = 0;

    try {
      localStorage.removeItem('hifz-rub-celebrated-' + this.taskId);
    } catch (e) {}

    this.persistLocal();
    this.renderRail();
    this.renderStage();
    this.updateProgress();
    this.syncNow();
  },

  celebrate() {
    const modal = document.getElementById('rub-complete-modal');
    if (!modal) return;

    try {
      const seen = localStorage.getItem('hifz-rub-celebrated-' + this.taskId);
      if (seen === this.taskDate) return;
      localStorage.setItem('hifz-rub-celebrated-' + this.taskId, this.taskDate);
    } catch (e) {}

    if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
      AudioEngine.playCelebration();
    }

    const desc = document.getElementById('rub-complete-desc');
    if (desc) {
      desc.textContent =
        this.t('rub_complete_desc', {}, 'رتّبت كلمات كل آية في ربع اليوم وثبّتّها بالتلاوة. تقبّل الله منك.') +
        ' ' + (this.t('rub_quarter_label', {}, 'الربع') + ' ' + this.rub.id) + '.';
    }
    const verses = document.getElementById('rub-complete-verses');
    if (verses) verses.textContent = this.verses.length;

    modal.classList.remove('hidden');
  },

  closeComplete() {
    const modal = document.getElementById('rub-complete-modal');
    if (modal) modal.classList.add('hidden');
  },

  updateHeroCompletionUI(isDone) {
    const btn = document.getElementById('btn-complete-rub');
    if (btn) {
      btn.disabled = !!isDone;
      const label = btn.querySelector('[data-i18n]') || btn;
      label.textContent = isDone
        ? '✓ ' + this.t('rub_summary_task_done', {}, 'تم تسجيل إتمام مهمة تثبيت الربع لليوم')
        : this.t('rub_summary_mark_done', {}, 'تم تثبيت الربع الحالي');
    }
    const sessionMarkDone = document.getElementById('rub-session-mark-done');
    if (sessionMarkDone) {
      sessionMarkDone.disabled = !!isDone;
      sessionMarkDone.textContent = isDone
        ? '✓ ' + this.t('rub_summary_task_done', {}, 'تم تسجيل إتمام مهمة تثبيت الربع لليوم')
        : this.t('rub_summary_mark_done', {}, 'تم تثبيت الربع الحالي');
    }
    const hero = document.getElementById('rub-hero');
    if (hero && isDone) hero.classList.add('is-complete');
    const step3 = document.getElementById('rub-step-3');
    if (step3 && isDone) step3.classList.add('is-on');
  },

  async markDone() {
    if (!this.taskId) return;
    const btn = document.getElementById('btn-complete-rub');
    const sessionBtn = document.getElementById('rub-session-mark-done');
    if (btn) btn.disabled = true;
    if (sessionBtn) sessionBtn.disabled = true;

    try {
      const data = await API.call('tasks/rub_session.php', {
        method: 'POST',
        redirectOn401: true,
        body: {
          action: 'COMPLETE',
          task_id: this.taskId,
        },
      });

      if (data && data.success) {
        this.taskCompletedOnServer = true;
        if (this.task) {
          this.task.is_completed = true;
        }
        if (window.RubSession) {
          if (RubSession.state && RubSession.state.task) {
            RubSession.state.task.is_completed = true;
          }
          if (data.state) {
            RubSession.state = data.state;
          }
          RubSession.syncHeroProgress();
          if (RubSession.activeTab === 'session') {
            RubSession.renderHome();
          }
        }
        this.updateProgress();
        this.updateHeroCompletionUI(true);
        if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
          try { AudioEngine.playCelebration(); } catch (e) {}
        }
        showToast(this.t('rub_summary_mark_done_success', {}, 'تم تسجيل إتمام الربع الحالي'));
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      if (sessionBtn) sessionBtn.disabled = false;
      showToast((err && err.message) || 'Error completing rub', true);
    }
  },

  /* ---------------- Sync ---------------- */

  completedList() {
    return this.verses
      .filter((verse) => this.completed.has(this.verseKey(verse)))
      .map((verse) => this.verseKey(verse));
  },

  scheduleSync() {
    if (!this.taskId) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.syncNow(), 650);
  },

  async syncNow() {
    if (!this.taskId) return;
    if (this.saving) {
      this.queued = true;
      return;
    }

    const payload = { task_id: this.taskId, completed: this.completedList() };
    this.saving = true;

    try {
      const res = await API.call('tasks/update_rub.php', {
        method: 'POST',
        body: payload,
        redirectOn401: true,
      });
      this.offlineNotified = false;
      if (res && res.is_completed) {
        this.taskCompletedOnServer = true;
      }
      this.removeFromQueue(this.taskId);
    } catch (err) {
      if (err && err.status === 401) return;
      this.enqueue(payload);
      if (!this.offlineNotified) {
        this.offlineNotified = true;
        showToast(this.t('rub_offline_saved', {}, 'تم الحفظ محليًا — ستتم المزامنة عند عودة الاتصال'), true);
      }
    } finally {
      this.saving = false;
      if (this.queued) {
        this.queued = false;
        this.scheduleSync();
      }
    }
  },

  readQueue() {
    try {
      const raw = localStorage.getItem(RUB_QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  writeQueue(queue) {
    try {
      localStorage.setItem(RUB_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {}
  },

  enqueue(payload) {
    const queue = this.readQueue();
    queue[String(payload.task_id)] = payload;
    this.writeQueue(queue);
  },

  removeFromQueue(taskId) {
    const queue = this.readQueue();
    delete queue[String(taskId)];
    this.writeQueue(queue);
  },

  async flushQueue() {
    if (!navigator.onLine) return;
    const queue = this.readQueue();
    const ids = Object.keys(queue);
    if (!ids.length) return;

    for (const id of ids) {
      try {
        await API.call('tasks/update_rub.php', {
          method: 'POST',
          body: queue[id],
          redirectOn401: true,
        });
        delete queue[id];
        this.writeQueue(queue);
      } catch (e) {
        // A deleted task (plan change / account reset) can never be synced.
        if (e && e.status === 404) {
          delete queue[id];
          this.writeQueue(queue);
          continue;
        }
        break;
      }
    }
  },

  cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  },

  bindUI() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;

      const token = target.closest('.rub-token');
      if (token) {
        event.preventDefault();
        this.placeToken(token.dataset.token);
        return;
      }

      const chip = target.closest('.rub-rail-chip');
      if (chip) {
        event.preventDefault();
        this.selectVerse(Number(chip.dataset.index), true);
        return;
      }

      const act = target.closest('[data-rub-act]');
      if (act) {
        const action = act.dataset.rubAct;
        event.preventDefault();
        if (action === 'prev') this.prevVerse();
        else if (action === 'next') this.nextVerse();
        else if (action === 'undo') this.undoWord();
        else if (action === 'reset') this.resetVerse();
        return;
      }

      // Tapping a placed word removes it and everything after it, so a single
      // misordered word can be corrected without restarting the verse.
      const placedWord = target.closest('.rub-placed-word');
      if (placedWord && !placedWord.classList.contains('is-final')) {
        const verse = this.activeVerse();
        if (!verse || this.isVerseDone(verse)) return;
        const order = Number(placedWord.dataset.order);
        if (!Number.isInteger(order) || order < 1) return;
        const board = this.boardFor(verse);
        board.placed = board.placed.slice(0, order - 1);
        this.persistLocal();
        this.paintBoard();
        if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
          AudioEngine.playUndo();
        }
      }
    });

    const dockNext = document.getElementById('btn-dock-next');
    if (dockNext) {
      dockNext.addEventListener('click', () => {
        const verse = this.activeVerse();
        if (verse && this.isVerseDone(verse)) this.nextVerse();
      });
    }

    const completeRub = document.getElementById('btn-complete-rub');
    if (completeRub) {
      completeRub.addEventListener('click', () => this.markDone());
    }

    const resetAll = document.getElementById('btn-reset-rub');
    if (resetAll) resetAll.addEventListener('click', () => this.resetAll());

    const closeComplete = document.getElementById('btn-rub-close-complete');
    if (closeComplete) closeComplete.addEventListener('click', () => this.closeComplete());

    const modal = document.getElementById('rub-complete-modal');
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) this.closeComplete();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeComplete();
    });

    window.addEventListener('online', async () => {
      await this.flushQueue();
      if (this.taskId) this.syncNow();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.syncNow();
    });

    window.addEventListener('beforeunload', () => {
      if (!this.taskId) return;
      const payload = { task_id: this.taskId, completed: this.completedList() };
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('../api/tasks/update_rub.php', blob);
      } catch (e) {}
    });

    if (window.I18N) {
      I18N.onChange(() => {
        if (this.rub) this.render();
      });
    }
  },
};

window.RubPage = RubPage;

document.addEventListener('DOMContentLoaded', () => {
  RubPage.boot();
});
