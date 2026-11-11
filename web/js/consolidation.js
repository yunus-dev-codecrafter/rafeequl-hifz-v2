'use strict';

/* ==========================================================================
   Rafeequl Hifz — page-by-page consolidation (PAGE_TAMKIN)

   One page per entry:
     1. arrange 10-word windows across the whole page (not verse by verse)
     2. recite the page from memory
     3. reveal the page, listen, then mark DONE / IMPROVE

   Server: api/tasks/consolidation.php
   ========================================================================== */

(function () {
  const CHUNK_SIZE = 10;
  const AUDIO_BASE = 'https://everyayah.com/data/Alafasy_128kbps/';

  const state = {
    data: null,
    task: null,
    selections: [],
    targets: null,
    stage: 'arrangement',
    chunkStart: 0,
    chunkWords: [],
    placed: [],
    bank: [],
    busy: false,
    revealed: false,
    audio: null,
    playingIndex: -1,
    playing: false,
    activeTab: 'SURAH',
    // Voice recording
    mediaRecorder: null,
    mediaStream: null,
    recordingChunks: [],
    recordingTimerId: null,
    recordingStartTime: 0,
    recordedAudioUrl: null,
    recordedDuration: 0,
    recordingState: 'idle', // 'idle' | 'recording' | 'playback'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function t(key, fallback, params) {
    try {
      if (window.I18N && typeof I18N.t === 'function') {
        const value = I18N.t(key, params);
        if (value && value !== key) return value;
      }
    } catch (e) {}
    return fallback;
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function surahName(id) {
    try {
      if (window.I18N && typeof I18N.getSurahName === 'function') {
        const name = I18N.getSurahName(Number(id));
        if (name) return name;
      }
    } catch (e) {}
    return t('page_surah_word', 'سورة') + ' ' + id;
  }

  function normalizeArabic(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededShuffle(items, seed) {
    const out = items.slice();
    let value = seed >>> 0;
    const rand = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function formatRef(ref) {
    if (!ref) return '';
    const parts = String(ref).split(':');
    const surah = Number(parts[0]) || 0;
    const ayah = parts[1] || '';
    return surahName(surah) + ' ' + ayah;
  }

  function audioUrl(surah, ayah) {
    const pad = (n) => String(n).padStart(3, '0');
    return AUDIO_BASE + pad(Number(surah)) + pad(Number(ayah)) + '.mp3';
  }

  async function api(path, options) {
    const client = (typeof API !== 'undefined' ? API : null) || (typeof window !== 'undefined' ? window.API : null);
    if (!client || typeof client.call !== 'function') {
      throw new Error('API client not ready');
    }
    return client.call(path, options || {});
  }

  function setStatus(id, message, isError) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', !!isError);
  }

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------ */

  function applyState(data, resetStage) {
    state.data = data || null;
    state.task = data && data.task ? data.task : null;
    state.selections = data && Array.isArray(data.selections) ? data.selections : [];
    state.targets = data && data.targets ? data.targets : null;

    if (resetStage) {
      cleanupRecording();
      state.recordingState = 'idle';
      state.revealed = false;
      state.chunkStart = 0;
      state.placed = [];
      state.bank = [];
      stopAudio();
    }

    if (!state.task) {
      state.stage = 'inactive';
      return;
    }
    if (state.task.is_completed) {
      state.stage = 'done';
      return;
    }
    if (state.task.stage === 'arrangement') {
      state.stage = 'arrangement';
      const wordsDone = Math.max(0, Number(state.task.words_done) || 0);
      state.chunkStart = Math.floor(wordsDone / CHUNK_SIZE) * CHUNK_SIZE;
      state.revealed = false;
    } else {
      state.stage = 'recitation';
      state.chunkStart = 0;
      state.revealed = false;
    }
  }

  function updateTaskFromState(data) {
    if (!data) return;
    // A late save_progress response must not overwrite the final DONE/IMPROVE
    // screen or roll back the page after the result was recorded.
    if (data.task && state.stage !== 'done') state.task = data.task;
    if (Array.isArray(data.selections)) state.selections = data.selections;
    if (data.targets) state.targets = data.targets;
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------ */

  function renderAll() {
    const loading = $('consolidation-loading');
    const inactive = $('consolidation-inactive');
    const root = $('consolidation-root');
    if (loading) loading.classList.add('hidden');

    const hasTask = !!state.task;
    if (inactive) inactive.classList.toggle('hidden', hasTask);
    if (root) root.classList.toggle('hidden', !hasTask);
    if (!hasTask) return;

    renderHero();
    renderSelections();
    renderTargetList();
    renderStages();
  }

  function effectiveWordsDone() {
    if (!state.task) return 0;
    if (state.stage !== 'arrangement') {
      return Math.min(Number(state.task.word_count) || 0, Number(state.task.words_done) || 0);
    }
    return Math.min(Number(state.task.word_count) || 0, state.chunkStart + state.placed.length);
  }

  function renderHero() {
    const task = state.task;
    if (!task) return;
    const page = Number(task.page_number) || Number(task.start_page) || 0;
    const title = $('consolidation-page-title');
    if (title) title.textContent = t('page_title', 'صفحة {page}').replace('{page}', page);

    const refs = $('consolidation-refs');
    if (refs) {
      const from = formatRef(task.start_ref);
      const to = formatRef(task.end_ref);
      refs.innerHTML = from
        ? `<span>${escHtml(from)}</span><span class="consolidation-ref-sep">—</span><span>${escHtml(to)}</span>`
        : '';
    }

    const source = $('consolidation-source');
    if (source) source.textContent = sourceLabel(task);

    const total = Math.max(1, Number(task.word_count) || 0);
    const done = task.is_completed ? total : effectiveWordsDone();
    const percent = task.is_completed ? 100 : Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    const percentEl = $('consolidation-percent');
    if (percentEl) percentEl.textContent = percent + '%';
    const ring = $('consolidation-ring-fg');
    if (ring) {
      const circumference = 2 * Math.PI * 18;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference - (circumference * percent) / 100);
    }

    const status = $('consolidation-status-chip');
    if (status) {
      if (task.is_completed) {
        status.textContent = t('page_status_done', '✓ مكتملة');
        status.className = 'consolidation-chip is-done';
      } else if (task.result === 'IMPROVE') {
        status.textContent = t('page_status_improve', 'تحتاج تحسينًا');
        status.className = 'consolidation-chip is-warn';
      } else if (state.stage === 'arrangement') {
        status.textContent = t('page_status_arrangement', 'ترتيب الكلمات');
        status.className = 'consolidation-chip';
      } else {
        status.textContent = t('page_status_recitation', 'تسميع الصفحة');
        status.className = 'consolidation-chip';
      }
    }

    const selectionChip = $('consolidation-selection-chip');
    if (selectionChip) selectionChip.textContent = sourceLabel(task);

    const attemptChip = $('consolidation-attempt-chip');
    if (attemptChip) {
      const attempts = Number(task.attempts) || 0;
      attemptChip.textContent = attempts > 0
        ? t('page_attempts', 'المحاولات: {count}').replace('{count}', attempts)
        : t('page_first_attempt', 'أول محاولة');
      attemptChip.classList.toggle('hidden', false);
    }
  }

  function sourceLabel(task) {
    if (!task) return '';
    if (task.selection_id) {
      const selection = state.selections.find((item) => Number(item.id) === Number(task.selection_id));
      if (selection) return targetLabel(selection.target_type, selection.target_id);
    }
    if (task.source === 'AUTO') return t('page_source_auto', 'اختيار تلقائي');
    if (task.source === 'SURAH') return t('page_source_surah', 'اختيار سورة');
    if (task.source === 'RUB') return t('page_source_rub', 'اختيار ربع');
    if (task.source === 'PAGE') return t('page_source_page', 'اختيار صفحة');
    return t('page_source_auto', 'اختيار تلقائي');
  }

  function targetLabel(type, id) {
    if (type === 'SURAH') return surahName(id);
    if (type === 'RUB') return t('page_rub_label', 'الربع {id}').replace('{id}', id);
    return t('page_title', 'صفحة {page}').replace('{page}', id);
  }

  function renderSelections() {
    const box = $('active-selections');
    if (!box) return;
    if (!state.selections.length) {
      box.innerHTML = `<p class="hint consolidation-no-selection">${escHtml(t('page_no_targets', 'لا توجد أهداف مختارة. سيختار النظام صفحة عشوائية من محفوظك.'))}</p>`;
      return;
    }
    box.innerHTML = state.selections.map((item) => {
      const label = targetLabel(item.target_type, item.target_id);
      const done = Number(item.pages_done) || 0;
      const total = Number(item.pages_total) || 0;
      const percent = Number(item.progress_percent) || 0;
      return `
        <div class="consolidation-selection">
          <div class="consolidation-selection-top">
            <strong>${escHtml(label)}</strong>
            <button type="button" class="consolidation-selection-remove" data-remove-selection="${Number(item.id)}" aria-label="${escHtml(t('page_remove_target', 'إزالة الهدف'))}">✕</button>
          </div>
          <div class="consolidation-selection-progress">
            <span>${escHtml(t('page_pages_progress', '{done} / {total} صفحة').replace('{done}', done).replace('{total}', total))}</span>
            <span>${percent}%</span>
          </div>
          <div class="consolidation-progress is-small"><span style="width:${percent}%"></span></div>
        </div>`;
    }).join('');
  }

  function renderTargetList() {
    const list = $('target-list');
    const picker = $('target-page-picker');
    if (!list || !picker) return;

    document.querySelectorAll('[data-target-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.targetTab === state.activeTab);
    });

    const isPage = state.activeTab === 'PAGE';
    picker.classList.toggle('hidden', !isPage);
    list.classList.toggle('hidden', isPage);

    const pageInput = $('target-page-input');
    const pageHint = $('target-page-hint');
    if (pageInput) {
      const frontier = state.targets ? Number(state.targets.frontier) || 1 : 1;
      pageInput.max = String(frontier);
      pageInput.placeholder = '1 – ' + frontier;
      if (pageHint) {
        pageHint.textContent = t('page_pick_hint', 'المتاح: الصفحات 1 – {max}').replace('{max}', frontier);
      }
    }

    if (isPage) {
      list.innerHTML = '';
      return;
    }

    const targets = state.targets || {};
    const items = state.activeTab === 'SURAH'
      ? (Array.isArray(targets.surahs) ? targets.surahs : [])
      : (Array.isArray(targets.rubs) ? targets.rubs : []);

    if (!items.length) {
      list.innerHTML = `<p class="hint">${escHtml(t('page_no_available_targets', 'لا توجد صفحات محفوظة كافية لهذا الاختيار بعد.'))}</p>`;
      return;
    }

    list.innerHTML = items.map((item) => {
      const label = state.activeTab === 'SURAH'
        ? surahName(item.id)
        : t('page_rub_label', 'الربع {id}').replace('{id}', item.id);
      const pages = t('page_pages_count', '{count} صفحة').replace('{count}', Number(item.pages) || 0);
      const range = t('page_pages_range', 'ص {start} – {end}')
        .replace('{start}', item.start_page)
        .replace('{end}', item.end_page);
      const extra = state.activeTab === 'RUB' && item.juz
        ? ' · ' + t('page_juz_label', 'جزء {juz}').replace('{juz}', item.juz)
        : '';
      return `
        <button type="button" class="consolidation-target-item" data-target-type="${escHtml(state.activeTab)}" data-target-id="${Number(item.id)}">
          <span class="consolidation-target-name">${escHtml(label)}</span>
          <span class="consolidation-target-meta">${escHtml(range)} · ${escHtml(pages)}${escHtml(extra)}</span>
        </button>`;
    }).join('');
  }

  function renderStages() {
    const stage = state.stage;
    ['arrangement', 'recitation', 'done'].forEach((name) => {
      const el = $('stage-' + name);
      if (el) el.classList.toggle('hidden', name !== stage);
    });
    document.querySelectorAll('[data-stage-chip]').forEach((chip) => {
      const name = chip.dataset.stageChip;
      chip.classList.toggle('is-active', name === stage);
      const order = { arrangement: 0, recitation: 1, done: 2 };
      chip.classList.toggle('is-done', order[name] < order[stage]);
    });

    if (stage === 'arrangement') {
      stopAudio();
      renderArrangement();
    } else if (stage === 'recitation') {
      renderRecitation();
    } else if (stage === 'done') {
      stopAudio();
      renderDone();
    }
  }

  /* ---------------------------------------------------------------------
   * Stage 1 — word arrangement (10-word windows)
   * ------------------------------------------------------------------ */

  function chunkBounds() {
    const wordCount = Math.max(0, Number(state.task && state.task.word_count) || 0);
    const start = Math.max(0, state.chunkStart);
    const end = Math.min(wordCount, start + CHUNK_SIZE);
    return { start, end, wordCount };
  }

  function resetChunk(keepPlaced) {
    const task = state.task;
    if (!task) return;
    const words = Array.isArray(task.words) ? task.words : [];
    const { start, end } = chunkBounds();
    state.chunkWords = words.slice(start, end);
    const placedCount = keepPlaced
      ? Math.max(0, Math.min(state.chunkWords.length, effectiveWordsDone() - start))
      : 0;
    state.placed = state.chunkWords.slice(0, placedCount);
    state.bank = seededShuffle(
      state.chunkWords.slice(placedCount),
      hashString((task.page_number || 0) + ':' + start + ':' + placedCount)
    );
  }

  function renderArrangement() {
    if (!state.task) return;
    if (!state.chunkWords.length && state.placed.length === 0) {
      resetChunk(true);
    }
    const { start, end, wordCount } = chunkBounds();
    if (wordCount === 0) {
      state.stage = 'recitation';
      renderStages();
      return;
    }
    if (start >= wordCount) {
      state.stage = 'recitation';
      renderStages();
      return;
    }

    const done = Math.min(wordCount, start + state.placed.length);
    const percent = wordCount > 0 ? Math.round((done / wordCount) * 100) : 0;
    const rangeEl = $('arrangement-range');
    if (rangeEl) {
      rangeEl.textContent = t('page_words_range', 'الكلمات {from}–{to}')
        .replace('{from}', start + 1)
        .replace('{to}', end);
    }
    const percentEl = $('arrangement-percent');
    if (percentEl) percentEl.textContent = percent + '%';
    const bar = $('arrangement-progress-bar');
    if (bar) bar.style.width = percent + '%';

    const contextEl = $('arrangement-context');
    if (contextEl) {
      const words = Array.isArray(state.task.words) ? state.task.words : [];
      const context = words.slice(Math.max(0, start - 2), start).map((w) => w.text);
      contextEl.innerHTML = context.length
        ? `<span class="consolidation-context-label">${escHtml(t('page_previous_words', 'ما قبل المقطع'))}</span> ${context.map((w) => `<span class="consolidation-context-word">${escHtml(w)}</span>`).join(' ')}`
        : '';
    }

    const answerEl = $('arrangement-answer');
    if (answerEl) {
      answerEl.innerHTML = state.placed.length
        ? state.placed.map((w) => `<span class="consolidation-answer-word">${escHtml(w.text)}</span>`).join('')
        : `<span class="consolidation-answer-empty">${escHtml(t('page_answer_empty', 'ابدأ باختيار الكلمة الأولى'))}</span>`;
    }

    const bankEl = $('arrangement-bank');
    if (bankEl) {
      bankEl.innerHTML = state.bank.map((w, index) => `
        <button type="button" class="consolidation-bank-word" data-bank-index="${index}">${escHtml(w.text)}</button>
      `).join('');
    }

    const status = $('arrangement-status');
    if (status && !status.dataset.keep) status.textContent = '';
  }

  function onBankClick(index) {
    if (state.busy || state.stage !== 'arrangement') return;
    const token = state.bank[index];
    if (!token) return;
    const expected = state.chunkWords[state.placed.length];
    if (!expected) return;

    if (normalizeArabic(token.text) !== normalizeArabic(expected.text)) {
      const btn = document.querySelector(`[data-bank-index="${index}"]`);
      if (btn) {
        btn.classList.add('is-wrong');
        setTimeout(() => btn.classList.remove('is-wrong'), 420);
      }
      setStatus('arrangement-status', t('page_wrong_word', 'ليست الكلمة التالية. جرّب كلمة أخرى.'));
      return;
    }

    state.placed.push(token);
    state.bank.splice(index, 1);
    setStatus('arrangement-status', '');
    if (state.placed.length >= state.chunkWords.length) {
      completeChunk();
      return;
    }
    renderArrangement();
    renderHero();
  }

  function completeChunk() {
    const { start, end, wordCount } = chunkBounds();
    const wordsDone = Math.min(wordCount, start + state.chunkWords.length);
    if (state.task) state.task.words_done = wordsDone;
    state.chunkStart = wordsDone;
    state.placed = [];
    state.chunkWords = [];
    state.bank = [];

    setStatus('arrangement-status', t('page_chunk_done', 'أحسنت، تم إتقان هذا المقطع.'));
    const statusEl = $('arrangement-status');
    if (statusEl) statusEl.dataset.keep = '1';
    saveProgress(wordsDone).catch(() => {});

    if (wordsDone >= wordCount) {
      state.stage = 'recitation';
      renderAll();
      return;
    }

    setTimeout(() => {
      if (!state.task || state.stage !== 'arrangement') return;
      state.chunkStart = wordsDone;
      resetChunk(false);
      renderArrangement();
      renderHero();
      const el = $('arrangement-status');
      if (el) {
        el.textContent = '';
        delete el.dataset.keep;
      }
    }, 420);
  }

  function undoWord() {
    if (state.busy || state.stage !== 'arrangement' || !state.placed.length) return;
    const word = state.placed.pop();
    state.bank.push(word);
    state.bank = seededShuffle(state.bank, hashString('undo:' + state.chunkStart + ':' + state.placed.length));
    if (state.task) {
      state.task.words_done = Math.max(state.chunkStart, effectiveWordsDone());
    }
    renderArrangement();
    renderHero();
    saveProgress(effectiveWordsDone()).catch(() => {});
  }

  function resetChunkWords() {
    if (state.busy || state.stage !== 'arrangement') return;
    state.placed = [];
    if (state.task) state.task.words_done = state.chunkStart;
    resetChunk(false);
    renderArrangement();
    renderHero();
    saveProgress(state.chunkStart).catch(() => {});
  }

  async function saveProgress(wordsDone) {
    if (!state.task || !state.task.id) return;
    try {
      const data = await api('tasks/consolidation.php', {
        method: 'POST',
        body: {
          action: 'save_progress',
          task_id: state.task.id,
          words_done: wordsDone,
        },
      });
      updateTaskFromState(data);
    } catch (e) {
      if (window.showToast) window.showToast(e.message, true);
    }
  }

  /* ---------------------------------------------------------------------
   * Stage 2 — recitation, recording, playback and verification
   * ------------------------------------------------------------------ */

  function isRecordingSupported() {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof MediaRecorder !== 'undefined';
  }

  function getBestMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return String(m).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
  }

  function cleanupRecording() {
    if (state.recordingTimerId) {
      clearInterval(state.recordingTimerId);
      state.recordingTimerId = null;
    }
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      try { state.mediaRecorder.stop(); } catch (e) {}
    }
    state.mediaRecorder = null;
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
      state.mediaStream = null;
    }
    state.recordingChunks = [];
    const recordedAudio = $('recorded-audio');
    if (recordedAudio) {
      try { recordedAudio.pause(); } catch (e) {}
      recordedAudio.src = '';
    }
    if (state.recordedAudioUrl) {
      URL.revokeObjectURL(state.recordedAudioUrl);
      state.recordedAudioUrl = null;
    }
  }

  async function startRecording() {
    if (state.busy) return;
    if (!isRecordingSupported()) {
      setStatus('recitation-status', t('page_mic_unsupported', 'التسجيل الصوتي غير مدعوم في هذا المتصفح.'), true);
      return;
    }
    stopAudio();
    if (state.recordedAudioUrl) {
      URL.revokeObjectURL(state.recordedAudioUrl);
      state.recordedAudioUrl = null;
    }
    state.recordedDuration = 0;

    try {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setStatus('recitation-status', t('page_mic_permission_denied', 'تعذر الوصول إلى الميكروفون. يرجى السماح بالإذن في المتصفح أو المتابعة بدون تسجيل.'), true);
      return;
    }

    state.recordingChunks = [];
    const mimeType = getBestMimeType();
    const options = mimeType ? { mimeType } : {};
    try {
      state.mediaRecorder = new MediaRecorder(state.mediaStream, options);
    } catch (e) {
      state.mediaRecorder = new MediaRecorder(state.mediaStream);
    }

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordingChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = () => {
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
        state.mediaStream = null;
      }
      const finalMime = (state.mediaRecorder && state.mediaRecorder.mimeType) || mimeType || 'audio/webm';
      const blob = new Blob(state.recordingChunks, { type: finalMime });
      if (blob.size > 0) {
        state.recordedAudioUrl = URL.createObjectURL(blob);
        state.recordingState = 'playback';
        state.revealed = true;
        renderRecitation();
        const player = $('recorded-audio');
        if (player) {
          player.src = state.recordedAudioUrl;
          const p = player.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }
    };

    state.recordingStartTime = Date.now();
    state.recordingState = 'recording';
    state.revealed = false;
    state.mediaRecorder.start(250);
    renderRecitation();

    const timerEl = $('recording-timer');
    if (timerEl) timerEl.textContent = '00:00';
    if (state.recordingTimerId) clearInterval(state.recordingTimerId);
    state.recordingTimerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
      state.recordedDuration = elapsed;
      const el = $('recording-timer');
      if (el) el.textContent = formatTime(elapsed);
    }, 500);
  }

  function stopRecording(reveal = true) {
    if (state.recordingTimerId) {
      clearInterval(state.recordingTimerId);
      state.recordingTimerId = null;
    }
    state.recordedDuration = Math.round((Date.now() - (state.recordingStartTime || Date.now())) / 1000);
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      try {
        state.mediaRecorder.stop();
      } catch (e) {}
    } else {
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
        state.mediaStream = null;
      }
      if (reveal) {
        state.recordingState = 'playback';
        state.revealed = true;
        renderRecitation();
      }
    }
  }

  function rerecord() {
    stopAudio();
    cleanupRecording();
    state.recordingState = 'idle';
    state.revealed = false;
    renderRecitation();
    startRecording();
  }

  function revealDirectly() {
    stopAudio();
    if (state.recordingState === 'recording') {
      stopRecording(false);
    }
    state.recordingState = 'playback';
    state.revealed = true;
    renderRecitation();
  }

  function renderRecitation() {
    if (!state.task) return;
    const prompt = $('recitation-intro');
    if (prompt) {
      const intro = Array.isArray(state.task.intro_words) && state.task.intro_words.length
        ? state.task.intro_words
        : (state.task.words || []).slice(0, 5).map((w) => w.text);
      prompt.innerHTML = intro.map((word) => `<span>${escHtml(word)}</span>`).join('');
    }

    const idleBox = $('recorder-state-idle');
    const activeBox = $('recorder-state-active');
    const playbackBox = $('recorder-state-playback');

    if (state.recordingState === 'recording') {
      if (idleBox) idleBox.classList.add('hidden');
      if (activeBox) activeBox.classList.remove('hidden');
      if (playbackBox) playbackBox.classList.add('hidden');
    } else if (state.revealed || state.recordingState === 'playback') {
      if (idleBox) idleBox.classList.add('hidden');
      if (activeBox) activeBox.classList.add('hidden');
      if (playbackBox) playbackBox.classList.remove('hidden');

      const audioWrap = $('playback-audio-wrap');
      const audioEl = $('recorded-audio');
      const badge = $('record-duration-badge');
      if (state.recordedAudioUrl) {
        if (audioWrap) audioWrap.classList.remove('hidden');
        if (audioEl && audioEl.src !== state.recordedAudioUrl) {
          audioEl.src = state.recordedAudioUrl;
        }
        if (badge) badge.textContent = formatTime(state.recordedDuration);
      } else {
        if (audioWrap) audioWrap.classList.add('hidden');
        if (badge) badge.textContent = '';
      }
    } else {
      if (idleBox) idleBox.classList.remove('hidden');
      if (activeBox) activeBox.classList.add('hidden');
      if (playbackBox) playbackBox.classList.add('hidden');
    }

    const pageEl = $('recitation-page');
    if (pageEl && state.revealed) {
      pageEl.classList.remove('hidden');
      pageEl.innerHTML = (state.task.verses || []).map((verse) => `
        <div class="consolidation-ayah" data-ayah-key="${escHtml(verse.key)}">
          <div class="consolidation-ayah-ref">${escHtml(surahName(verse.surah))} • ${escHtml(t('page_ayah_word', 'آية'))} ${Number(verse.ayah) || ''}</div>
          <p>${escHtml(verse.text)}</p>
        </div>`).join('');
    } else if (pageEl) {
      pageEl.classList.add('hidden');
      pageEl.innerHTML = '';
    }

    const stopQariBtn = $('btn-stop-qari');
    if (stopQariBtn) stopQariBtn.classList.toggle('hidden', !state.playing);
    const qariBtn = $('btn-qari-audio');
    if (qariBtn) qariBtn.classList.toggle('hidden', state.playing);

    const resultActions = $('recitation-result-actions');
    if (resultActions) resultActions.classList.toggle('hidden', !state.revealed);
    setStatus('recitation-status', '');
  }

  function ensureAudio() {
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.preload = 'none';
    }
    return state.audio;
  }

  function stopAudio() {
    state.playing = false;
    state.playingIndex = -1;
    if (state.audio) {
      state.audio.onended = null;
      state.audio.onerror = null;
      try { state.audio.pause(); } catch (e) {}
    }
    const recPlayer = $('recorded-audio');
    if (recPlayer) {
      try { recPlayer.pause(); } catch (e) {}
    }
    document.querySelectorAll('.consolidation-ayah.is-playing').forEach((el) => {
      el.classList.remove('is-playing');
    });
    const stopQariBtn = $('btn-stop-qari');
    if (stopQariBtn) stopQariBtn.classList.add('hidden');
    const qariBtn = $('btn-qari-audio');
    if (qariBtn) qariBtn.classList.remove('hidden');
  }

  function playQariAudio() {
    const verses = state.task && Array.isArray(state.task.verses) ? state.task.verses : [];
    if (!verses.length) return;
    const recPlayer = $('recorded-audio');
    if (recPlayer) {
      try { recPlayer.pause(); } catch (e) {}
    }
    state.playing = true;
    state.playingIndex = 0;
    const audio = ensureAudio();

    const qariBtn = $('btn-qari-audio');
    if (qariBtn) qariBtn.classList.add('hidden');
    const stopQariBtn = $('btn-stop-qari');
    if (stopQariBtn) stopQariBtn.classList.remove('hidden');

    const playAt = (index) => {
      if (!state.playing || index >= verses.length) {
        stopAudio();
        return;
      }
      state.playingIndex = index;
      const verse = verses[index];
      document.querySelectorAll('.consolidation-ayah.is-playing').forEach((el) => {
        el.classList.remove('is-playing');
      });
      const current = document.querySelector(`.consolidation-ayah[data-ayah-key="${String(verse.key).replace(/"/g, '\\"')}"]`);
      if (current) current.classList.add('is-playing');

      audio.onended = () => playAt(index + 1);
      audio.onerror = () => {
        setStatus('recitation-status', t('page_audio_error', 'تعذر تشغيل التلاوة. تأكد من الاتصال ثم أعد المحاولة.'), true);
        stopAudio();
      };
      audio.src = audioUrl(verse.surah, verse.ayah);
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          setStatus('recitation-status', t('page_audio_error', 'تعذر تشغيل التلاوة. تأكد من الاتصال ثم أعد المحاولة.'), true);
          stopAudio();
        });
      }
    };

    playAt(0);
  }

  async function markResult(result) {
    if (state.busy || !state.task || !state.task.id) return;
    state.busy = true;
    stopAudio();
    setStatus('recitation-status', t('page_saving', 'جارٍ الحفظ…'));
    const doneBtn = $('btn-page-done');
    const improveBtn = $('btn-page-improve');
    if (doneBtn) doneBtn.disabled = true;
    if (improveBtn) improveBtn.disabled = true;

    try {
      const data = await api('tasks/consolidation.php', {
        method: 'POST',
        body: { action: 'result', task_id: state.task.id, result },
      });
      applyState(data, false);
      if (state.task && state.task.is_completed) {
        state.stage = 'done';
      } else {
        state.stage = 'done';
      }
      renderAll();
    } catch (e) {
      setStatus('recitation-status', e.message, true);
      if (doneBtn) doneBtn.disabled = false;
      if (improveBtn) improveBtn.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  function renderDone() {
    const task = state.task;
    if (!task) return;
    const title = $('done-title');
    const desc = $('done-desc');
    const icon = $('done-icon');
    const practice = $('btn-practice-again');
    const completed = !!task.is_completed;

    if (title) {
      title.textContent = completed
        ? t('page_done_title', 'بارك الله فيك، ثبّتت الصفحة')
        : t('page_improve_title', 'تحتاج هذه الصفحة إلى تحسين');
    }
    if (desc) {
      desc.textContent = completed
        ? t('page_done_desc', 'ستظهر صفحة جديدة في الدخول القادم.')
        : t('page_improve_desc', 'ستعود هذه الصفحة في الدخول القادم حتى تثبّتها.');
    }
    if (icon) icon.textContent = completed ? '✓' : '↻';
    if (practice) practice.classList.toggle('hidden', completed);
  }

  async function practiceAgain() {
    if (!state.task || state.busy) return;
    state.busy = true;
    try {
      const data = await api('tasks/consolidation.php', {
        method: 'POST',
        body: { action: 'save_progress', task_id: state.task.id, words_done: 0 },
      });
      applyState(data, true);
      state.stage = 'arrangement';
      state.chunkStart = 0;
      resetChunk(false);
      renderAll();
    } catch (e) {
      if (window.showToast) window.showToast(e.message, true);
    } finally {
      state.busy = false;
    }
  }

  /* ---------------------------------------------------------------------
   * Weak targets
   * ------------------------------------------------------------------ */

  async function selectTarget(type, id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const data = await api('tasks/consolidation.php', {
        method: 'POST',
        body: { action: 'select', target_type: type, target_id: id },
      });
      applyState(data, true);
      state.stage = state.task && state.task.is_completed ? 'done'
        : (state.task && state.task.stage === 'arrangement' ? 'arrangement' : 'recitation');
      state.chunkStart = 0;
      resetChunk(false);
      renderAll();
      if (window.showToast) window.showToast(t('page_target_added', 'تمت إضافة الهدف. ستبدأ به من اليوم إن لم تكن الصفحة مكتملة.'));
    } catch (e) {
      if (window.showToast) window.showToast(e.message, true);
    } finally {
      state.busy = false;
    }
  }

  async function removeSelection(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const data = await api('tasks/consolidation.php', {
        method: 'POST',
        body: { action: 'unselect', selection_id: id },
      });
      applyState(data, false);
      renderAll();
    } catch (e) {
      if (window.showToast) window.showToast(e.message, true);
    } finally {
      state.busy = false;
    }
  }

  /* ---------------------------------------------------------------------
   * Events + boot
   * ------------------------------------------------------------------ */

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const bankBtn = event.target.closest('[data-bank-index]');
      if (bankBtn) {
        onBankClick(Number(bankBtn.dataset.bankIndex));
        return;
      }

      const removeBtn = event.target.closest('[data-remove-selection]');
      if (removeBtn) {
        removeSelection(Number(removeBtn.dataset.removeSelection));
        return;
      }

      const targetBtn = event.target.closest('[data-target-type][data-target-id]');
      if (targetBtn) {
        selectTarget(targetBtn.dataset.targetType, Number(targetBtn.dataset.targetId));
        return;
      }

      const tabBtn = event.target.closest('[data-target-tab]');
      if (tabBtn) {
        state.activeTab = tabBtn.dataset.targetTab;
        renderTargetList();
        return;
      }
    });

    const toggle = $('btn-toggle-targets');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const panel = $('targets-panel');
        if (!panel) return;
        const willShow = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !willShow);
        toggle.setAttribute('aria-expanded', willShow ? 'true' : 'false');
        if (willShow) renderTargetList();
      });
    }

    const addPage = $('btn-add-page');
    if (addPage) {
      addPage.addEventListener('click', () => {
        const input = $('target-page-input');
        const page = Number(input && input.value);
        const frontier = state.targets ? Number(state.targets.frontier) || 0 : 0;
        if (!page || page < 1 || page > frontier) {
          if (window.showToast) window.showToast(t('page_invalid_page', 'أدخل رقم صفحة ضمن الصفحات المحفوظة.'), true);
          return;
        }
        selectTarget('PAGE', page);
      });
    }

    const undo = $('btn-arrangement-undo');
    if (undo) undo.addEventListener('click', undoWord);
    const reset = $('btn-arrangement-reset');
    if (reset) reset.addEventListener('click', resetChunkWords);

    const startRecord = $('btn-start-record');
    if (startRecord) startRecord.addEventListener('click', startRecording);
    const stopRecord = $('btn-stop-record');
    if (stopRecord) stopRecord.addEventListener('click', () => stopRecording(true));
    const revealDirect = $('btn-reveal-direct');
    if (revealDirect) revealDirect.addEventListener('click', revealDirectly);
    const rerecordBtn = $('btn-rerecord');
    if (rerecordBtn) rerecordBtn.addEventListener('click', rerecord);
    const qariBtn = $('btn-qari-audio');
    if (qariBtn) qariBtn.addEventListener('click', playQariAudio);
    const stopQariBtn = $('btn-stop-qari');
    if (stopQariBtn) stopQariBtn.addEventListener('click', stopAudio);
    const done = $('btn-page-done');
    if (done) done.addEventListener('click', () => markResult('DONE'));
    const improve = $('btn-page-improve');
    if (improve) improve.addEventListener('click', () => markResult('IMPROVE'));
    const practice = $('btn-practice-again');
    if (practice) practice.addEventListener('click', practiceAgain);

    window.addEventListener('beforeunload', () => {
      stopAudio();
      cleanupRecording();
    });

    if (window.I18N && typeof I18N.onChange === 'function') {
      I18N.onChange(() => {
        renderAll();
      });
    }
  }

  async function boot() {
    bindEvents();
    try {
      const data = await api('tasks/consolidation.php', { redirectOn401: true });
      applyState(data, true);
      resetChunk(true);
      renderAll();
    } catch (e) {
      const loading = $('consolidation-loading');
      if (loading) {
        loading.innerHTML = `<p class="hint" style="color:var(--danger)">${escHtml(e.message)}</p>`;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
