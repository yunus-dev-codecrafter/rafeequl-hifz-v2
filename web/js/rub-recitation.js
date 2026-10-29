'use strict';

/* ==========================================================================
   Rafeequl Hifz — Full-rub' microphone recitation (تسميع الربع كاملاً)

   Optional final self-test on rub.html. The rub' is drawn word by word in the
   Uthmani script and every word stays hidden until it is recognised. A wrong
   word does not advance the cursor, so the text simply stops appearing.

   Recognition is done by the browser's Web Speech API (Chrome on Android).
   No audio is uploaded to our server and nothing is stored server-side.

   The alignment engine is deliberately tolerant: normalised Arabic, Uthmani
   rasm variants, and a small edit distance, so ordinary recitation is not
   punished for a dropped maddah or a merged word. This is a follow-along
   self-test, not a tajweed grader.
   ========================================================================== */

(function (global) {
  const CURRENT_THRESHOLD = 0.70;
  const SKIP_THRESHOLD = 0.90;
  const LOOKAHEAD = 3;
  const NOISE_LIMIT = 3;
  const MAX_PAIR_LENGTH = 14;

  const STORAGE_PROGRESS = 'hifz-rub-speech-progress-v1-';
  const STORAGE_RESULT = 'hifz-rub-speech-result-v1-';
  const STORAGE_SETTINGS = 'hifz-rub-speech-settings-v1';

  /* -----------------------------------------------------------------------
     Arabic normalisation
     ---------------------------------------------------------------------- */

  // Harakat, tanwin, shadda, sukun, superscript alef, waqf marks, rub' mark,
  // sajdah, end-of-ayah, small high letters, tatweel and honourifics.
  const MARKS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
  const ARABIC_DIGITS_RE = /[\u0660-\u0669\u06F0-\u06F9]/g;

  /**
   * Reduce a Uthmani word to the letters a speech recogniser is likely to
   * return. Spaces and punctuation are removed by the caller.
   */
  function normalizeWord(raw) {
    if (raw == null) return '';
    let s = String(raw);

    // Presentation forms / ligatures -> standard letters.
    if (s.normalize) {
      try { s = s.normalize('NFKC'); } catch (e) {}
    }

    s = s.replace(MARKS_RE, '');
    s = s.replace(ARABIC_DIGITS_RE, '');
    s = s.replace(/[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g, '\u0627'); // alef forms
    s = s.replace(/[\u0649\u0626]/g, '\u064A'); // alef maqsura / ya hamza -> ya
    s = s.replace(/\u0624/g, '\u0648'); // waw hamza -> waw
    s = s.replace(/\u0629/g, '\u0647'); // ta marbuta -> ha
    s = s.replace(/\u06A9/g, '\u0643'); // Persian kaf
    s = s.replace(/\u06CC/g, '\u064A'); // Persian yeh
    s = s.replace(/[^\u0621-\u064A]/g, ''); // keep Arabic letters only

    // Uthmani rasm words that ASR writes with a different long vowel.
    s = s
      .replace(/\u0627\u0644\u0635\u0644\u0648\u0647/g, '\u0627\u0644\u0635\u0644\u0627\u0647') // الصلوة -> الصلاة
      .replace(/\u0627\u0644\u0632\u0643\u0648\u0647/g, '\u0627\u0644\u0632\u0643\u0627\u0647') // الزكوة -> الزكاة
      .replace(/\u0627\u0644\u062D\u064A\u0648\u0647/g, '\u0627\u0644\u062D\u064A\u0627\u0647') // الحيوة -> الحياة
      .replace(/\u0627\u0644\u0631\u0628\u0648\u0627/g, '\u0627\u0644\u0631\u0628\u0627') // الربوا -> الربا
      // The hamzah on the ya has already been folded to ya above, so the
      // Uthmani الملئكة has become المليكه by this point.
      .replace(/\u0627\u0644\u0645\u0644\u064A\u0643\u0647/g, '\u0627\u0644\u0645\u0644\u0627\u064A\u0643\u0647') // المليكه -> الملايكه
      .replace(/\u0627\u0644\u0642\u0631\u0621\u0627\u0646/g, '\u0627\u0644\u0642\u0631\u0627\u0646'); // القرءان -> القرآن

    return s;
  }

  /** Split a transcript into raw word tokens. */
  function tokenize(text) {
    return String(text == null ? '' : text)
      .split(/\s+/)
      .map(function (w) { return w.trim(); })
      .filter(Boolean);
  }

  /* -----------------------------------------------------------------------
     Fuzzy word comparison
     ---------------------------------------------------------------------- */

  function editDistance(a, b) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    if (Math.abs(la - lb) > 2) return Math.abs(la - lb);

    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[lb];
  }

  // A single extra/missing و ف ب ل ك at the edge of a short word. This is the
  // common "بدأت من الوقف" case ("وما" vs "ما") without accepting a completely
  // different three-letter word.
  function isAffixOnly(a, b) {
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (long.length - short.length !== 1) return false;
    if (!long.startsWith(short) && !long.endsWith(short)) return false;
    const extra = long.startsWith(short) ? long.slice(-1) : long.slice(0, 1);
    return '\u0648\u0641\u0628\u0644\u0643'.indexOf(extra) !== -1;
  }

  /**
   * 1.0 for an exact normalised match, then a small, length-aware edit budget.
   * Short words are intentionally strict: they are where ASR errors and false
   * positives hurt most.
   */
  function wordScore(expected, heard) {
    if (!expected || !heard) return 0;
    if (expected === heard) return 1;
    const maxLen = Math.max(expected.length, heard.length);
    if (maxLen <= 2) return 0;

    const d = editDistance(expected, heard);
    if (maxLen === 3) return isAffixOnly(expected, heard) ? 0.70 : 0;
    if (maxLen <= 7) return d === 1 ? (1 - d / maxLen) : 0;
    return d <= 2 ? (1 - d / maxLen) : 0;
  }

  /* -----------------------------------------------------------------------
     Quran text -> token stream
     ---------------------------------------------------------------------- */

  function buildTokenStream(verses) {
    const tokens = [];
    const blocks = [];

    (verses || []).forEach(function (verse, verseIndex) {
      const words = [];
      tokenize(verse && verse.text).forEach(function (display, wordIndex) {
        const norm = normalizeWord(display);
        // A lone waqf/sajdah/rub' mark is not recitable: drop it from the
        // alignment stream (it remains visible in the normal rub' page).
        if (!norm) return;
        const token = {
          idx: tokens.length,
          verseIndex: verseIndex,
          wordIndex: wordIndex,
          display: display,
          norm: norm,
        };
        tokens.push(token);
        words.push(token);
      });
      if (words.length) {
        blocks.push({ verse: verse, verseIndex: verseIndex, words: words });
      }
    });

    return { tokens: tokens, blocks: blocks };
  }

  /* -----------------------------------------------------------------------
     Aligner
     ---------------------------------------------------------------------- */

  class Aligner {
    constructor(tokens) {
      this.tokens = tokens || [];
      this.reset();
    }

    reset() {
      this.cursor = 0;
      this.revealed = new Set();
      this.skipped = new Set();
      this.hinted = new Set();
      this.stalls = [];
      this.noiseStreak = 0;
      this.stallActive = false;
      this.pendingHeard = '';
    }

    get total() { return this.tokens.length; }
    get done() { return this.total > 0 && this.cursor >= this.total; }
    get progress() { return this.total > 0 ? this.cursor / this.total : 0; }

    currentToken() {
      return this.cursor < this.total ? this.tokens[this.cursor] : null;
    }

    /**
     * Try to match one heard token at expected position idx.
     * Also accepts a merged pair of expected words ("يا" + "أيها").
     */
    matchAt(idx, heard, threshold) {
      const token = this.tokens[idx];
      if (!token) return null;

      let score = wordScore(token.norm, heard);
      let end = idx + 1;

      const next = this.tokens[idx + 1];
      if (next && next.verseIndex === token.verseIndex) {
        const joined = token.norm + next.norm;
        if (joined.length <= MAX_PAIR_LENGTH) {
          const pairScore = wordScore(joined, heard);
          if (pairScore > score) {
            score = pairScore;
            end = idx + 2;
          }
        }
      }

      if (score < threshold) return null;
      return { end: end, score: score };
    }

    accept(match, from, type) {
      for (let i = from; i < match.end; i++) this.revealed.add(i);
      this.cursor = match.end;
      this.noiseStreak = 0;
      this.stallActive = false;
      this.pendingHeard = '';
      return { type: type, from: from, to: match.end, score: match.score };
    }

    /** Feed one raw heard word. Returns an event object or null. */
    processToken(raw) {
      if (this.done) return null;
      const heard = normalizeWord(raw);
      if (!heard) return null;

      // Two heard words that the recogniser split, while the mushaf has one
      // word ("يا" + "أيها" vs "يأيها").
      if (this.pendingHeard) {
        const merged = this.pendingHeard + heard;
        const mergedMatch = this.matchAt(this.cursor, merged, CURRENT_THRESHOLD);
        if (mergedMatch) return this.accept(mergedMatch, this.cursor, 'match');
        this.pendingHeard = '';
      }

      // Normal in-order match at the cursor.
      const match = this.matchAt(this.cursor, heard, CURRENT_THRESHOLD);
      if (match) return this.accept(match, this.cursor, 'match');

      // A confident match a little further ahead means words were skipped.
      // The skipped text stays hidden, so a mistake still does not reveal it.
      for (let off = 1; off <= LOOKAHEAD; off++) {
        const idx = this.cursor + off;
        if (idx >= this.total) break;
        const target = this.tokens[idx];
        if (!target || target.norm.length < 4) continue;
        const skipMatch = this.matchAt(idx, heard, SKIP_THRESHOLD);
        if (!skipMatch) continue;

        const from = this.cursor;
        for (let i = from; i < idx; i++) this.skipped.add(i);
        this.stalls.push({ kind: 'skip', from: from, to: idx });
        this.cursor = skipMatch.end;
        for (let i = idx; i < skipMatch.end; i++) this.revealed.add(i);
        this.noiseStreak = 0;
        this.stallActive = false;
        this.pendingHeard = '';
        return { type: 'skip', from: from, to: skipMatch.end, matched: idx };
      }

      // Unmatched heard word: keep it as a possible half of a split word and
      // remember it, but never move the cursor.
      this.pendingHeard = heard;
      this.noiseStreak += 1;
      if (this.noiseStreak >= NOISE_LIMIT) {
        const recorded = !this.stallActive;
        if (recorded) {
          const token = this.currentToken();
          this.stalls.push({
            kind: 'unmatched',
            at: this.cursor,
            verseIndex: token ? token.verseIndex : 0,
            wordIndex: token ? token.wordIndex : 0,
          });
          this.stallActive = true;
        }
        return { type: 'stall', at: this.cursor, recorded: recorded };
      }
      return { type: 'noise', heard: heard };
    }

    processText(text) {
      const events = [];
      const self = this;
      tokenize(text).forEach(function (word) {
        const ev = self.processToken(word);
        if (ev) events.push(ev);
        if (self.done) return;
      });
      return events;
    }

    /** Reveal the current word and move on (assisted). */
    hint() {
      if (this.done) return null;
      const idx = this.cursor;
      this.revealed.add(idx);
      this.hinted.add(idx);
      this.cursor = idx + 1;
      this.noiseStreak = 0;
      this.stallActive = false;
      this.pendingHeard = '';
      return idx;
    }

    /** Rewind to the beginning of the current verse. */
    rewindVerse() {
      if (!this.total) return null;
      const at = Math.min(this.cursor, this.total - 1);
      const verseIndex = this.tokens[at].verseIndex;
      let start = at;
      while (start > 0 && this.tokens[start - 1].verseIndex === verseIndex) start -= 1;

      [this.revealed, this.skipped, this.hinted].forEach(function (set) {
        for (let i = start; i < this.total; i++) set.delete(i);
      });
      this.cursor = start;
      this.noiseStreak = 0;
      this.stallActive = false;
      this.pendingHeard = '';
      return start;
    }

    snapshot() {
      return {
        cursor: this.cursor,
        revealed: Array.from(this.revealed),
        skipped: Array.from(this.skipped),
        hinted: Array.from(this.hinted),
        stalls: this.stalls.slice(),
      };
    }

    restore(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return false;
      const total = this.total;
      const valid = function (n) {
        return Number.isInteger(n) && n >= 0 && n < total;
      };
      this.cursor = Math.max(0, Math.min(total, Number(snapshot.cursor) || 0));
      this.revealed = new Set((snapshot.revealed || []).filter(valid));
      this.skipped = new Set((snapshot.skipped || []).filter(valid));
      this.hinted = new Set((snapshot.hinted || []).filter(valid));
      this.stalls = Array.isArray(snapshot.stalls) ? snapshot.stalls.slice() : [];
      this.noiseStreak = 0;
      this.stallActive = false;
      this.pendingHeard = '';
      return true;
    }

    summary() {
      const versesDone = new Set();
      const self = this;
      this.revealed.forEach(function (idx) {
        const token = self.tokens[idx];
        if (token) versesDone.add(token.verseIndex);
      });
      return {
        cursor: this.cursor,
        total: this.total,
        revealed: this.revealed.size,
        skipped: this.skipped.size,
        hinted: this.hinted.size,
        stalls: this.stalls.length,
        done: this.done,
        progress: this.progress,
        versesTouched: versesDone.size,
      };
    }
  }

  /* -----------------------------------------------------------------------
     UI / recognition controller
     ---------------------------------------------------------------------- */

  const MicRecitation = {
    __loaded: true,

    page: null,
    taskId: 0,
    tokens: [],
    verseBlocks: [],
    aligner: null,

    overlay: null,
    els: {},
    state: 'idle', // idle | intro | listening | paused | finished
    wantListening: false,
    recognition: null,
    sessionFinalized: null,
    restartTimer: null,
    starting: false,
    networkErrors: 0,
    lastHeard: '',
    lastError: '',
    debug: false,
    debugLog: [],

    elapsedMs: 0,
    clockBase: 0,
    clockId: null,
    wakeLock: null,

    assisted: false,
    showAll: false,
    lastVerseIndex: -1,
    hasProgress: false,
    lastResult: null,
    bound: false,
    saveTimer: null,

    t: function (key, fallback) {
      if (window.I18N && I18N.t) {
        const value = I18N.t(key);
        return value === key && fallback !== undefined ? fallback : value;
      }
      return fallback !== undefined ? fallback : key;
    },

    esc: function (value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    supportsSpeech: function () {
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    storageKey: function (kind) {
      return (kind === 'result' ? STORAGE_RESULT : STORAGE_PROGRESS) + this.taskId;
    },

    /* ------------------------------ Wiring ------------------------------ */

    attach: function (rubPage) {
      if (!rubPage || !rubPage.verses || !rubPage.verses.length) return;

      this.page = rubPage;
      this.debug = new URLSearchParams(location.search).has('debug');

      if (!this.bound) this.bindOnce();

      if (this.taskId === rubPage.taskId && this.aligner) {
        this.updateBadge();
        return;
      }

      this.taskId = rubPage.taskId;
      const built = buildTokenStream(rubPage.verses);
      this.tokens = built.tokens;
      this.verseBlocks = built.blocks;
      this.aligner = new Aligner(this.tokens);
      this.showAll = false;
      this.assisted = false;
      this.elapsedMs = 0;
      this.lastVerseIndex = -1;

      this.renderSheet();
      this.resetLiveUi();
      this.readSaved();
    },

    bindOnce: function () {
      if (this.bound) return;
      const self = this;

      this.overlay = document.getElementById('rub-mic-overlay');
      if (!this.overlay) return;
      this.bound = true;

      this.els = {
        intro: document.getElementById('rub-mic-intro'),
        live: document.getElementById('rub-mic-live'),
        report: document.getElementById('rub-mic-report'),
        start: document.getElementById('rub-mic-start'),
        resume: document.getElementById('rub-mic-resume'),
        cancel: document.getElementById('rub-mic-cancel'),
        close: document.getElementById('rub-mic-close'),
        supportNote: document.getElementById('rub-mic-support-note'),
        status: document.getElementById('rub-mic-status'),
        dot: document.getElementById('rub-mic-dot'),
        timer: document.getElementById('rub-mic-timer'),
        percent: document.getElementById('rub-mic-percent'),
        progress: document.getElementById('rub-mic-progress-bar'),
        sheet: document.getElementById('rub-mic-sheet'),
        stall: document.getElementById('rub-mic-stall'),
        pause: document.getElementById('rub-mic-pause'),
        hint: document.getElementById('rub-mic-hint'),
        rewind: document.getElementById('rub-mic-rewind'),
        showAll: document.getElementById('rub-mic-show-all'),
        finish: document.getElementById('rub-mic-finish'),
        liveNote: document.getElementById('rub-mic-live-note'),
        reportTitle: document.getElementById('rub-mic-report-title'),
        reportIcon: document.getElementById('rub-mic-report-icon'),
        reportSub: document.getElementById('rub-mic-report-sub'),
        reportVerses: document.getElementById('rub-mic-report-verses'),
        reportWords: document.getElementById('rub-mic-report-words'),
        reportStalls: document.getElementById('rub-mic-report-stalls'),
        reportTime: document.getElementById('rub-mic-report-time'),
        reportHints: document.getElementById('rub-mic-report-hints'),
        reportHintRow: document.getElementById('rub-mic-report-hint-row'),
        again: document.getElementById('rub-mic-again'),
        done: document.getElementById('rub-mic-done'),
        lastResult: document.getElementById('rub-mic-last'),
        debugTools: document.getElementById('rub-mic-debug'),
        debugBox: document.getElementById('rub-mic-debug-output'),
        debugInput: document.getElementById('rub-mic-debug-input'),
        debugRun: document.getElementById('rub-mic-debug-run'),
      };

      // Entry points (hero, dedicated card, end card).
      document.addEventListener('click', function (event) {
        const trigger = event.target.closest ? event.target.closest('.js-rub-mic-open') : null;
        if (trigger) {
          event.preventDefault();
          self.open();
        }
      });

      if (this.els.start) this.els.start.addEventListener('click', function () { self.begin(false); });
      if (this.els.resume) this.els.resume.addEventListener('click', function () { self.begin(true); });
      if (this.els.cancel) this.els.cancel.addEventListener('click', function () { self.close(); });
      if (this.els.close) this.els.close.addEventListener('click', function () { self.close(); });
      if (this.els.pause) this.els.pause.addEventListener('click', function () { self.togglePause(); });
      if (this.els.hint) this.els.hint.addEventListener('click', function () { self.useHint(); });
      if (this.els.rewind) this.els.rewind.addEventListener('click', function () { self.rewindVerse(); });
      if (this.els.showAll) this.els.showAll.addEventListener('click', function () { self.toggleShowAll(); });
      if (this.els.finish) this.els.finish.addEventListener('click', function () { self.finish(true); });
      if (this.els.again) this.els.again.addEventListener('click', function () { self.begin(false); });
      if (this.els.done) this.els.done.addEventListener('click', function () { self.close(); });
      if (this.els.debugRun) this.els.debugRun.addEventListener('click', function () { self.runDebugTranscript(); });

      if (this.overlay) {
        this.overlay.addEventListener('click', function (event) {
          if (event.target === self.overlay) self.close();
        });
      }

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!self.overlay || self.overlay.classList.contains('hidden')) return;
        self.close();
      });

      window.addEventListener('online', function () {
        if (self.state === 'intro') self.updateSupport();
      });
      window.addEventListener('offline', function () {
        if (self.state === 'intro') self.updateSupport();
      });

      if (window.I18N && I18N.onChange) {
        I18N.onChange(function () {
          if (self.overlay) I18N.translateContainer(self.overlay);
          if (self.verseBlocks.length && self.aligner) {
            self.lastVerseIndex = -1;
            self.renderSheet();
            self.updateProgress();
          }
          self.applyDynamicLabels();
          self.updateBadge();
          if (self.state === 'finished') self.updateStatus('finished');
        });
      }

      if (this.debug && this.els.debugTools) this.els.debugTools.classList.remove('hidden');
    },

    /* ------------------------------ Open / close ------------------------------ */

    open: function () {
      if (!this.aligner || !this.tokens.length) return;
      if (!this.overlay) this.bindOnce();
      if (!this.overlay) return;

      this.showAll = false;
      this.assisted = false;
      this.lastVerseIndex = -1;
      this.networkErrors = 0;
      this.lastError = '';
      this.overlay.classList.remove('hidden');
      document.body.classList.add('rub-mic-active');
      this.showIntro();
      this.updateSupport();
      this.readSaved();
      this.applyDynamicLabels();
      this.updateTimer();

      if (this.els.start) {
        try { this.els.start.focus(); } catch (e) {}
      }
    },

    close: function () {
      if (this.state === 'listening' || this.state === 'paused') {
        const ok = window.confirm(this.t('rub_mic_close_confirm', 'هل تريد إيقاف التسميع؟ سيُحفظ تقدمك على هذا الجهاز.'));
        if (!ok) return;
        this.saveProgressNow();
      }

      this.wantListening = false;
      this.state = 'idle';
      this.stopClock();
      this.safeStopRecognition();
      this.releaseWakeLock();
      clearTimeout(this.restartTimer);

      if (this.overlay) this.overlay.classList.add('hidden');
      document.body.classList.remove('rub-mic-active');
      this.hideLiveNote();
      this.updateBadge();
    },

    showIntro: function () {
      this.state = 'intro';
      if (this.els.intro) this.els.intro.classList.remove('hidden');
      if (this.els.live) this.els.live.classList.add('hidden');
      if (this.els.report) this.els.report.classList.add('hidden');
      if (this.els.stall) this.els.stall.classList.add('hidden');
      this.hideLiveNote();
      if (this.els.timer) this.els.timer.textContent = '00:00';
    },

    showLive: function () {
      this.state = this.state === 'paused' ? 'paused' : 'listening';
      if (this.els.intro) this.els.intro.classList.add('hidden');
      if (this.els.report) this.els.report.classList.add('hidden');
      if (this.els.live) this.els.live.classList.remove('hidden');
      if (this.els.sheet) this.els.sheet.classList.toggle('is-revealed', this.showAll);
      this.updateShowAllLabel();
    },

    updateSupport: function () {
      if (!this.els.supportNote || !this.els.start) return;
      let note = '';
      if (!window.isSecureContext) {
        note = this.t('rub_mic_needs_https', 'التسميع بالمايك يحتاج اتصالاً آمناً (HTTPS).');
      } else if (!this.supportsSpeech()) {
        note = this.t('rub_mic_unsupported', 'التعرف الصوتي غير متاح في هذا المتصفح. افتح التطبيق في Chrome على أندرويد.');
      } else if (!navigator.onLine) {
        note = this.t('rub_mic_offline', 'التسميع بالمايك يحتاج اتصالاً بالإنترنت.');
      }

      this.els.supportNote.textContent = note;
      this.els.supportNote.classList.toggle('hidden', !note);
      this.els.start.disabled = !!note;
      this.els.start.setAttribute('aria-disabled', note ? 'true' : 'false');
    },

    /* ------------------------------ Persistence ------------------------------ */

    readSaved: function () {
      if (!this.taskId) return;
      let progress = null;
      let result = null;
      try {
        const rawProgress = localStorage.getItem(this.storageKey('progress'));
        if (rawProgress) progress = JSON.parse(rawProgress);
        const rawResult = localStorage.getItem(this.storageKey('result'));
        if (rawResult) result = JSON.parse(rawResult);
      } catch (e) {}

      // Never resurrect an attempt from a different day even if the task id
      // happens to be reused.
      const currentDate = this.page && this.page.taskDate ? this.page.taskDate : '';
      if (currentDate && progress && progress.taskDate && progress.taskDate !== currentDate) {
        progress = null;
      }
      if (currentDate && result && result.date && result.date !== currentDate) {
        result = null;
      }

      const validProgress =
        progress &&
        Number.isInteger(progress.cursor) &&
        progress.cursor > 0 &&
        progress.cursor < this.tokens.length;

      this.hasProgress = !!validProgress;
      if (validProgress) {
        this.aligner.restore(progress);
        this.elapsedMs = Math.max(0, Number(progress.elapsedMs) || 0);
        this.assisted = !!progress.assisted;
        if (this.els.resume) {
          this.els.resume.classList.remove('hidden');
          this.els.resume.textContent = this.t('rub_mic_resume_btn', 'متابعة من آخر موضع') +
            ' (' + Math.round((this.aligner.cursor / this.tokens.length) * 100) + '%)';
        }
      } else {
        if (this.els.resume) this.els.resume.classList.add('hidden');
        // Do not overwrite an in-memory restored state with an empty one.
        if (this.state === 'idle') this.aligner.reset();
        this.elapsedMs = 0;
        this.assisted = false;
      }

      this.lastResult = result || null;
      this.updateStartLabel();
      this.updateBadge();
      this.renderSeedWords();
    },

    updateStartLabel: function () {
      if (!this.els.start) return;
      if (this.hasProgress) {
        this.els.start.textContent = this.t('rub_mic_start_over', 'ابدأ من جديد');
      } else if (this.lastResult) {
        this.els.start.textContent = this.t('rub_mic_again', 'أعد التسميع');
      } else {
        this.els.start.textContent = this.t('rub_mic_start', 'ابدأ التسميع');
      }
    },

    persistResult: function (payload, keepProgress) {
      if (!this.taskId) return;
      try {
        localStorage.setItem(this.storageKey('result'), JSON.stringify(payload));
        if (!keepProgress) localStorage.removeItem(this.storageKey('progress'));
      } catch (e) {}
      this.lastResult = payload;
      if (!keepProgress) this.hasProgress = false;
      this.updateStartLabel();
      this.updateBadge();
    },

    saveProgressNow: function () {
      if (!this.aligner || !this.taskId) return;
      if (this.aligner.cursor <= 0) {
        this.clearSavedProgress();
        return;
      }
      if (this.aligner.done) return;
      const snapshot = this.aligner.snapshot();
      snapshot.elapsedMs = Math.round(this.currentElapsed());
      snapshot.assisted = !!this.assisted;
      snapshot.updatedAt = Date.now();
      snapshot.taskDate = this.page ? this.page.taskDate : '';
      try {
        localStorage.setItem(this.storageKey('progress'), JSON.stringify(snapshot));
        this.hasProgress = true;
        this.updateStartLabel();
      } catch (e) {}
    },

    scheduleSave: function () {
      const self = this;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(function () { self.saveProgressNow(); }, 500);
    },

    clearSavedProgress: function () {
      try { localStorage.removeItem(this.storageKey('progress')); } catch (e) {}
      this.hasProgress = false;
      this.updateStartLabel();
    },

    /* ------------------------------ Start / stop ------------------------------ */

    begin: function (resume) {
      if (!this.aligner) return;
      if (this.state === 'listening') return;

      this.hideLiveNote();
      this.networkErrors = 0;
      this.lastError = '';

      if (!resume) {
        this.aligner.reset();
        this.elapsedMs = 0;
        this.assisted = false;
        this.showAll = false;
        this.clearSavedProgress();
        this.updateStartLabel();
      }

      this.showLive();
      this.renderAllWords();
      this.updateProgress();
      this.state = 'listening';
      this.wantListening = true;
      this.hideStall();
      this.updateStatus('listening');
      this.updatePauseLabel();
      this.startClock();
      this.acquireWakeLock();
      this.pausePageMedia();

      if (!this.supportsSpeech()) {
        this.wantListening = false;
        this.state = 'paused';
        this.stopClock();
        this.updateStatus('unsupported');
        this.showLiveNote('unsupported');
        return;
      }

      this.startRecognition();
    },

    startClock: function () {
      const self = this;
      clearInterval(this.clockId);
      this.clockBase = Date.now() - this.elapsedMs;
      this.updateTimer();
      this.clockId = setInterval(function () {
        self.elapsedMs = Date.now() - self.clockBase;
        self.updateTimer();
      }, 500);
    },

    stopClock: function () {
      if (this.clockId) {
        this.elapsedMs = Math.max(0, Date.now() - this.clockBase);
        clearInterval(this.clockId);
        this.clockId = null;
      }
      this.updateTimer();
    },

    currentElapsed: function () {
      if (this.clockId) return Math.max(0, Date.now() - this.clockBase);
      return Math.max(0, this.elapsedMs);
    },

    updateTimer: function () {
      if (!this.els.timer) return;
      const total = Math.floor(this.currentElapsed() / 1000);
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      this.els.timer.textContent = m + ':' + s;
    },

    togglePause: function () {
      if (this.state === 'listening') {
        this.state = 'paused';
        this.wantListening = false;
        clearTimeout(this.restartTimer);
        this.safeStopRecognition();
        this.stopClock();
        this.updateStatus('paused');
        this.updatePauseLabel();
        this.saveProgressNow();
        this.releaseWakeLock();
      } else if (this.state === 'paused') {
        this.state = 'listening';
        this.wantListening = true;
        this.networkErrors = 0;
        this.hideLiveNote();
        this.startClock();
        this.updateStatus('listening');
        this.updatePauseLabel();
        this.acquireWakeLock();
        this.startRecognition();
      }
    },

    updatePauseLabel: function () {
      if (!this.els.pause) return;
      this.els.pause.textContent = this.state === 'paused'
        ? this.t('rub_mic_resume', 'متابعة')
        : this.t('rub_mic_pause', 'إيقاف مؤقت');
    },

    pausePageMedia: function () {
      try {
        document.querySelectorAll('audio, video').forEach(function (el) {
          if (!el.paused) el.pause();
        });
      } catch (e) {}
    },

    async acquireWakeLock() {
      if (!navigator.wakeLock || this.wakeLock) return;
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {
        this.wakeLock = null;
      }
    },

    releaseWakeLock: function () {
      if (this.wakeLock) {
        try { this.wakeLock.release(); } catch (e) {}
        this.wakeLock = null;
      }
    },

    /* ------------------------------ Recognition ------------------------------ */

    startRecognition: function () {
      if (!this.wantListening) return;
      if (!this.recognition) this.recognition = this.createRecognition();
      if (!this.recognition) {
        this.showLiveNote('unsupported');
        return;
      }

      clearTimeout(this.restartTimer);
      try {
        this.recognition.start();
        this.starting = true;
      } catch (err) {
        // Already started: the existing session is fine.
        if (err && (err.name === 'InvalidStateError' || err.name === 'InvalidState')) return;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          this.failWith('permission');
          return;
        }
        this.scheduleRestart();
      }
    },

    createRecognition: function () {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return null;
      const self = this;
      const rec = new SpeechRecognition();
      rec.lang = 'ar-SA';
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      this.sessionFinalized = new Set();

      rec.onstart = function () {
        self.starting = false;
        self.sessionFinalized = new Set();
        self.networkErrors = 0;
        self.updateStatus('listening');
      };

      rec.onresult = function (event) {
        const results = event.results || [];
        for (let i = 0; i < results.length; i++) {
          if (!results[i] || !results[i].isFinal) continue;
          if (self.sessionFinalized.has(i)) continue;
          self.sessionFinalized.add(i);
          const alt = results[i][0];
          const transcript = alt && alt.transcript ? alt.transcript.trim() : '';
          if (transcript) self.consumeFinal(transcript);
        }
      };

      rec.onerror = function (event) {
        self.handleRecognitionError(event && event.error ? event.error : 'unknown');
      };

      rec.onend = function () {
        self.starting = false;
        if (self.wantListening && self.state === 'listening') {
          self.scheduleRestart();
        }
      };

      rec.onspeechstart = function () { self.updateStatus('speech'); };
      rec.onspeechend = function () { self.updateStatus('listening'); };
      rec.onaudiostart = function () { self.updateStatus('listening'); };

      return rec;
    },

    scheduleRestart: function () {
      const self = this;
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(function () {
        if (self.wantListening && self.state === 'listening') self.startRecognition();
      }, 450);
    },

    safeStopRecognition: function () {
      if (!this.recognition) return;
      try { this.recognition.abort(); } catch (e) {}
    },

    handleRecognitionError: function (error) {
      this.lastError = error;
      if (error === 'no-speech' || error === 'aborted') return;

      if (error === 'not-allowed' || error === 'service-not-allowed') {
        this.failWith('permission');
        return;
      }
      if (error === 'audio-capture') {
        this.failWith('mic');
        return;
      }
      if (error === 'network') {
        this.networkErrors += 1;
        if (this.networkErrors >= 2) {
          this.failWith('network');
        }
        return;
      }
      this.showLiveNote('error');
    },

    failWith: function (kind) {
      this.wantListening = false;
      this.state = 'paused';
      clearTimeout(this.restartTimer);
      this.stopClock();
      this.updateStatus(kind);
      this.showLiveNote(kind);
      this.releaseWakeLock();
      this.saveProgressNow();
    },

    consumeFinal: function (transcript) {
      // Late results can arrive just after a pause, a close, or a finish.
      // Never let them move the cursor while the session is not live.
      if (!this.aligner || !this.wantListening) return;
      this.lastHeard = transcript;
      if (this.debug) this.pushDebug('heard: ' + transcript);

      const events = this.aligner.processText(transcript);
      this.updateProgress();
      this.scheduleSave();

      let matched = false;
      let stalled = false;
      events.forEach(function (ev) {
        if (ev.type === 'match' || ev.type === 'skip') matched = true;
        if (ev.type === 'stall') stalled = true;
      });

      if (matched) this.hideStall();
      if (stalled) this.showStall();
      if (this.aligner.done) this.finish(false);
    },

    /* ------------------------------ Painting ------------------------------ */

    renderSheet: function () {
      if (!this.els.sheet) return;
      const self = this;
      const parts = [];

      this.verseBlocks.forEach(function (block) {
        const verse = block.verse || {};
        const surahName = window.I18N && I18N.getSurahName
          ? I18N.getSurahName(verse.surah)
          : ('سورة ' + verse.surah);
        const ayahLabel = (window.I18N && I18N.t ? I18N.t('rub_ayah') : 'الآية') + ' ' + verse.ayah;

        const words = block.words.map(function (token) {
          return '<span class="rub-mw" data-idx="' + token.idx + '" aria-hidden="true">' + self.esc(token.display) + '</span>';
        }).join(' ');

        parts.push(
          '<section class="rub-mic-verse" data-verse-index="' + block.verseIndex + '">' +
            '<header class="rub-mic-verse-head">' +
              '<span class="rub-mic-verse-surah">' + self.esc(surahName) + '</span>' +
              '<span class="rub-mic-verse-ayah">' + self.esc(ayahLabel) + '</span>' +
            '</header>' +
            '<p class="rub-mic-text" lang="ar" dir="rtl">' + words + '</p>' +
          '</section>'
        );
      });

      this.els.sheet.innerHTML = parts.join('');
      this.els.sheet.classList.toggle('is-revealed', this.showAll);

      // Cache elements once; ~300 spans is trivial.
      this.wordEls = [];
      this.els.sheet.querySelectorAll('.rub-mw').forEach(function (el) {
        self.wordEls[Number(el.dataset.idx)] = el;
      });
      this.verseEls = [];
      this.els.sheet.querySelectorAll('.rub-mic-verse').forEach(function (el) {
        self.verseEls[Number(el.dataset.verseIndex)] = el;
      });
    },

    renderSeedWords: function () {
      this.renderAllWords();
      this.updateProgress();
    },

    renderAllWords: function () {
      if (!this.wordEls || !this.aligner) return;
      const self = this;
      this.wordEls.forEach(function (el, idx) {
        if (!el) return;
        const revealed = self.aligner.revealed.has(idx);
        el.classList.toggle('is-heard', revealed);
        el.classList.toggle('is-hinted', self.aligner.hinted.has(idx));
        el.classList.toggle('is-current', idx === self.aligner.cursor && !self.aligner.done &&
          (self.state === 'listening' || self.state === 'paused'));
        el.setAttribute('aria-hidden', (revealed || self.showAll) ? 'false' : 'true');
      });
      if (this.els.sheet) this.els.sheet.classList.toggle('is-revealed', this.showAll);
    },

    updateProgress: function () {
      if (!this.aligner) return;
      const total = this.aligner.total;
      const percent = total ? Math.round((this.aligner.cursor / total) * 100) : 0;

      if (this.els.percent) this.els.percent.textContent = percent + '%';
      if (this.els.progress) {
        this.els.progress.style.width = percent + '%';
        if (this.els.progress.parentElement) {
          this.els.progress.parentElement.setAttribute('aria-valuenow', String(percent));
        }
      }
      if (this.els.hint) this.els.hint.disabled = this.aligner.done;
      if (this.els.rewind) this.els.rewind.disabled = this.aligner.cursor <= 0;
      if (this.els.pause) this.els.pause.disabled = this.aligner.done;

      this.renderAllWords();

      if (this.aligner.done) {
        this.hideStall();
        return;
      }

      const token = this.aligner.currentToken();
      if (!token) return;
      if (this.lastVerseIndex !== token.verseIndex) {
        this.lastVerseIndex = token.verseIndex;
        this.scrollToVerse(token.verseIndex);
      }
    },

    scrollToVerse: function (verseIndex) {
      const el = this.verseEls ? this.verseEls[verseIndex] : null;
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch (e) {
        try { el.scrollIntoView(); } catch (e2) {}
      }
    },

    useHint: function () {
      if (!this.aligner || this.aligner.done) return;
      const idx = this.aligner.hint();
      if (idx == null) return;
      this.assisted = true;
      this.hideStall();
      this.updateProgress();
      this.saveProgressNow();
      if (this.aligner.done) this.finish(false);
    },

    rewindVerse: function () {
      if (!this.aligner) return;
      const start = this.aligner.rewindVerse();
      if (start == null) return;
      this.lastVerseIndex = -1;
      this.hideStall();
      this.updateProgress();
      this.scrollToVerse(this.aligner.currentToken() ? this.aligner.currentToken().verseIndex : 0);
      this.saveProgressNow();
    },

    toggleShowAll: function () {
      this.showAll = !this.showAll;
      if (this.showAll) this.assisted = true;
      if (this.els.sheet) this.els.sheet.classList.toggle('is-revealed', this.showAll);
      this.renderAllWords();
      this.updateShowAllLabel();
    },

    updateShowAllLabel: function () {
      if (!this.els.showAll) return;
      this.els.showAll.textContent = this.showAll
        ? this.t('rub_mic_hide_all', 'إخفاء النص')
        : this.t('rub_mic_show_all', 'إظهار النص');
      this.els.showAll.setAttribute('aria-pressed', this.showAll ? 'true' : 'false');
    },

    showStall: function () {
      if (!this.els.stall) return;
      this.els.stall.classList.remove('hidden');
    },

    hideStall: function () {
      if (!this.els.stall) return;
      this.els.stall.classList.add('hidden');
    },

    /* ------------------------------ Status / notes ------------------------------ */

    updateStatus: function (kind) {
      if (!this.els.status) return;
      const map = {
        listening: ['rub_mic_status_listening', '🎙️ يسمعك… اقرأ الآن'],
        speech: ['rub_mic_status_speech', '🎙️ يسمع صوتك…'],
        paused: ['rub_mic_status_paused', 'متوقف مؤقتًا'],
        finished: ['rub_mic_status_finished', 'تم التسميع'],
        permission: ['rub_mic_status_permission', 'لم يُسمح باستخدام الميكروفون'],
        network: ['rub_mic_status_network', 'تعذر الاتصال بخدمة التعرف'],
        mic: ['rub_mic_status_mic', 'لم يُعثر على ميكروفون'],
        unsupported: ['rub_mic_status_unsupported', 'التعرف الصوتي غير متاح'],
        error: ['rub_mic_status_error', 'حدث خطأ في التعرف'],
      };
      const row = map[kind] || map.listening;
      this.els.status.textContent = this.t(row[0], row[1]);

      if (this.els.dot) {
        this.els.dot.className = 'rub-mic-dot';
        if (kind === 'listening' || kind === 'speech') this.els.dot.classList.add('is-live');
        if (kind === 'paused' || kind === 'finished') this.els.dot.classList.add('is-paused');
        if (kind === 'permission' || kind === 'network' || kind === 'mic' || kind === 'error') {
          this.els.dot.classList.add('is-error');
        }
      }
    },

    showLiveNote: function (kind) {
      if (!this.els.liveNote) return;
      const map = {
        permission: ['rub_mic_permission_help', 'اسمح باستخدام الميكروفون من إعدادات الموقع ثم أعد المحاولة.'],
        network: ['rub_mic_network_help', 'التعرف الصوتي يحتاج اتصالاً بالإنترنت. تحقق من الاتصال ثم تابع.'],
        mic: ['rub_mic_mic_help', 'لم يُعثر على ميكروفون. وصّل سماعة أو تحقق من إعدادات الجهاز.'],
        unsupported: ['rub_mic_unsupported', 'التعرف الصوتي غير متاح في هذا المتصفح. افتح التطبيق في Chrome على أندرويد.'],
        error: ['rub_mic_error_help', 'تعذر التعرف الآن. يمكنك المتابعة من آخر موضع أو إعادة المحاولة.'],
      };
      const row = map[kind] || map.error;
      this.els.liveNote.textContent = this.t(row[0], row[1]);
      this.els.liveNote.dataset.kind = kind;
      this.els.liveNote.classList.remove('hidden');
      if (this.state === 'listening') this.state = 'paused';
      this.wantListening = false;
      clearTimeout(this.restartTimer);
      this.safeStopRecognition();
      this.stopClock();
      this.releaseWakeLock();
      this.updatePauseLabel();
      this.saveProgressNow();
    },

    hideLiveNote: function () {
      if (this.els.liveNote) {
        this.els.liveNote.classList.add('hidden');
        this.els.liveNote.textContent = '';
        this.els.liveNote.dataset.kind = '';
      }
    },

    /* ------------------------------ Finish / report ------------------------------ */

    finish: function (manual) {
      if (!this.aligner) return;
      if (this.state === 'finished') return;
      const wasListening = this.state === 'listening' || this.state === 'paused';
      if (manual && wasListening && !this.aligner.done) {
        const ok = window.confirm(this.t('rub_mic_finish_confirm', 'هل تريد إنهاء التسميع الآن؟ سيُحفظ ما أتممته.'));
        if (!ok) return;
      }

      this.wantListening = false;
      clearTimeout(this.restartTimer);
      this.safeStopRecognition();
      this.stopClock();
      this.releaseWakeLock();
      this.state = 'finished';

      const summary = this.aligner.summary();
      const self = this;
      const versesDone = this.verseBlocks.filter(function (block) {
        return block.words.every(function (word) { return self.aligner.revealed.has(word.idx); });
      }).length;
      const clean = summary.done && summary.stalls === 0 && summary.skipped === 0 &&
        summary.hinted === 0 && !this.assisted;
      const payload = {
        completed: summary.done,
        clean: clean,
        assisted: !!this.assisted,
        revealed: summary.revealed,
        total: summary.total,
        skipped: summary.skipped,
        stalled: summary.stalls,
        hinted: summary.hinted,
        verses: versesDone,
        elapsedMs: Math.round(this.currentElapsed()),
        at: Date.now(),
        date: this.page ? this.page.taskDate : '',
      };

      if (!payload.completed) this.saveProgressNow();
      this.persistResult(payload, !payload.completed);
      this.showReport(payload);
      this.updateStatus('finished');
      this.lastVerseIndex = -1;

      if (summary.done && window.AudioEngine && AudioEngine.playCelebration) {
        try { AudioEngine.playCelebration(); } catch (e) {}
      } else if (window.AudioEngine && AudioEngine.playSuccess) {
        try { AudioEngine.playSuccess(); } catch (e) {}
      }
    },

    showReport: function (payload) {
      if (this.els.intro) this.els.intro.classList.add('hidden');
      if (this.els.live) this.els.live.classList.add('hidden');
      if (this.els.report) this.els.report.classList.remove('hidden');

      const seconds = Math.round(payload.elapsedMs / 1000);
      const m = String(Math.floor(seconds / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');

      if (this.els.reportTitle) {
        if (!payload.completed) {
          this.els.reportTitle.textContent = this.t('rub_mic_report_partial_title', 'توقفت قبل إتمام الربع');
        } else if (payload.clean) {
          this.els.reportTitle.textContent = this.t('rub_mic_report_clean_title', 'تسميع كامل ✓');
        } else {
          this.els.reportTitle.textContent = this.t('rub_mic_report_done_title', 'أتممت تسميع الربع');
        }
      }

      if (this.els.reportIcon) {
        this.els.reportIcon.textContent = payload.completed ? '✓' : '⏸';
        this.els.reportIcon.classList.toggle('is-partial', !payload.completed);
      }

      if (this.els.reportSub) {
        if (!payload.completed) {
          this.els.reportSub.textContent = this.t('rub_mic_report_partial_sub', 'يمكنك المتابعة من آخر موضع في أي وقت.')
            .replace('{percent}', Math.round((payload.revealed / Math.max(1, payload.total)) * 100));
        } else if (payload.clean) {
          this.els.reportSub.textContent = this.t('rub_mic_report_clean_sub', 'بارك الله فيك — أتممت الربع من أوله إلى آخره دون توقف.');
        } else {
          this.els.reportSub.textContent = this.t('rub_mic_report_done_sub', 'راجع المواضع التي توقفت عندها ثم أعد التسميع إن شئت.');
        }
      }

      if (this.els.reportVerses) this.els.reportVerses.textContent = String(payload.verses);
      if (this.els.reportWords) this.els.reportWords.textContent = payload.revealed + ' / ' + payload.total;
      if (this.els.reportStalls) this.els.reportStalls.textContent = String(payload.stalled);
      if (this.els.reportTime) this.els.reportTime.textContent = m + ':' + s;

      if (this.els.reportHintRow && this.els.reportHints) {
        const showHints = payload.hinted > 0;
        this.els.reportHintRow.classList.toggle('hidden', !showHints);
        this.els.reportHints.textContent = String(payload.hinted);
      }

      if (this.els.again) this.els.again.textContent = this.t('rub_mic_again', 'أعد التسميع');
      if (this.els.done) this.els.done.textContent = this.t('rub_mic_done', 'تم');
    },

    /* ------------------------------ Badge / labels ------------------------------ */

    updateBadge: function () {
      if (!this.els.lastResult) return;
      const result = this.lastResult;
      let progressRaw = null;
      if (this.taskId) {
        try { progressRaw = localStorage.getItem(this.storageKey('progress')); } catch (e) {}
      }

      if (progressRaw) {
        try {
          const p = JSON.parse(progressRaw);
          const cursor = Number(p.cursor);
          if (!Number.isFinite(cursor)) throw new Error('bad progress');
          const pct = Math.round((cursor / Math.max(1, this.tokens.length)) * 100);
          this.els.lastResult.textContent = this.t('rub_mic_badge_progress', 'تسميع غير مكتمل') + ' · ' + pct + '%';
          this.els.lastResult.classList.remove('hidden', 'is-clean');
          return;
        } catch (e) {}
      }

      if (result) {
        const seconds = Math.round((Number(result.elapsedMs) || 0) / 1000);
        const time = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        let text;
        if (result.completed && result.clean) {
          text = '✓ ' + this.t('rub_mic_badge_clean', 'تسميع كامل') + ' · ' + time;
        } else if (result.completed) {
          text = this.t('rub_mic_badge_done', 'تسميع كامل') + ' · ' +
            (Number(result.stalled) || 0) + ' ' + this.t('rub_mic_stalls_unit', 'توقف') + ' · ' + time;
        } else {
          text = this.t('rub_mic_badge_partial', 'آخر محاولة') + ' · ' +
            Math.round((result.revealed / Math.max(1, result.total)) * 100) + '%';
        }
        this.els.lastResult.textContent = text;
        this.els.lastResult.classList.remove('hidden');
        this.els.lastResult.classList.toggle('is-clean', !!(result.completed && result.clean));
        return;
      }

      this.els.lastResult.classList.add('hidden');
    },

    applyDynamicLabels: function () {
      this.updatePauseLabel();
      this.updateShowAllLabel();
      if (this.els.finish) this.els.finish.textContent = this.t('rub_mic_finish', 'إنهاء');
      if (this.els.hint) this.els.hint.textContent = this.t('rub_mic_hint', 'تلميح');
      if (this.els.rewind) this.els.rewind.textContent = this.t('rub_mic_rewind', 'إعادة الآية');
      this.updateStartLabel();
      if (this.els.done) this.els.done.textContent = this.t('rub_mic_done', 'تم');
      if (this.els.again) this.els.again.textContent = this.t('rub_mic_again', 'أعد التسميع');
      if (this.state === 'finished' && this.lastResult) {
        this.showReport(this.lastResult);
      }
    },

    resetLiveUi: function () {
      this.hideStall();
      this.hideLiveNote();
      if (this.els.status) this.updateStatus('listening');
      if (this.els.percent) this.els.percent.textContent = '0%';
      if (this.els.progress) {
        this.els.progress.style.width = '0%';
        if (this.els.progress.parentElement) {
          this.els.progress.parentElement.setAttribute('aria-valuenow', '0');
        }
      }
    },

    /* ------------------------------ Debug lab ------------------------------ */

    pushDebug: function (line) {
      if (!this.debug) return;
      this.debugLog.push(line);
      if (this.debugLog.length > 24) this.debugLog.shift();
      this.renderDebug();
    },

    renderDebug: function (extra) {
      if (!this.debug || !this.els.debugBox) return;
      const info = {
        cursor: this.aligner ? this.aligner.cursor : 0,
        total: this.aligner ? this.aligner.total : 0,
        state: this.state,
        lastError: this.lastError,
        lastHeard: this.lastHeard,
        stalls: this.aligner ? this.aligner.stalls.length : 0,
        skipped: this.aligner ? this.aligner.skipped.size : 0,
        log: this.debugLog.slice(-8),
      };
      this.els.debugBox.textContent = JSON.stringify(extra ? Object.assign(info, extra) : info, null, 2);
    },

    runDebugTranscript: function () {
      if (!this.debug || !this.els.debugInput) return;
      const text = this.els.debugInput.value.trim();
      if (!text) return;
      const probe = new Aligner(this.tokens);
      const events = probe.processText(text);
      this.renderDebug({
        probe: {
          cursor: probe.cursor,
          total: probe.total,
          done: probe.done,
          revealed: probe.revealed.size,
          skipped: Array.from(probe.skipped),
          stalls: probe.stalls,
          events: events,
        },
      });
    },
  };

  /* -------------------------------------------------------------------------
     Exports
     ---------------------------------------------------------------------- */

  global.RubRecitation = MicRecitation;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeWord: normalizeWord,
      tokenize: tokenize,
      wordScore: wordScore,
      editDistance: editDistance,
      buildTokenStream: buildTokenStream,
      Aligner: Aligner,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
