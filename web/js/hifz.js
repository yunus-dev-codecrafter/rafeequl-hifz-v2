'use strict';

/* ==========================================================================
   Rafeequl Hifz — HIFZ_JADID verse-by-verse memorization room

   The page is deliberately a single active verse at a time:
     • repeat the current verse 20 times alone
     • after verse 2+, join it with the previous verse 20 times (adjacent pair)
     • after the final pair, recite the whole page once, then mark the task done

   Progress is kept in localStorage immediately and mirrored to
   api/tasks/update_hifz_progress.php with a debounce. The actual task
   completion still goes through update_progress.php, which validates that the
   saved state really contains 20 repetitions for every verse, 20 for every
   adjacent pair, and the full-page pass.
   ========================================================================== */

const HIFZ_REPS_TARGET = 20;
const HIFZ_PAIR_TARGET = 20;
const HIFZ_PAGE_PASS_TARGET = 1;
const HIFZ_STATE_VERSION = 2;
const HIFZ_LOCAL_PREFIX = 'rh_hifz_verse_v2_';
const HIFZ_LEGACY_LOCAL_PREFIX = 'rh_hifz_verse_v1_';
const HIFZ_TEXT_HIDDEN_KEY = 'rh_hifz_text_hidden';

function hifzT(key, params, fallback) {
  if (window.I18N && typeof I18N.t === 'function') {
    const value = I18N.t(key, params || {});
    if (value != null && value !== key) return value;
  }
  return fallback;
}

function hifzEsc(value) {
  if (typeof esc === 'function') return esc(value);
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function hifzIsEnglish() {
  return !!(window.I18N && I18N.lang === 'en');
}

function hifzSurahName(id) {
  if (window.I18N && typeof I18N.getSurahName === 'function') {
    return I18N.getSurahName(id);
  }
  const list = window.SURAHS_DATA || [];
  const surah = list.find((s) => s.id === Number(id));
  return surah ? (surah.name_ar || surah.name || String(id)) : String(id);
}

function hifzNewState(page, total) {
  return {
    v: HIFZ_STATE_VERSION,
    page,
    reps: Array(total).fill(0),
    links: Array(total).fill(0),
    page_pass: 0,
    current: 0,
    phase: 'repeat',
    complete: false,
  };
}

function hifzScore(state) {
  if (!state || !Array.isArray(state.reps) || !Array.isArray(state.links)) return -1;
  let score = 0;
  state.reps.forEach((value) => { score += Math.max(0, Math.min(HIFZ_REPS_TARGET, Number(value) || 0)); });
  state.links.forEach((value) => { score += Math.max(0, Math.min(HIFZ_PAIR_TARGET, Number(value) || 0)); });
  score += Math.max(0, Math.min(1, Number(state.page_pass) || 0)) * 100;
  if (state.complete) score += 1000;
  return score;
}

function hifzAllRepsDone(reps) {
  return Array.isArray(reps) && reps.length > 0
    && reps.every((value) => Number(value) >= HIFZ_REPS_TARGET);
}

function hifzAllPairsDone(links) {
  if (!Array.isArray(links) || !links.length) return false;
  for (let i = 1; i < links.length; i++) {
    if (Number(links[i]) < HIFZ_PAIR_TARGET) return false;
  }
  return true;
}

function hifzNormalizeState(raw, page, total) {
  if (!raw || typeof raw !== 'object') return null;
  if (Number(raw.v) !== HIFZ_STATE_VERSION) return null;
  if (Number(raw.page) !== Number(page)) return null;
  if (!Array.isArray(raw.reps) || !Array.isArray(raw.links)) return null;
  if (raw.reps.length !== total || raw.links.length !== total) return null;

  const state = {
    v: HIFZ_STATE_VERSION,
    page,
    reps: raw.reps.map((value) => Math.max(0, Math.min(HIFZ_REPS_TARGET, Number(value) || 0))),
    links: raw.links.map((value) => Math.max(0, Math.min(HIFZ_PAIR_TARGET, Number(value) || 0))),
    page_pass: Math.max(0, Math.min(1, Number(raw.page_pass) || 0)),
    current: Math.max(0, Math.min(total - 1, Number(raw.current) || 0)),
    phase: ['repeat', 'link', 'page', 'complete'].includes(raw.phase) ? raw.phase : 'repeat',
    complete: !!raw.complete,
  };
  state.links[0] = 0;

  const allReps = hifzAllRepsDone(state.reps);
  const allPairs = hifzAllPairsDone(state.links);
  if (allReps && allPairs && state.page_pass >= HIFZ_PAGE_PASS_TARGET) {
    state.complete = true;
    state.phase = 'complete';
    state.current = total - 1;
  } else {
    state.complete = false;
    if (state.phase === 'complete') state.phase = 'repeat';
    if (state.phase === 'page' && !allReps) state.phase = 'repeat';
    if (state.phase === 'link' && state.current < 1) state.phase = 'repeat';
  }

  return state;
}

function hifzStepStats(state, total) {
  if (!state) return { done: 0, total: 0, verses: 0, pairs: 0, pagePass: 0 };
  const verses = state.reps.filter((value) => Number(value) >= HIFZ_REPS_TARGET).length;
  let pairs = 0;
  for (let i = 1; i < state.links.length; i++) {
    if (Number(state.links[i]) >= HIFZ_PAIR_TARGET) pairs++;
  }
  const pagePass = Number(state.page_pass) >= HIFZ_PAGE_PASS_TARGET ? 1 : 0;
  const pairsTotal = Math.max(0, total - 1);
  return {
    done: verses + pairs + pagePass,
    total: total + pairsTotal + 1,
    verses,
    pairs,
    pagePass,
  };
}

const HifzPage = {
  task: null,
  page: 0,
  verses: [],
  quran: null,
  state: null,
  loading: false,
  version: 0,
  textHidden: false,
  dirty: false,
  saving: false,
  saveQueued: false,
  saveTimer: null,
  syncState: 'synced',
  serverReady: true,
  globalBound: false,

  render(task) {
    const container = document.getElementById('task-content');
    if (!container || !task) return;

    const changed = !this.task
      || Number(this.task.id) !== Number(task.id)
      || Number(this.page) !== Number(task.start_page);

    this.task = task;
    this.page = Number(task.start_page) || 0;

    if (!this.globalBound) {
      const flush = () => this.flushOnHide();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      this.globalBound = true;
    }

    if (task.is_completed) {
      this.clearLocal();
      this.state = null;
      this.verses = this.buildVerses(this.page);
      this.paintCompleted(true);
      return;
    }

    if (!changed && this.state && this.verses.length) {
      // Rebuild names so an Arabic/English switch updates surah names without
      // resetting the recitation state.
      this.verses = this.buildVerses(this.page);
      this.paint();
      return;
    }

    this.mount();
  },

  async mount() {
    const container = document.getElementById('task-content');
    if (!container || !this.task) return;

    const version = ++this.version;
    this.loading = true;
    container.innerHTML = `
      <div class="task-page-head hifz-head hifz-loading-card">
        <p class="hint">${hifzEsc(hifzT('hifz_loading', {}, 'Preparing the verse counter…'))}</p>
      </div>`;

    try {
      this.verses = this.buildVerses(this.page);
      if (!this.verses.length) {
        throw new Error(hifzT('hifz_error_no_verses', {}, 'No verses were found for this page.'));
      }

      await this.loadQuran();
      if (version !== this.version) return;

      this.restoreState();
      this.loading = false;
      this.paint();
      if (this.dirty && this.serverReady) {
        this.scheduleSave(500);
      }
    } catch (error) {
      if (version !== this.version) return;
      this.loading = false;
      this.paintError(error);
    }
  },

  buildVerses(page) {
    const sections = (typeof getPageVerseSections === 'function') ? getPageVerseSections(page) : [];
    const verses = [];
    sections.forEach((section) => {
      for (let ayah = Number(section.fromAyah); ayah <= Number(section.toAyah); ayah++) {
        verses.push({
          surah: Number(section.surahId),
          ayah,
          surahName: hifzSurahName(Number(section.surahId)),
        });
      }
    });
    return verses;
  },

  async loadQuran() {
    if (this.quran) return this.quran;

    if (window.PageNotes && typeof PageNotes.loadQuran === 'function') {
      const quran = await PageNotes.loadQuran();
      if (quran) {
        this.quran = quran;
        return quran;
      }
    }

    const response = await fetch('data/quran-uthmani.json', { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(hifzT('hifz_load_error', {}, 'Could not load the verse text.'));
    }
    this.quran = await response.json();
    return this.quran;
  },

  verseText(verse) {
    if (!this.quran || !verse) return '';
    const surah = this.quran[String(verse.surah)];
    return (surah && surah[verse.ayah - 1]) || '';
  },

  localKey() {
    const id = this.task && this.task.id ? String(this.task.id) : ('page-' + this.page);
    return HIFZ_LOCAL_PREFIX + id;
  },

  readLocal() {
    try {
      const raw = localStorage.getItem(this.localKey());
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  },

  writeLocal() {
    if (!this.state) return;
    try {
      localStorage.setItem(this.localKey(), JSON.stringify(this.state));
    } catch (error) {
      /* private mode / storage full: the in-memory copy still works */
    }
  },

  clearLocal() {
    try {
      localStorage.removeItem(this.localKey());
    } catch (error) {}
  },

  clearLegacyLocal() {
    try {
      const id = this.task && this.task.id ? String(this.task.id) : ('page-' + this.page);
      localStorage.removeItem(HIFZ_LEGACY_LOCAL_PREFIX + id);
    } catch (error) {}
  },

  readTextHidden() {
    try {
      return localStorage.getItem(HIFZ_TEXT_HIDDEN_KEY) === '1';
    } catch (error) {
      return false;
    }
  },

  restoreState() {
    const total = this.verses.length;
    this.clearLegacyLocal();

    const serverState = hifzNormalizeState(this.task && this.task.hifz_progress, this.page, total);
    const localState = hifzNormalizeState(this.readLocal(), this.page, total);

    if (hifzScore(localState) > hifzScore(serverState)) {
      this.state = localState;
      this.dirty = true;
      this.syncState = 'pending';
    } else if (serverState) {
      this.state = serverState;
      this.dirty = false;
      this.syncState = 'synced';
    } else {
      this.state = hifzNewState(this.page, total);
      this.dirty = false;
      this.syncState = this.serverReady ? 'synced' : 'local';
    }

    this.textHidden = this.readTextHidden();
    this.writeLocal();
  },

  syncLabel() {
    switch (this.syncState) {
      case 'pending': return hifzT('hifz_sync_pending', {}, 'Saving progress…');
      case 'error': return hifzT('hifz_save_error', {}, 'Progress is saved on this device.');
      case 'local': return hifzT('hifz_local_only', {}, 'Progress is saved on this device.');
      case 'synced': return hifzT('hifz_synced', {}, 'Progress saved ✓');
      default: return '';
    }
  },

  updateSyncDom() {
    const el = document.getElementById('hifz-sync-status');
    if (el) {
      el.textContent = this.syncLabel();
      el.dataset.state = this.syncState;
    }
  },

  scheduleSave(delay = 1100) {
    this.dirty = true;
    this.syncState = this.serverReady && this.task && this.task.id ? 'pending' : 'local';
    this.updateSyncDom();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveNow(true);
    }, delay);
  },

  persistNow() {
    clearTimeout(this.saveTimer);
    this.dirty = true;
    this.syncState = this.serverReady && this.task && this.task.id ? 'pending' : 'local';
    this.writeLocal();
    this.updateSyncDom();
    this.saveNow(true);
  },

  async saveNow(silent = true) {
    if (!this.state || !this.task) return;
    if (!this.task.id) {
      this.syncState = 'local';
      this.updateSyncDom();
      return;
    }
    if (!this.serverReady) {
      this.syncState = 'local';
      this.updateSyncDom();
      return;
    }
    if (this.saving) {
      this.saveQueued = true;
      return;
    }

    this.saving = true;
    this.saveQueued = false;
    try {
      const response = await API.call('tasks/update_hifz_progress.php', {
        method: 'POST',
        body: {
          task_id: this.task.id,
          page: this.page,
          progress: this.state,
        },
        redirectOn401: true,
      });
      if (response && response.progress) {
        this.task.hifz_progress = response.progress;
      }
      this.dirty = false;
      this.syncState = 'synced';
    } catch (error) {
      if (error && error.status === 503 && error.data && error.data.migration_required) {
        this.serverReady = false;
        this.dirty = false;
        this.syncState = 'local';
      } else if (error && error.status === 409 && error.data && error.data.code === 'HIFZ_STATE_VERSION') {
        // The 40x flow changed to 20x + adjacent pairs. Start this page again
        // with the new state; the server keeps the old row untouched.
        this.state = hifzNewState(this.page, this.verses.length);
        this.clearLocal();
        this.writeLocal();
        this.dirty = false;
        this.syncState = 'local';
        showToast(hifzT('hifz_state_outdated', {}, 'The memorization flow changed. Recite the remaining verses again.'), true);
        setTimeout(() => this.paint(), 0);
      } else if (error && error.status === 409) {
        // The page was already completed (for example in another tab); there
        // is nothing left to save.
        this.dirty = false;
        this.syncState = 'synced';
      } else {
        this.dirty = true;
        this.syncState = 'error';
        if (!silent) {
          showToast(hifzT('hifz_save_error', {}, 'Could not save progress.'), true);
        }
      }
    } finally {
      this.saving = false;
      this.updateSyncDom();
      if (this.saveQueued) {
        this.saveQueued = false;
        this.scheduleSave(350);
      }
    }
  },

  flushOnHide() {
    if (!this.dirty || !this.state || !this.task || !this.task.id || !this.serverReady) return;
    clearTimeout(this.saveTimer);
    const body = JSON.stringify({
      task_id: this.task.id,
      page: this.page,
      progress: this.state,
    });
    let sent = false;
    try {
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon(
          '../api/tasks/update_hifz_progress.php',
          new Blob([body], { type: 'application/json' })
        );
      }
    } catch (error) {
      sent = false;
    }
    if (!sent) {
      try {
        fetch('../api/tasks/update_hifz_progress.php', {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body,
        }).catch(() => {});
      } catch (error) {}
    }
    this.dirty = false;
  },

  doneVerses() {
    if (!this.state) return 0;
    return this.state.reps.filter((value) => Number(value) >= HIFZ_REPS_TARGET).length;
  },

  headerHtml() {
    const total = this.verses.length;
    const stats = hifzStepStats(this.state, total);
    const percent = this.state && this.state.complete
      ? 100
      : (stats.total ? Math.round((stats.done / stats.total) * 100) : 0);
    const taskTitle = (hifzIsEnglish() && this.task.title_en) ? this.task.title_en : (this.task.title_ar || '');
    const rangeHint = (typeof formatPageVerseSummary === 'function')
      ? formatPageVerseSummary(this.page, hifzIsEnglish())
      : '';
    const badge = this.state && this.state.complete
      ? hifzT('hifz_completed_title', {}, 'New memorization completed')
      : hifzT('hifz_verses_done', { done: this.doneVerses(), total }, `${this.doneVerses()} of ${total} verses`);
    const rollover = (typeof rolloverNoticeHtml === 'function') ? rolloverNoticeHtml(this.task) : '';

    return `
      ${rollover}
      <div class="task-page-head hifz-head">
        <div class="task-page-title-row">
          <div>
            <h2>${hifzEsc(taskTitle)}</h2>
            <p class="hint">${rangeHint ? hifzEsc(rangeHint) : hifzEsc(hifzT('hifz_stage_meta', { target: HIFZ_REPS_TARGET }, ''))}</p>
          </div>
          <div class="task-page-badge ${this.state && this.state.complete ? 'green' : 'blue'}">
            ${hifzEsc(badge)}
          </div>
        </div>
        <div class="progress-wrap">
          <div class="progress-header">
            <span>${hifzEsc(hifzT('hifz_page_progress', {}, 'Page Memorization Progress'))}</span>
            <span>${percent}% · ${stats.done}/${stats.total}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill fill-green" style="width:${percent}%;"></div>
          </div>
        </div>
        <div class="hifz-sync-status" id="hifz-sync-status" data-state="${this.syncState}">${hifzEsc(this.syncLabel())}</div>
      </div>`;
  },

  railHtml() {
    const total = this.verses.length;
    const active = this.state.current;
    const chips = this.verses.map((verse, index) => {
      const done = Number(this.state.reps[index]) >= HIFZ_REPS_TARGET;
      const paired = index > 0 && Number(this.state.links[index]) >= HIFZ_PAIR_TARGET;
      const current = index === active && this.state.phase !== 'page' && this.state.phase !== 'complete';
      return `
        <span class="hifz-verse-chip ${done ? 'is-done' : ''} ${paired ? 'is-linked' : ''} ${current ? 'is-active' : ''}"
              ${current ? 'aria-current="step"' : ''}
              title="${hifzEsc(`${verse.surahName} · ${verse.surah}:${verse.ayah}`)}">
          ${index + 1}
          ${paired ? '<span class="hifz-chip-check" aria-hidden="true">✓✓</span>' : (done ? '<span class="hifz-chip-check" aria-hidden="true">✓</span>' : '')}
        </span>`;
    }).join('');

    return `
      <div class="hifz-rail-wrap">
        <div class="hifz-rail-head">
          <span>${hifzEsc(hifzT('hifz_verse_rail_label', {}, 'Page verses'))}</span>
          <span>${hifzEsc(hifzT('hifz_verse_of', { current: Math.min(active + 1, total), total }, `${active + 1} of ${total}`))}</span>
        </div>
        <div class="hifz-rail" id="hifz-verse-rail">${chips}</div>
      </div>`;
  },

  activeHeadHtml(verse, showTextToggle = true) {
    const ref = hifzT(
      'hifz_verse_ref',
      { surah: verse.surahName, ayah: verse.ayah },
      `${verse.surahName} · ${verse.surah}:${verse.ayah}`
    );
    const toggleLabel = this.textHidden
      ? hifzT('hifz_show_text', {}, 'Show text')
      : hifzT('hifz_hide_text', {}, 'Hide text');
    return `
      <div class="hifz-active-head">
        <div>
          <span class="hifz-verse-surah">${hifzEsc(verse.surahName)}</span>
          <span class="hifz-verse-ref">${hifzEsc(ref)}</span>
        </div>
        <div class="hifz-verse-tools">
          <button type="button" id="hifz-play-verse" class="hifz-text-toggle" title="${hifzEsc(hifzT('hifz_play_verse', {}, 'Listen'))}">🔊</button>
          ${showTextToggle ? `<button type="button" id="hifz-toggle-text" class="hifz-text-toggle">${hifzEsc(toggleLabel)}</button>` : ''}
        </div>
      </div>`;
  },

  counterHtml(rep, target, label, hint) {
    const fill = Math.max(0, Math.min(100, Math.round((rep / target) * 100)));
    return `
      <div class="hifz-counter" aria-live="polite">
        <div class="hifz-counter-num" id="hifz-rep-number">${rep}</div>
        <div class="hifz-counter-body">
          <div class="hifz-counter-label">
            <span>${hifzEsc(label)}</span>
            <span>${hifzEsc(hifzT('hifz_reps_of', { target }, `of ${target}`))}</span>
          </div>
          <div class="hifz-meter"><div class="hifz-meter-fill" id="hifz-rep-fill" style="width:${fill}%;"></div></div>
          <div class="hifz-counter-meta">${hifzEsc(hint)}</div>
        </div>
      </div>`;
  },

  repeatHtml() {
    const verse = this.verses[this.state.current];
    const rep = Number(this.state.reps[this.state.current]) || 0;
    const text = this.verseText(verse);
    return `
      <div class="hifz-active">
        ${this.activeHeadHtml(verse, true)}
        <p class="hifz-verse-text ${this.textHidden ? 'is-hidden' : ''}" id="hifz-verse-text" dir="rtl">${hifzEsc(text) || '…'}</p>
        ${this.counterHtml(
          rep,
          HIFZ_REPS_TARGET,
          hifzT('hifz_reps_label', {}, 'Repetitions'),
          hifzT('hifz_repeat_hint', { target: HIFZ_REPS_TARGET }, '')
        )}
      </div>`;
  },

  linkRef(verse) {
    return hifzT(
      'hifz_verse_ref',
      { surah: verse.surahName, ayah: verse.ayah },
      `${verse.surahName} · ${verse.surah}:${verse.ayah}`
    );
  },

  pairHtml() {
    const index = this.state.current;
    const previous = this.verses[index - 1];
    const current = this.verses[index];
    if (!previous || !current) return this.repeatHtml();
    const rep = Number(this.state.links[index]) || 0;
    const heading = hifzT('hifz_pair_phase', {}, 'Recite the two verses together');
    const hint = hifzT(
      'hifz_pair_hint',
      { from: previous.ayah, to: current.ayah, target: HIFZ_PAIR_TARGET },
      `Recite verse ${previous.ayah} and verse ${current.ayah} together ${HIFZ_PAIR_TARGET} times.`
    );

    const block = (verse, kicker) => `
      <div class="hifz-link-verse">
        <span class="hifz-link-ref">${hifzEsc(kicker)} · ${hifzEsc(this.linkRef(verse))}</span>
        <p dir="rtl">${hifzEsc(this.verseText(verse)) || '…'}</p>
      </div>`;

    return `
      <div class="hifz-active hifz-link-panel">
        <div class="hifz-link-head">
          <span class="hifz-link-kicker">🔗</span>
          <div>
            <strong>${hifzEsc(heading)}</strong>
            <div class="hifz-link-range">${hifzEsc(hifzT('hifz_verse_of', { current: index + 1, total: this.verses.length }, `${index + 1} of ${this.verses.length}`))}</div>
          </div>
        </div>
        <p class="hifz-link-hint">${hifzEsc(hint)}</p>
        <div class="hifz-link-list">
          ${block(previous, hifzT('hifz_pair_previous', {}, 'Previous'))}
          ${block(current, hifzT('hifz_pair_current', {}, 'Current'))}
        </div>
        ${this.counterHtml(
          rep,
          HIFZ_PAIR_TARGET,
          hifzT('hifz_pair_reps_label', {}, 'Joined recitations'),
          hifzT('hifz_repeat_hint', { target: HIFZ_PAIR_TARGET }, '')
        )}
      </div>`;
  },

  pageHtml() {
    const heading = hifzT('hifz_page_phase', {}, 'Full-Page Recitation');
    const hint = hifzT(
      'hifz_page_hint',
      { total: this.verses.length },
      'Recite the whole page from the first verse to the last verse, connected, once.'
    );
    const list = this.verses.map((verse) => `
      <div class="hifz-link-verse">
        <span class="hifz-link-ref">${hifzEsc(this.linkRef(verse))}</span>
        <p dir="rtl">${hifzEsc(this.verseText(verse)) || '…'}</p>
      </div>`).join('');

    return `
      <div class="hifz-active hifz-link-panel is-final">
        <div class="hifz-link-head">
          <span class="hifz-link-kicker">📖</span>
          <div>
            <strong>${hifzEsc(heading)}</strong>
            <div class="hifz-link-range">${hifzEsc(hifzT('hifz_verses_done', { done: this.verses.length, total: this.verses.length }, ''))}</div>
          </div>
        </div>
        <p class="hifz-link-hint">${hifzEsc(hint)}</p>
        <div class="hifz-link-list">${list}</div>
      </div>`;
  },

  completeHtml() {
    const total = this.verses.length;
    const description = hifzT(
      'hifz_completed_desc',
      { page: this.page, total, target: HIFZ_REPS_TARGET, pair: HIFZ_PAIR_TARGET },
      `You completed page ${this.page}: ${total} verses, each repeated ${HIFZ_REPS_TARGET} times, every verse joined with the previous one ${HIFZ_PAIR_TARGET} times, and the full page recited.`
    );
    return `
      <div class="hifz-active hifz-complete-card">
        <div class="hifz-complete-icon" aria-hidden="true">✓</div>
        <h2>${hifzEsc(hifzT('hifz_completed_title', {}, 'New memorization completed'))}</h2>
        <p>${hifzEsc(description)}</p>
        <div class="hifz-complete-stats">
          <span>${hifzEsc(hifzT('hifz_verses_done', { done: total, total }, `${total} of ${total} verses`))}</span>
          <span>${HIFZ_REPS_TARGET} × ${hifzEsc(hifzT('hifz_rep_label_short', {}, 'times'))}</span>
        </div>
      </div>`;
  },

  actionsHtml() {
    const phase = this.state.phase;
    let mainAction = '';

    if (phase === 'repeat') {
      mainAction = `<button type="button" id="btn-add-rep" class="btn btn-success hifz-main-action">${hifzEsc(hifzT('hifz_add_rep', {}, 'Recite once (+1)'))}</button>`;
    } else if (phase === 'link') {
      mainAction = `<button type="button" id="btn-add-rep" class="btn btn-success hifz-main-action">${hifzEsc(hifzT('hifz_add_pair_rep', {}, 'Recite the pair once (+1)'))}</button>`;
    } else if (phase === 'page') {
      mainAction = `<button type="button" id="btn-complete-page" class="btn btn-success hifz-main-action">${hifzEsc(hifzT('hifz_page_done', {}, 'Full page recited — Continue'))}</button>`;
    } else {
      mainAction = `<button type="button" id="btn-complete-page" class="btn btn-success hifz-main-action">${hifzEsc(hifzT('hifz_mark_complete', {}, 'Page recited — Complete memorization'))}</button>`;
    }

    const counter = phase === 'repeat'
      ? Number(this.state.reps[this.state.current]) || 0
      : (phase === 'link' ? Number(this.state.links[this.state.current]) || 0 : 0);
    const undo = (phase === 'repeat' || phase === 'link')
      ? `<button type="button" id="btn-undo-rep" class="btn btn-warning-outline stage-icon-btn" ${counter > 0 ? '' : 'disabled'} title="${hifzEsc(hifzT('hifz_undo_rep', {}, 'Undo (-1)'))}">↩ ${hifzEsc(hifzT('hifz_undo_rep', {}, 'Undo (-1)'))}</button>`
      : '';

    return `
      <div class="stage-actions is-sticky hifz-actions">
        <div class="stage-primary-actions">${mainAction}</div>
        <div class="hifz-sub-actions">
          ${undo}
          <button type="button" id="btn-focus" class="btn btn-ghost btn-focus-toggle stage-icon-btn" title="${hifzEsc(hifzT('focus_mode_title', {}, 'Focus mode'))}">
            <span class="focus-enter-label">🎯 ${hifzEsc(hifzT('focus_mode', {}, 'Focus mode'))}</span>
            <span class="focus-exit-label">✅ ${hifzEsc(hifzT('focus_exit', {}, 'Exit focus'))}</span>
          </button>
          <button type="button" id="btn-view-mushaf" class="btn-mushaf-view stage-icon-btn" title="${hifzEsc(hifzT('btn_view_mushaf', {}, 'Browse Mushaf'))}">${hifzEsc(hifzT('btn_view_mushaf', {}, 'Browse Mushaf'))}</button>
          <button type="button" id="btn-open-mistake" class="btn btn-danger stage-icon-btn" title="${hifzEsc(hifzT('btn_open_mistake', {}, 'Log Mistake'))}">${hifzEsc(hifzT('btn_open_mistake', {}, 'Log Mistake'))}</button>
        </div>
      </div>`;
  },

  paint() {
    const container = document.getElementById('task-content');
    if (!container || !this.state) return;

    let body;
    if (this.state.phase === 'repeat') body = this.repeatHtml();
    else if (this.state.phase === 'link') body = this.pairHtml();
    else if (this.state.phase === 'page') body = this.pageHtml();
    else body = this.completeHtml();

    container.innerHTML = `
      ${this.headerHtml()}
      ${this.railHtml()}
      ${body}
      ${this.actionsHtml()}
      <div class="kbd-hint">${hifzT('hifz_kbd_hints', {}, '')}</div>
      <div class="page-notes-root" id="page-notes-root"></div>`;

    this.bindEvents();
    this.mountNotes();
    this.scrollRailToActive();
    this.updateSyncDom();
  },

  paintCompleted(taskDone) {
    const container = document.getElementById('task-content');
    if (!container) return;
    const total = this.verses.length;
    const description = hifzT(
      'hifz_completed_desc',
      { page: this.page, total, target: HIFZ_REPS_TARGET, pair: HIFZ_PAIR_TARGET },
      `You completed page ${this.page}: ${total} verses, each repeated ${HIFZ_REPS_TARGET} times, every verse joined with the previous one ${HIFZ_PAIR_TARGET} times, and the full page recited.`
    );
    const taskTitle = (hifzIsEnglish() && this.task.title_en) ? this.task.title_en : (this.task.title_ar || '');
    container.innerHTML = `
      <div class="task-page-head hifz-head">
        <div class="task-page-title-row">
          <div>
            <h2>${hifzEsc(taskTitle)}</h2>
            <p class="hint">${hifzEsc(hifzT('hifz_page_progress', {}, 'Page Memorization Progress'))}</p>
          </div>
          <div class="task-page-badge green">${hifzEsc(hifzT('hifz_completed_title', {}, 'New memorization completed'))}</div>
        </div>
      </div>
      <div class="hifz-active hifz-complete-card">
        <div class="hifz-complete-icon" aria-hidden="true">✓</div>
        <h2>${hifzEsc(hifzT('hifz_completed_title', {}, 'New memorization completed'))}</h2>
        <p>${hifzEsc(description)}</p>
        <div class="hifz-complete-stats">
          <span>${hifzEsc(hifzT('hifz_verses_done', { done: total, total }, `${total} of ${total} verses`))}</span>
          <span>${HIFZ_REPS_TARGET} × ${hifzEsc(hifzT('hifz_rep_label_short', {}, 'times'))}</span>
        </div>
        <a href="dashboard.html" class="btn btn-primary btn-block">${hifzEsc(hifzT('hifz_exit_completed', {}, 'Back to today’s notebook'))}</a>
        ${taskDone ? '' : `<div class="hifz-sync-status">${hifzEsc(hifzT('hifz_final_done_toast', {}, ''))}</div>`}
      </div>`;
  },

  paintError(error) {
    const container = document.getElementById('task-content');
    if (!container) return;
    const message = (error && error.message) ? error.message : hifzT('hifz_load_error', {}, 'Could not load the verse text.');
    container.innerHTML = `
      <div class="task-page-head hifz-head">
        <h2>${hifzEsc(hifzT('hifz_load_error', {}, 'Could not load the verse text.'))}</h2>
        <p class="hint">${hifzEsc(message)}</p>
        <button type="button" id="hifz-retry" class="btn btn-primary">${hifzEsc(hifzT('hifz_retry', {}, 'Try again'))}</button>
      </div>`;
    const retry = document.getElementById('hifz-retry');
    if (retry) retry.addEventListener('click', () => this.mount());
  },

  bindEvents() {
    const addBtn = document.getElementById('btn-add-rep');
    if (addBtn) addBtn.addEventListener('click', () => this.addRep());

    const undoBtn = document.getElementById('btn-undo-rep');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undoRep());

    const completeBtn = document.getElementById('btn-complete-page');
    if (completeBtn) {
      completeBtn.addEventListener('click', () => {
        if (this.state.phase === 'page') {
          this.finishPage();
        } else if (this.state.phase === 'complete') {
          this.completeTask();
        }
      });
    }

    const toggle = document.getElementById('hifz-toggle-text');
    if (toggle) toggle.addEventListener('click', () => this.toggleText());

    const verseText = document.getElementById('hifz-verse-text');
    if (verseText && this.textHidden) {
      verseText.addEventListener('click', () => this.toggleText());
    }

    const play = document.getElementById('hifz-play-verse');
    if (play) play.addEventListener('click', () => this.playCurrentVerse());

    const mushaf = document.getElementById('btn-view-mushaf');
    if (mushaf) mushaf.addEventListener('click', () => openMushafModal(this.page));

    const mistake = document.getElementById('btn-open-mistake');
    if (mistake) mistake.addEventListener('click', () => openMistakeModal(this.page));
  },

  mountNotes() {
    if (!window.PageNotes) return;
    PageNotes.mount(this.page, 'HIFZ_JADID');

    // The memorization board is secondary to the active verse; keep the page
    // compact until the user explicitly opens it (or has a saved preference).
    let hasPreference = true;
    try {
      hasPreference = localStorage.getItem('rh_page_notes_collapsed') !== null;
    } catch (error) {
      hasPreference = true;
    }
    if (!hasPreference) {
      const card = document.getElementById('pn-card');
      const toggle = document.getElementById('pn-toggle');
      if (card && !card.classList.contains('is-collapsed')) {
        card.classList.add('is-collapsed');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        PageNotes.setCollapsed(true);
      }
    }
  },

  scrollRailToActive() {
    const rail = document.getElementById('hifz-verse-rail');
    if (!rail) return;
    const active = rail.querySelector('.hifz-verse-chip.is-active');
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        active.scrollIntoView({ block: 'nearest', inline: 'center' });
      } catch (error) {
        const target = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
        rail.scrollLeft = Math.max(0, target);
      }
    });
  },

  updateCounterDom() {
    if (!this.state) return;
    const phase = this.state.phase;
    const target = phase === 'link' ? HIFZ_PAIR_TARGET : HIFZ_REPS_TARGET;
    const rep = phase === 'link'
      ? (Number(this.state.links[this.state.current]) || 0)
      : (Number(this.state.reps[this.state.current]) || 0);
    const number = document.getElementById('hifz-rep-number');
    if (number) number.textContent = String(rep);
    const fill = document.getElementById('hifz-rep-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, Math.round((rep / target) * 100))) + '%';
    const undo = document.getElementById('btn-undo-rep');
    if (undo) undo.disabled = rep < 1;
    this.updateSyncDom();
  },

  toggleText() {
    this.textHidden = !this.textHidden;
    try {
      localStorage.setItem(HIFZ_TEXT_HIDDEN_KEY, this.textHidden ? '1' : '0');
    } catch (error) {}
    const text = document.getElementById('hifz-verse-text');
    if (text) text.classList.toggle('is-hidden', this.textHidden);
    const toggle = document.getElementById('hifz-toggle-text');
    if (toggle) {
      toggle.textContent = this.textHidden
        ? hifzT('hifz_show_text', {}, 'Show text')
        : hifzT('hifz_hide_text', {}, 'Hide text');
    }
    if (text && this.textHidden) {
      text.addEventListener('click', () => this.toggleText(), { once: true });
    }
  },

  playCurrentVerse() {
    const verse = this.verses[this.state.current];
    if (!verse) return;
    if (window.PageNotes && typeof PageNotes.playAyah === 'function') {
      PageNotes.playAyah(verse.surah, verse.ayah);
    } else {
      showToast(hifzT('hifz_load_error', {}, 'Audio unavailable.'), true);
    }
  },

  addRep() {
    if (!this.state) return;

    if (this.state.phase === 'repeat') {
      const index = this.state.current;
      if (this.state.reps[index] >= HIFZ_REPS_TARGET) return;

      this.state.reps[index] = Math.min(HIFZ_REPS_TARGET, Number(this.state.reps[index]) + 1);
      const finished = this.state.reps[index] >= HIFZ_REPS_TARGET;

      if (!finished) {
        this.writeLocal();
        this.scheduleSave();
        this.updateCounterDom();
        if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
        return;
      }

      if (index === 0) {
        if (this.verses.length === 1) {
          this.state.phase = 'page';
        } else {
          this.state.current = 1;
          this.state.phase = 'repeat';
        }
        showToast(hifzT('hifz_next_verse_toast', { target: HIFZ_REPS_TARGET }, 'Moving to the next verse.'), false);
      } else {
        this.state.phase = 'link';
        showToast(hifzT('hifz_pair_ready_toast', {}, 'Now join the two verses.'), false);
      }

      this.writeLocal();
      this.persistNow();
      if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
      this.paint();
      return;
    }

    if (this.state.phase === 'link') {
      const index = this.state.current;
      if (index < 1 || Number(this.state.links[index]) >= HIFZ_PAIR_TARGET) return;

      this.state.links[index] = Math.min(HIFZ_PAIR_TARGET, Number(this.state.links[index]) + 1);
      const finished = this.state.links[index] >= HIFZ_PAIR_TARGET;

      if (!finished) {
        this.writeLocal();
        this.scheduleSave();
        this.updateCounterDom();
        if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
        return;
      }

      if (index < this.verses.length - 1) {
        this.state.current = index + 1;
        this.state.phase = 'repeat';
        showToast(hifzT('hifz_link_done_toast', {}, 'Adjacent pair completed ✓'), false);
      } else {
        this.state.phase = 'page';
        showToast(hifzT('hifz_pair_done_toast', {}, 'All pairs completed — recite the whole page.'), false);
      }

      this.writeLocal();
      this.persistNow();
      if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
      this.paint();
    }
  },

  undoRep() {
    if (!this.state) return;
    if (this.state.phase === 'repeat') {
      const index = this.state.current;
      if (Number(this.state.reps[index]) < 1) return;
      this.state.reps[index] = Math.max(0, Number(this.state.reps[index]) - 1);
      this.writeLocal();
      this.scheduleSave(700);
      this.updateCounterDom();
      if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') AudioEngine.playUndo();
      return;
    }

    if (this.state.phase === 'link') {
      const index = this.state.current;
      if (index < 1 || Number(this.state.links[index]) < 1) return;
      this.state.links[index] = Math.max(0, Number(this.state.links[index]) - 1);
      this.writeLocal();
      this.scheduleSave(700);
      this.updateCounterDom();
      if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') AudioEngine.playUndo();
    }
  },

  finishPage() {
    if (this.state.phase !== 'page') return;
    this.state.page_pass = HIFZ_PAGE_PASS_TARGET;
    this.state.complete = true;
    this.state.phase = 'complete';
    this.writeLocal();
    this.persistNow();
    if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
    this.paint();
  },

  async completeTask() {
    if (!this.state || !this.state.complete) return;
    clearTimeout(this.saveTimer);
    this.dirty = false;
    const button = document.getElementById('btn-complete-page');
    if (button) button.disabled = true;

    try {
      const response = await API.call('tasks/update_progress.php', {
        method: 'POST',
        body: {
          task_type: 'HIFZ_JADID',
          completed_page: this.page,
          hifz_progress: this.state,
        },
        redirectOn401: true,
      });

      this.clearLocal();
      if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
        AudioEngine.playCelebration();
      }
      showToast(hifzT('hifz_page_celebration', { page: this.page }, `Completed page ${this.page}.`), false);
      await loadSharedData();
      renderTaskPage('HIFZ_JADID');
    } catch (error) {
      if (button) button.disabled = false;
      showToast(error && error.message ? error.message : hifzT('hifz_complete_error', {}, 'Could not complete now.'), true);
    }
  },
};

window.HifzPage = HifzPage;
