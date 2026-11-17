'use strict';

/* ==========================================================================
   Rafeequl Hifz — HIFZ_JADID New Memorization Flow (Consolidation Style)

   Flow:
     1. Verse 1: User reads and memorizes without a counter loop.
        When done, records recitation from memory. Immediately upon stopping,
        verse 1 pops up in the Mushaf and recorded recitation plays back.
     2. Verse 2+: User memorizes the new verse, then records cumulatively:
        from the last verse of the previous page all the way to the newly
        memorized verse while looking at the Mushaf text upon completion.
     3. Repeat until the end of the page is reached.
     4. Final pass: User records the complete page, reviews it, and marks
        the page as completed.

   Visuals & UX:
     90% resemblance with the consolidation system (hero card, progress ring,
     recorder box, audio playback, Mushaf text cards, review notice, etc.).
   ========================================================================== */

(function () {
  const HIFZ_STATE_VERSION = 3;
  const HIFZ_LOCAL_PREFIX = 'rh_hifz_verse_v3_';
  const HIFZ_LEGACY_V2_PREFIX = 'rh_hifz_verse_v2_';
  const HIFZ_LEGACY_V1_PREFIX = 'rh_hifz_verse_v1_';
  const HIFZ_TEXT_HIDDEN_KEY = 'rh_hifz_text_hidden';
  const AUDIO_BASE = 'https://everyayah.com/data/Alafasy_128kbps/';

  function hifzT(key, params, fallback) {
    try {
      if (window.I18N && typeof I18N.t === 'function') {
        const val = I18N.t(key, params || {});
        if (val != null && val !== key) return val;
      }
    } catch (e) {}
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
      const name = I18N.getSurahName(Number(id));
      if (name) return name;
    }
    const list = window.SURAHS_DATA || [];
    const surah = list.find((s) => s.id === Number(id));
    return surah ? (surah.name_ar || surah.name || String(id)) : String(id);
  }

  function audioUrl(surah, ayah) {
    const pad = (n) => String(n).padStart(3, '0');
    return AUDIO_BASE + pad(Number(surah)) + pad(Number(ayah)) + '.mp3';
  }

  function promptWords(text, count = 4) {
    if (!text) return [];
    return text.trim().split(/\s+/).slice(0, count);
  }

  function hifzNewState(page, total) {
    return {
      v: HIFZ_STATE_VERSION,
      page,
      verses: Array(total).fill(0),
      final_pass: 0,
      current: 0,
      substage: 'memorize', // 'memorize' | 'recording' | 'review' | 'final_recording' | 'final_review' | 'complete'
      complete: false,
      // Backward-compatible fields:
      reps: Array(total).fill(0),
      links: Array(total).fill(0),
      page_pass: 0,
    };
  }

  function hifzScore(state) {
    if (!state) return -1;
    let score = 0;
    if (Array.isArray(state.verses)) {
      state.verses.forEach((v) => { score += (Number(v) >= 1 ? 20 : 0); });
    } else if (Array.isArray(state.reps)) {
      state.reps.forEach((v) => { score += Math.min(20, Number(v) || 0); });
    }
    score += (Number(state.final_pass || state.page_pass) >= 1 ? 100 : 0);
    if (state.complete) score += 1000;
    return score;
  }

  function hifzNormalizeState(raw, page, total) {
    if (!raw || typeof raw !== 'object') return null;
    const version = Number(raw.v) || 0;
    if (Number(raw.page) !== Number(page)) return null;

    // Version 3
    if (version === HIFZ_STATE_VERSION && Array.isArray(raw.verses)) {
      if (raw.verses.length !== total) return null;
      const verses = raw.verses.map((v) => (Number(v) >= 1 ? 1 : 0));
      const finalPass = Number(raw.final_pass || raw.page_pass) >= 1 ? 1 : 0;
      const allVersesDone = verses.length > 0 && verses.every((v) => v === 1);
      const isComplete = !!raw.complete && allVersesDone && finalPass >= 1;
      const validSubstages = ['memorize', 'recording', 'review', 'final_recording', 'final_review', 'complete'];
      let substage = validSubstages.includes(raw.substage) ? raw.substage : 'memorize';
      if (isComplete) substage = 'complete';

      return {
        v: HIFZ_STATE_VERSION,
        page,
        verses,
        final_pass: finalPass,
        current: Math.max(0, Math.min(total - 1, Number(raw.current) || 0)),
        substage,
        complete: isComplete,
        reps: verses.map((v) => (v ? 20 : 0)),
        links: verses.map((v, i) => (i > 0 && v ? 20 : 0)),
        page_pass: finalPass,
      };
    }

    // Version 2 upgrade
    if (version === 2 && Array.isArray(raw.reps)) {
      if (raw.reps.length !== total) return null;
      const verses = raw.reps.map((r) => (Number(r) >= 20 ? 1 : 0));
      const finalPass = Number(raw.page_pass) >= 1 ? 1 : 0;
      const allVersesDone = verses.length > 0 && verses.every((v) => v === 1);
      const isComplete = !!raw.complete && allVersesDone && finalPass >= 1;
      return {
        v: HIFZ_STATE_VERSION,
        page,
        verses,
        final_pass: finalPass,
        current: Math.max(0, Math.min(total - 1, Number(raw.current) || 0)),
        substage: isComplete ? 'complete' : (allVersesDone ? 'final_recording' : 'memorize'),
        complete: isComplete,
        reps: verses.map((v) => (v ? 20 : 0)),
        links: verses.map((v, i) => (i > 0 && v ? 20 : 0)),
        page_pass: finalPass,
      };
    }

    return null;
  }

  /* ---------------------------------------------------------------------
   * HifzPage Controller
   * ------------------------------------------------------------------ */

  const HifzPage = {
    task: null,
    page: 0,
    verses: [],
    prevVerse: null,
    quran: null,
    tafsir: null,
    tafsirPage: 0,
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

    // Voice recording & playback state (matches consolidation system)
    recording: false,
    recordingPending: false,
    mediaRecorder: null,
    mediaStream: null,
    recordingChunks: [],
    recordingTimerId: null,
    recordingStartTime: 0,
    recordedAudioUrl: null,
    recordingSession: 0,

    // Qari audio playback
    audio: null,
    playingIndex: -1,
    playing: false,

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
        <div class="consolidation-loading">
          <div class="consolidation-spinner" aria-hidden="true"></div>
          <p>${hifzEsc(hifzT('hifz_loading', {}, 'جاري تجهيز صفحة الحفظ الجديد…'))}</p>
        </div>`;

      try {
        await Promise.all([
          this.loadQuran(),
          this.loadTafsir(this.page),
        ]);
        if (version !== this.version) return;

        this.verses = this.buildVerses(this.page);
        if (!this.verses.length) {
          throw new Error(hifzT('hifz_error_no_verses', {}, 'لم يتم العثور على آيات لهذه الصفحة.'));
        }

        this.prevVerse = this.getPreviousPageLastVerse(this.page);
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
          const surah = Number(section.surahId);
          verses.push({
            page,
            surah,
            ayah,
            surahName: hifzSurahName(surah),
            text: this.getVerseText(surah, ayah),
            key: `${surah}:${ayah}`,
            isPrevPage: false,
          });
        }
      });
      return verses;
    },

    getPreviousPageLastVerse(page) {
      if (!page || page <= 1) return null;
      const prevPage = page - 1;
      const sections = (typeof getPageVerseSections === 'function') ? getPageVerseSections(prevPage) : [];
      if (!sections || !sections.length) return null;
      const lastSection = sections[sections.length - 1];
      const surah = Number(lastSection.surahId);
      const ayah = Number(lastSection.toAyah);
      return {
        page: prevPage,
        surah,
        ayah,
        surahName: hifzSurahName(surah),
        text: this.getVerseText(surah, ayah),
        key: `${surah}:${ayah}`,
        isPrevPage: true,
      };
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
        throw new Error(hifzT('hifz_load_error', {}, 'تعذر تحميل نص الآيات.'));
      }
      this.quran = await response.json();
      return this.quran;
    },

    async loadTafsir(page) {
      if (this.tafsir && this.tafsirPage === page) return this.tafsir;
      try {
        const data = await API.call('data/get_tafsir.php?page=' + page);
        if (data && data.verses) {
          this.tafsir = data.verses;
          this.tafsirPage = page;
          return this.tafsir;
        }
      } catch (e) {
        // Fallback or offline
      }
      this.tafsir = this.tafsir || {};
      return this.tafsir;
    },

    getVerseText(surah, ayah) {
      if (!this.quran) return '';
      const s = this.quran[String(surah)];
      return (s && s[ayah - 1]) || '';
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
      } catch (error) {}
    },

    clearLocal() {
      try {
        localStorage.removeItem(this.localKey());
        const id = this.task && this.task.id ? String(this.task.id) : ('page-' + this.page);
        localStorage.removeItem(HIFZ_LEGACY_V2_PREFIX + id);
        localStorage.removeItem(HIFZ_LEGACY_V1_PREFIX + id);
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
        case 'pending': return hifzT('hifz_sync_pending', {}, 'جارٍ حفظ التقدم…');
        case 'error': return hifzT('hifz_save_error', {}, 'التقدم محفوظ على هذا الجهاز.');
        case 'local': return hifzT('hifz_local_only', {}, 'التقدم محفوظ على هذا الجهاز.');
        case 'synced': return hifzT('hifz_synced', {}, 'تم حفظ التقدم ✓');
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

    scheduleSave(delay = 1000) {
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
      if (!this.task.id || !this.serverReady) {
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
        } else if (error && error.status === 409) {
          this.dirty = false;
          this.syncState = 'synced';
        } else {
          this.dirty = true;
          this.syncState = 'error';
          if (!silent) {
            showToast(hifzT('hifz_save_error', {}, 'تعذر حفظ التقدم.'), true);
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

    /* ---------------------------------------------------------------------
     * Voice Recording Engine (Consolidation Mirror)
     * ------------------------------------------------------------------ */

    isRecordingSupported() {
      return typeof navigator !== 'undefined'
        && !!navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === 'function'
        && typeof MediaRecorder !== 'undefined';
    },

    async requestMic() {
      if (!this.isRecordingSupported()) throw new Error('unsupported');
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
    },

    getBestMimeType() {
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
        if (MediaRecorder.isTypeSupported(t)) return t;
      }
      return '';
    },

    cleanupRecording() {
      this.recordingSession += 1;
      if (this.recordingTimerId) {
        clearInterval(this.recordingTimerId);
        this.recordingTimerId = null;
      }
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (e) {}
        }
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
      if (this.recordedAudioUrl) {
        URL.revokeObjectURL(this.recordedAudioUrl);
        this.recordedAudioUrl = null;
      }
      this.recording = false;
      this.recordingPending = false;
      this.recordingChunks = [];
    },

    async startRecording() {
      if (this.recording || this.recordingPending) return;
      if (!this.isRecordingSupported()) {
        showToast(hifzT('page_mic_unsupported', {}, 'التسجيل الصوتي غير مدعوم في هذا المتصفح.'), true);
        return;
      }
      this.stopAudio();
      this.cleanupRecording();

      const session = this.recordingSession;
      this.recordingPending = true;
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      this.state.substage = isFinal ? 'final_recording' : 'recording';
      this.paint();

      let stream;
      try {
        stream = await this.requestMic();
      } catch (err) {
        if (session === this.recordingSession) {
          this.recordingPending = false;
          showToast(hifzT('page_mic_permission_denied', {}, 'تعذر الوصول إلى الميكروفون. يرجى السماح بالإذن أو كشف الآيات مباشرة.'), true);
          this.paint();
        }
        return;
      }

      this.recordingPending = false;
      if (session !== this.recordingSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.mediaStream = stream;
      const chunks = this.recordingChunks = [];
      const mimeType = this.getBestMimeType();
      let recorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch (e) {
        try {
          recorder = new MediaRecorder(stream);
        } catch (err) {
          stream.getTracks().forEach((track) => track.stop());
          this.mediaStream = null;
          this.recording = false;
          showToast(hifzT('page_recording_failed', {}, 'تعذر بدء التسجيل. يمكنك إعادة المحاولة.'), true);
          this.paint();
          return;
        }
      }
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (session !== this.recordingSession) return;
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onerror = () => {
        if (session !== this.recordingSession) return;
        this.cleanupRecording();
        showToast(hifzT('page_recording_failed', {}, 'حدث خطأ أثناء التسجيل.'), true);
        this.paint();
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (this.mediaStream === stream) this.mediaStream = null;
        if (session !== this.recordingSession) return;

        if (this.mediaRecorder === recorder) this.mediaRecorder = null;
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: finalMime });
        if (blob.size > 0) {
          this.recordedAudioUrl = URL.createObjectURL(blob);
        }

        this.recording = false;
        // On stop recording: verse pops up immediately and audio auto-plays
        if (isFinal) {
          this.state.final_pass = 1;
          this.state.complete = true;
          this.state.substage = 'final_review';
        } else {
          this.state.verses[this.state.current] = 1;
          this.state.reps[this.state.current] = 20;
          if (this.state.current > 0) {
            this.state.links[this.state.current] = 20;
          }
          this.state.substage = 'review';
        }

        this.persistNow();
        this.paint();
        this.scrollRecitationReveal();

        const player = document.getElementById('recorded-audio');
        if (this.recordedAudioUrl && player) {
          player.src = this.recordedAudioUrl;
          try {
            const p = player.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch (e) {}
        }
      };

      this.recordingStartTime = Date.now();
      this.recording = true;
      try {
        recorder.start(250);
      } catch (e) {
        stream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.recording = false;
        showToast(hifzT('page_recording_failed', {}, 'تعذر بدء التسجيل.'), true);
        this.paint();
        return;
      }

      this.paint();

      if (this.recordingTimerId) clearInterval(this.recordingTimerId);
      this.recordingTimerId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        const timerEl = document.getElementById('recording-timer');
        if (timerEl) {
          timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
      }, 500);
    },

    stopRecording() {
      if (this.recordingTimerId) {
        clearInterval(this.recordingTimerId);
        this.recordingTimerId = null;
      }
      this.recording = false;
      const recorder = this.mediaRecorder;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (e) {
          try { recorder.onstop(); } catch (err) {}
        }
        return;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      if (isFinal) {
        this.state.final_pass = 1;
        this.state.complete = true;
        this.state.substage = 'final_review';
      } else {
        this.state.verses[this.state.current] = 1;
        this.state.reps[this.state.current] = 20;
        if (this.state.current > 0) {
          this.state.links[this.state.current] = 20;
        }
        this.state.substage = 'review';
      }
      this.persistNow();
      this.paint();
      this.scrollRecitationReveal();
    },

    rerecord() {
      this.recordingPending = false;
      this.cleanupRecording();
      this.startRecording();
    },

    revealDirectly() {
      this.stopAudio();
      this.cleanupRecording();
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      if (isFinal) {
        this.state.final_pass = 1;
        this.state.complete = true;
        this.state.substage = 'final_review';
      } else {
        this.state.verses[this.state.current] = 1;
        this.state.reps[this.state.current] = 20;
        if (this.state.current > 0) {
          this.state.links[this.state.current] = 20;
        }
        this.state.substage = 'review';
      }
      this.persistNow();
      this.paint();
      this.scrollRecitationReveal();
    },

    scrollRecitationReveal() {
      const pageEl = document.getElementById('recitation-page');
      if (!pageEl || typeof pageEl.scrollIntoView !== 'function') return;
      try { pageEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
    },

    /* ---------------------------------------------------------------------
     * Qari Audio Playback
     * ------------------------------------------------------------------ */

    ensureAudio() {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.preload = 'none';
      }
      return this.audio;
    },

    stopAudio() {
      this.playing = false;
      this.playingIndex = -1;
      if (this.audio) {
        this.audio.onended = null;
        this.audio.onerror = null;
        try { this.audio.pause(); } catch (e) {}
      }
      const recPlayer = document.getElementById('recorded-audio');
      if (recPlayer) {
        try { recPlayer.pause(); } catch (e) {}
      }
      document.querySelectorAll('.consolidation-ayah.is-playing').forEach((el) => {
        el.classList.remove('is-playing');
      });
      const stopQariBtn = document.getElementById('btn-stop-qari');
      if (stopQariBtn) stopQariBtn.classList.add('hidden');
      const qariBtn = document.getElementById('btn-qari-audio');
      if (qariBtn) qariBtn.classList.remove('hidden');
    },

    playQariRange(versesList) {
      if (!versesList || !versesList.length) return;
      const recPlayer = document.getElementById('recorded-audio');
      if (recPlayer) {
        try { recPlayer.pause(); } catch (e) {}
      }
      this.playing = true;
      this.playingIndex = 0;
      const audio = this.ensureAudio();

      const qariBtn = document.getElementById('btn-qari-audio');
      if (qariBtn) qariBtn.classList.add('hidden');
      const stopQariBtn = document.getElementById('btn-stop-qari');
      if (stopQariBtn) stopQariBtn.classList.remove('hidden');

      const playAt = (index) => {
        if (!this.playing || index >= versesList.length) {
          this.stopAudio();
          return;
        }
        this.playingIndex = index;
        const verse = versesList[index];
        document.querySelectorAll('.consolidation-ayah.is-playing').forEach((el) => {
          el.classList.remove('is-playing');
        });
        const current = document.querySelector(`.consolidation-ayah[data-ayah-key="${String(verse.key).replace(/"/g, '\\"')}"]`);
        if (current) current.classList.add('is-playing');

        audio.onended = () => playAt(index + 1);
        audio.onerror = () => {
          showToast(hifzT('page_audio_error', {}, 'تعذر تشغيل التلاوة. تأكد من الاتصال.'), true);
          this.stopAudio();
        };
        audio.src = audioUrl(verse.surah, verse.ayah);
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => this.stopAudio());
        }
      };

      playAt(0);
    },

    /* ---------------------------------------------------------------------
     * Navigation & Progression
     * ------------------------------------------------------------------ */

    onVerseMemorized() {
      // User finished reading & memorizing verse: start recording
      this.stopAudio();
      this.cleanupRecording();
      this.startRecording();
    },

    onNextVerse() {
      this.stopAudio();
      this.cleanupRecording();
      const total = this.verses.length;
      if (this.state.current < total - 1) {
        this.state.current += 1;
        this.state.substage = 'memorize';
        this.persistNow();
        this.paint();
        this.scrollRailToActive();
      } else {
        // All verses memorized -> move to final page recording
        this.state.substage = 'final_recording';
        this.persistNow();
        this.paint();
        this.scrollRailToActive();
      }
    },

    onGoToFinalPass() {
      this.stopAudio();
      this.cleanupRecording();
      this.state.substage = 'final_recording';
      this.persistNow();
      this.paint();
      this.scrollRailToActive();
    },

    jumpToVerse(index) {
      if (index < 0 || index >= this.verses.length) return;
      this.stopAudio();
      this.cleanupRecording();
      this.state.current = index;
      const isDone = this.state.verses[index] === 1;
      this.state.substage = isDone ? 'review' : 'memorize';
      this.persistNow();
      this.paint();
      this.scrollRailToActive();
    },

    markPageDoneDirect() {
      if (!this.state) return;
      const confirmed = typeof window.confirm === 'function'
        ? window.confirm(hifzT('hifz_mark_page_confirm', { page: this.page }, `تسجيل صفحة ${this.page} كمحفظة؟`))
        : true;
      if (!confirmed) return;

      const total = this.verses.length;
      this.state.verses = new Array(total).fill(1);
      this.state.reps = new Array(total).fill(20);
      this.state.links = new Array(total).fill(20);
      this.state.links[0] = 0;
      this.state.final_pass = 1;
      this.state.page_pass = 1;
      this.state.complete = true;
      this.state.substage = 'complete';
      this.state.current = total - 1;

      this.writeLocal();
      void this.completeTask();
    },

    async completeTask() {
      if (!this.state || !this.state.complete) return;
      clearTimeout(this.saveTimer);
      this.dirty = false;
      const button = document.getElementById('btn-complete-page');
      if (button) button.disabled = true;

      try {
        await API.call('tasks/update_progress.php', {
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
        showToast(hifzT('hifz_page_celebration', { page: this.page }, `مبارك! أتممت حفظ صفحة ${this.page}.`), false);
        await loadSharedData();
        renderTaskPage('HIFZ_JADID');
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error && error.message ? error.message : hifzT('hifz_complete_error', {}, 'تعذر إتمام المهمة الآن.'), true);
      }
    },

    /* ---------------------------------------------------------------------
     * HTML Generators (Consolidation UI Resemblance)
     * ------------------------------------------------------------------ */

    getRecitedRange() {
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      if (isFinal) {
        return this.prevVerse ? [this.prevVerse].concat(this.verses) : this.verses.slice();
      }
      const idx = this.state.current;
      if (idx === 0) {
        return [this.verses[0]];
      }
      const list = this.verses.slice(0, idx + 1);
      return this.prevVerse ? [this.prevVerse].concat(list) : list;
    },

    stats() {
      const totalVerses = this.verses.length;
      const doneVerses = this.state ? this.state.verses.filter((v) => Number(v) >= 1).length : 0;
      const finalDone = (this.state && Number(this.state.final_pass) >= 1) ? 1 : 0;
      const totalSteps = totalVerses + 1;
      const doneSteps = doneVerses + finalDone;
      const percent = this.state && this.state.complete ? 100 : Math.round((doneSteps / totalSteps) * 100);
      return { totalVerses, doneVerses, finalDone, totalSteps, doneSteps, percent };
    },

    heroHtml() {
      const stats = this.stats();
      const taskTitle = (hifzIsEnglish() && this.task.title_en) ? this.task.title_en : (this.task.title_ar || 'الحفظ الجديد');
      const rangeHint = (typeof formatPageVerseSummary === 'function')
        ? formatPageVerseSummary(this.page, hifzIsEnglish())
        : '';
      const circ = 2 * Math.PI * 18;
      const offset = circ * (1 - stats.percent / 100);

      return `
        <section class="consolidation-hero">
          <div class="consolidation-hero-main">
            <div class="consolidation-eyebrow">🟢 ${hifzEsc(taskTitle)}</div>
            <h1 class="consolidation-title">${hifzEsc(hifzT('hifz_page_title', { page: this.page }, `صفحة ${this.page}`))}</h1>
            <div class="consolidation-refs">${rangeHint ? hifzEsc(rangeHint) : ''}</div>
          </div>
          <div class="consolidation-ring" role="img" aria-label="${stats.percent}%">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle class="consolidation-ring-bg" cx="22" cy="22" r="18"></circle>
              <circle class="consolidation-ring-fg" cx="22" cy="22" r="18"
                      style="stroke-dasharray: ${circ.toFixed(1)}; stroke-dashoffset: ${offset.toFixed(1)};"></circle>
            </svg>
            <strong>${stats.percent}%</strong>
          </div>
        </section>`;
    },

    metaHtml() {
      const stats = this.stats();
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      const stepText = isFinal
        ? hifzT('hifz_stage_final_record', {}, 'التسجيل الختامي للصفحة')
        : hifzT('hifz_verse_of', { current: this.state.current + 1, total: stats.totalVerses }, `الآية ${this.state.current + 1} من ${stats.totalVerses}`);
      const modeText = hifzT('hifz_mode_badge', {}, 'حفظ وتسميع غيباً');

      return `
        <div class="consolidation-meta">
          <span class="consolidation-chip is-done">✓ ${hifzEsc(stepText)}</span>
          <span class="consolidation-chip">${hifzEsc(modeText)}</span>
          <span class="consolidation-chip" id="hifz-sync-status" data-state="${this.syncState}">${hifzEsc(this.syncLabel())}</span>
        </div>`;
    },

    railHtml() {
      const total = this.verses.length;
      const active = this.state.current;
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';

      const chips = this.verses.map((verse, index) => {
        const done = Number(this.state.verses[index]) >= 1;
        const current = index === active && !isFinal && !this.state.complete;
        return `
          <button type="button" class="hifz-verse-chip ${done ? 'is-done' : ''} ${current ? 'is-active' : ''}"
                  data-verse-idx="${index}"
                  title="${hifzEsc(`${verse.surahName} · ${verse.surah}:${verse.ayah}`)}">
            ${index + 1}
            ${done ? '<span class="hifz-chip-check" aria-hidden="true">✓</span>' : ''}
          </button>`;
      }).join('');

      const finalDone = Number(this.state.final_pass) >= 1;
      const finalActive = isFinal && !this.state.complete;
      const finalChip = `
        <button type="button" class="hifz-verse-chip is-final-chip ${finalDone ? 'is-done' : ''} ${finalActive ? 'is-active' : ''}"
                id="chip-final-pass"
                title="${hifzEsc(hifzT('hifz_final_pass_label', {}, 'التسجيل الختامي للصفحة'))}">
          📖 ${hifzEsc(hifzT('hifz_final_pass_short', {}, 'الختام'))}
          ${finalDone ? '<span class="hifz-chip-check" aria-hidden="true">✓</span>' : ''}
        </button>`;

      return `
        <div class="hifz-rail-wrap">
          <div class="hifz-rail-head">
            <span>${hifzEsc(hifzT('hifz_verse_rail_label', {}, 'آيات الصفحة:'))}</span>
            <span>${isFinal ? hifzEsc(hifzT('hifz_stage_final_record', {}, 'التسجيل الختامي')) : hifzEsc(hifzT('hifz_verse_of', { current: active + 1, total }, `${active + 1} من ${total}`))}</span>
          </div>
          <div class="hifz-rail" id="hifz-verse-rail">${chips}${finalChip}</div>
        </div>`;
    },

    promptHtml(rangeVerses, isFinal) {
      const first = rangeVerses[0];
      const last = rangeVerses[rangeVerses.length - 1];
      const words = promptWords(first ? first.text : '', 5);

      let label = '';
      let rangeDesc = '';
      if (isFinal) {
        label = hifzT('hifz_final_record_prompt', {}, 'التسجيل الختامي: اقرأ الصفحة كاملة غيباً من أولها إلى آخرها.');
        rangeDesc = this.prevVerse
          ? `${hifzT('hifz_prev_page_verse_badge', {}, 'آخر آية من ص')} ${this.prevVerse.page} (${this.prevVerse.surahName} ${this.prevVerse.ayah}) ← ${hifzT('hifz_page_end_label', {}, 'نهاية الصفحة')}`
          : `${rangeVerses[0].surahName} ${rangeVerses[0].ayah} ← ${last.surahName} ${last.ayah}`;
      } else if (rangeVerses.length === 1) {
        label = hifzT('hifz_recite_prompt_single', {}, 'المطلوب تسميعه وتسجيله غيباً:');
        rangeDesc = `${first.surahName} · ${hifzT('page_ayah_word', {}, 'الآية')} ${first.ayah}`;
      } else {
        label = hifzT('hifz_recite_prompt_cumulative', {}, 'المطلوب تسميعه وتسجيله غيباً (ربط تراكمي):');
        const startLabel = first.isPrevPage
          ? `${hifzT('hifz_prev_page_verse_badge', {}, 'آخر آية من ص')} ${first.page} (${first.surahName} ${first.ayah})`
          : `${first.surahName} ${first.ayah}`;
        rangeDesc = `${startLabel} ← ${last.surahName} ${last.ayah}`;
      }

      return `
        <div class="consolidation-prompt">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; margin-bottom:0.45rem;">
            <span class="consolidation-prompt-label">${hifzEsc(label)}</span>
            <span class="consolidation-chip" style="font-size:0.75rem;">${hifzEsc(rangeDesc)}</span>
          </div>
          <div class="consolidation-prompt-words" dir="rtl">
            ${words.map((w) => `<span>${hifzEsc(w)}</span>`).join('')}
            ${words.length ? `<span style="opacity:0.6;">…</span>` : ''}
          </div>
        </div>`;
    },

    recorderBoxHtml(rangeVerses) {
      if (this.recording) {
        return `
          <div class="consolidation-recorder-box">
            <div class="recorder-state recorder-state-active" style="align-items: center; text-align: center;">
              <div class="recording-pulse-badge" style="margin: 0.6rem auto; display: inline-flex;">
                <span class="recording-dot"></span>
                <span>${hifzEsc(hifzT('page_recording_active', {}, 'جارٍ التسجيل... سمّع غيباً'))}</span>
                <span class="recording-timer" id="recording-timer">00:00</span>
              </div>
              <div class="consolidation-actions" style="justify-content: center;">
                <button type="button" class="btn btn-danger btn-stop-record" id="btn-stop-record">
                  ⏹️ ${hifzEsc(hifzT('page_stop_recording', {}, 'إيقاف التسجيل وعرض المصحف للمراجعة'))}
                </button>
              </div>
            </div>
          </div>`;
      }

      if (this.state.substage === 'memorize') {
        return `
          <div class="consolidation-recorder-box" style="text-align:center; padding:1.2rem;">
            <p class="hint" style="margin:0 0 0.85rem; font-size:0.95rem;">
              ${hifzEsc(hifzT('hifz_read_memorize_hint', {}, 'اقرأ الآية وتدبرها واحفظها جيداً. عند الانتهاء، اضغط على زر التسجيل أدناه لتسميعها غيباً:'))}
            </p>
            <div class="consolidation-actions" style="justify-content: center; gap: 0.65rem;">
              <button type="button" class="btn btn-success btn-record-main" id="btn-start-memorized">
                🎙️ ${hifzEsc(hifzT('hifz_btn_memorized_record', {}, 'أتممت الحفظ — تسجيل التلاوة'))}
              </button>
            </div>
          </div>`;
      }

      if (this.state.substage === 'recording' || this.state.substage === 'final_recording') {
        return `
          <div class="consolidation-recorder-box">
            <div class="recorder-state recorder-state-idle" style="align-items: center; text-align: center;">
              <div class="consolidation-actions" style="justify-content: center; gap: 0.65rem; flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-record-main" id="btn-start-record"${this.recordingPending ? ' disabled' : ''}>
                  🎙️ ${hifzEsc(hifzT('page_start_recording', {}, 'ابدأ تسجيل التلاوة الآن'))}
                </button>
                <button type="button" class="btn btn-ghost" id="btn-reveal-direct">
                  ${hifzEsc(hifzT('page_reveal_without_record', {}, 'كشف الآيات مباشرة بدون تسجيل'))}
                </button>
              </div>
            </div>
          </div>`;
      }

      // substage === 'review' or 'final_review'
      return `
        <div class="consolidation-recorder-box">
          <div class="recorder-state recorder-state-playback">
            <div class="playback-card" style="margin: 0.5rem 0; padding: 0.85rem; border-radius: 14px; background: rgba(15, 118, 110, 0.05); border: 1px solid rgba(15, 118, 110, 0.16);">
              ${this.recordedAudioUrl ? `
                <div style="font-size: 0.92rem; font-weight: 700; color: var(--primary, #0f766e); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                  <span>🎙️</span>
                  <span>${hifzEsc(hifzT('page_my_recording_label', {}, 'تسجيل تلاوتك:'))}</span>
                </div>
                <audio controls class="recorded-audio-player" id="recorded-audio" src="${this.recordedAudioUrl}" style="width: 100%; height: 42px;"></audio>
              ` : ''}
              <div class="playback-sub-actions" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button type="button" class="btn btn-ghost btn-sm" id="btn-rerecord">
                  🔄 ${hifzEsc(hifzT('page_rerecord', {}, 'إعادة التسجيل'))}
                </button>
                <button type="button" class="btn btn-ghost btn-sm${this.playing ? ' hidden' : ''}" id="btn-qari-audio">
                  🔊 ${hifzEsc(hifzT('page_listen_qari', {}, 'استمع للقارئ (مشاري العفاسي)'))}
                </button>
                <button type="button" class="btn btn-ghost btn-sm${!this.playing ? ' hidden' : ''}" id="btn-stop-qari">
                  ⏹️ ${hifzEsc(hifzT('page_stop_qari', {}, 'إيقاف تلاوة القارئ'))}
                </button>
              </div>
            </div>
            <p class="consolidation-review-notice">
              ${hifzEsc(hifzT('hifz_review_listen_hint', {}, 'استمع لتسجيلك وقارنه بنص المصحف أدناه لكشف أي خطأ أو سقط:'))}
            </p>
          </div>
        </div>`;
    },

    mushafRangeHtml(rangeVerses) {
      return `
        <div id="recitation-page" class="consolidation-page-text" dir="rtl">
          ${rangeVerses.map((v) => {
            const isPrev = !!v.isPrevPage;
            const refTitle = isPrev
              ? `${hifzT('hifz_prev_page_verse_badge', {}, 'آخر آية من الصفحة السابقة')} (ص ${v.page}) • ${v.surahName} ${hifzT('page_ayah_word', {}, 'آية')} ${v.ayah}`
              : `${v.surahName} • ${hifzT('page_ayah_word', {}, 'آية')} ${v.ayah}`;
            return `
              <div class="consolidation-ayah ${isPrev ? 'is-prev-page-ayah' : ''}" data-ayah-key="${hifzEsc(v.key)}">
                <div class="consolidation-ayah-ref" style="${isPrev ? 'color: #b45309; font-weight: 700;' : ''}">
                  ${isPrev ? '🏷️ ' : ''}${hifzEsc(refTitle)}
                </div>
                <p>${hifzEsc(v.text || '…')}</p>
              </div>`;
          }).join('')}
        </div>`;
    },

    actionsHtml() {
      const substage = this.state.substage;
      const total = this.verses.length;
      const current = this.state.current;

      let primaryBtn = '';
      if (substage === 'memorize') {
        primaryBtn = `
          <button type="button" id="btn-primary-memorized" class="btn btn-success hifz-main-action">
            🎙️ ${hifzEsc(hifzT('hifz_btn_memorized_record', {}, 'أتممت الحفظ — تسجيل التلاوة'))}
          </button>`;
      } else if (substage === 'recording') {
        primaryBtn = `
          <button type="button" id="btn-primary-stop" class="btn btn-danger hifz-main-action">
            ⏹️ ${hifzEsc(hifzT('page_stop_recording', {}, 'إيقاف التسجيل وعرض المصحف'))}
          </button>`;
      } else if (substage === 'review') {
        if (current < total - 1) {
          primaryBtn = `
            <button type="button" id="btn-next-verse" class="btn btn-primary hifz-main-action">
              ${hifzEsc(hifzT('hifz_btn_next_verse', {}, 'الانتقال إلى الآية التالية ←'))}
            </button>`;
        } else {
          primaryBtn = `
            <button type="button" id="btn-to-final-pass" class="btn btn-primary hifz-main-action">
              ${hifzEsc(hifzT('hifz_btn_go_final_recording', {}, 'الانتقال إلى التسجيل الختامي للصفحة ←'))}
            </button>`;
        }
      } else if (substage === 'final_recording') {
        primaryBtn = `
          <button type="button" id="btn-primary-stop-final" class="btn btn-danger hifz-main-action">
            ⏹️ ${hifzEsc(hifzT('page_stop_recording', {}, 'إيقاف التسجيل وعرض المصحف'))}
          </button>`;
      } else if (substage === 'final_review' || substage === 'complete') {
        primaryBtn = `
          <button type="button" id="btn-complete-page" class="btn btn-success hifz-main-action">
            ✓ ${hifzEsc(hifzT('hifz_mark_page_done_btn', {}, 'إتمام حفظ الصفحة وتثبيتها'))}
          </button>`;
      }

      return `
        <div class="stage-actions is-sticky hifz-actions">
          <div class="stage-primary-actions">${primaryBtn}</div>
          <div class="hifz-sub-actions">
            <button type="button" id="btn-mark-page-done" class="btn btn-ghost stage-icon-btn" title="${hifzEsc(hifzT('hifz_mark_page_done', {}, 'تسجيل إتمام الصفحة مباشرة'))}">
              ✓ ${hifzEsc(hifzT('hifz_mark_page_done', {}, 'إتمام الصفحة مباشرة'))}
            </button>
            <button type="button" id="btn-focus" class="btn btn-ghost btn-focus-toggle stage-icon-btn" title="${hifzEsc(hifzT('focus_mode_title', {}, 'التركيز'))}">
              <span class="focus-enter-label">🎯 ${hifzEsc(hifzT('focus_mode', {}, 'التركيز'))}</span>
              <span class="focus-exit-label">✅ ${hifzEsc(hifzT('focus_exit', {}, 'خروج'))}</span>
            </button>
            <button type="button" id="btn-view-mushaf" class="btn-mushaf-view stage-icon-btn" title="${hifzEsc(hifzT('btn_view_mushaf', {}, 'عرض المصحف'))}">
              ${hifzEsc(hifzT('btn_view_mushaf', {}, 'المصحف'))}
            </button>
            <button type="button" id="btn-open-mistake" class="btn btn-danger stage-icon-btn" title="${hifzEsc(hifzT('btn_open_mistake', {}, 'تسجيل خطأ'))}">
              ${hifzEsc(hifzT('btn_open_mistake', {}, 'تسجيل خطأ'))}
            </button>
          </div>
        </div>`;
    },

    stageMemorizeHtml() {
      const verse = this.verses[this.state.current];
      const isFirst = this.state.current === 0;
      const title = `${verse.surahName} · ${hifzT('page_ayah_word', {}, 'الآية')} ${verse.ayah}`;
      const hint = isFirst
        ? hifzT('hifz_verse1_hint', {}, 'اقرأ الآية الأولى وتدبر معناها من التفسير المختصر أدناه واحفظها. عند الانتهاء، اضغط على زر التسجيل أسفل الشاشة لتسميعها غيباً.')
        : hifzT('hifz_verse_next_hint', {}, 'احفظ الآية الجديدة وتدبر معناها من التفسير المختصر، ثم ستسجل رابطاً من آخر آية في الصفحة السابقة حتى هذه الآية.');

      const tafsirEntry = this.tafsir && this.tafsir[verse.key];
      const tafsirText = tafsirEntry
        ? (hifzIsEnglish() ? (tafsirEntry.en || tafsirEntry.ar) : (tafsirEntry.ar || tafsirEntry.en))
        : '';

      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%; gap:0.6rem;">
              <div>
                <h2>${hifzEsc(title)}</h2>
                <p class="hint">${hifzEsc(hint)}</p>
              </div>
              <div class="hifz-verse-tools" style="flex:0 0 auto;">
                <button type="button" id="hifz-play-single" class="btn btn-ghost btn-sm" title="${hifzEsc(hifzT('hifz_play_verse', {}, 'استماع'))}">🔊</button>
                <button type="button" id="hifz-toggle-text" class="btn btn-ghost btn-sm">
                  ${this.textHidden ? hifzEsc(hifzT('hifz_show_text', {}, 'إظهار النص')) : hifzEsc(hifzT('hifz_hide_text', {}, 'إخفاء النص'))}
                </button>
              </div>
            </div>
          </div>

          <div class="consolidation-page-text" style="margin:1rem 0;" dir="rtl">
            <div class="consolidation-ayah">
              <p class="hifz-verse-text ${this.textHidden ? 'is-hidden' : ''}" id="hifz-verse-text">${hifzEsc(verse.text || '…')}</p>
            </div>
          </div>

          <!-- Mukhtasar Tafsir Card (Replaces redundant button) -->
          <div class="hifz-tafsir-card" dir="rtl">
            <div class="hifz-tafsir-header">
              <span class="hifz-tafsir-title">📖 ${hifzEsc(hifzT('hifz_mukhtasar_tafsir_title', {}, 'المختصر في التفسير'))}</span>
              <span class="hifz-tafsir-ref">${hifzEsc(verse.surahName)} • ${hifzEsc(hifzT('page_ayah_word', {}, 'الآية'))} ${verse.ayah}</span>
            </div>
            <div class="hifz-tafsir-body">
              <p class="hifz-tafsir-text">${hifzEsc(tafsirText || hifzT('hifz_tafsir_loading', {}, 'جاري تحميل التفسير…'))}</p>
            </div>
            <div class="hifz-tafsir-footer">
              <span class="hifz-tafsir-source">${hifzEsc(hifzT('hifz_mukhtasar_source', {}, 'مركز تفسير للدراسات القرآنية'))}</span>
            </div>
          </div>
        </section>`;
    },

    stageRecitingOrReviewHtml() {
      const rangeVerses = this.getRecitedRange();
      const isFinal = this.state.substage === 'final_recording' || this.state.substage === 'final_review';
      const isReview = this.state.substage === 'review' || this.state.substage === 'final_review';

      let stageTitle = '';
      let stageHint = '';
      if (isFinal) {
        stageTitle = isReview
          ? hifzT('hifz_final_review_title', {}, 'الاستماع الختامي للصفحة ومراجعتها')
          : hifzT('hifz_stage_final_record', {}, 'التسجيل الختامي للصفحة كاملة');
        stageHint = isReview
          ? hifzT('hifz_final_review_hint', {}, 'استمع لتسجيل الصفحة كاملة وقارنها بالمصحف، ثم أتمم حفظ الصفحة.')
          : hifzT('hifz_final_record_hint', {}, 'سجّل الصفحة كاملة غيباً من أولها إلى آخرها.');
      } else {
        stageTitle = isReview
          ? hifzT('hifz_stage_review_title', {}, 'المراجعة والاستماع لتسجيلك')
          : hifzT('hifz_stage_record_title', {}, 'تسجيل التلاوة غيباً');
        stageHint = isReview
          ? hifzT('hifz_review_hint', {}, 'استمع إلى تسجيلك وأنت تنظر في المصحف لكشف أي خطأ.')
          : hifzT('hifz_record_hint', {}, 'اقرأ من ذاكرتك أثناء التسجيل، ثم أوقف التسجيل لتستمع لتلاوتك وتقارنها بالمصحف.');
      }

      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div>
              <h2>${hifzEsc(stageTitle)}</h2>
              <p class="hint">${hifzEsc(stageHint)}</p>
            </div>
          </div>

          ${this.promptHtml(rangeVerses, isFinal)}
          ${this.recorderBoxHtml(rangeVerses)}
          ${isReview ? this.mushafRangeHtml(rangeVerses) : ''}
        </section>`;
    },

    completeHtml() {
      const total = this.verses.length;
      const description = hifzT(
        'hifz_completed_desc',
        { page: this.page, total },
        `بارك الله فيك! أتممت حفظ صفحة ${this.page} كاملة (${total} آية) وسجلت تلاوتها بنجاح.`
      );
      return `
        <section class="consolidation-stage">
          <div class="consolidation-success" role="status">
            <div class="consolidation-success-icon" aria-hidden="true">✓</div>
            <h2>${hifzEsc(hifzT('hifz_completed_title', {}, 'تم إتمام الحفظ الجديد'))}</h2>
            <p>${hifzEsc(description)}</p>
          </div>
          <div class="consolidation-actions" style="justify-content: center; margin-top: 1.2rem;">
            <a href="dashboard.html" class="btn btn-primary btn-block">
              ${hifzEsc(hifzT('back_to_dashboard', {}, 'العودة لدفتر اليوم'))}
            </a>
          </div>
        </section>`;
    },

    paint() {
      const container = document.getElementById('task-content');
      if (!container || !this.state) return;

      let bodyHtml = '';
      if (this.state.complete) {
        bodyHtml = this.completeHtml();
      } else if (this.state.substage === 'memorize') {
        bodyHtml = this.stageMemorizeHtml();
      } else {
        bodyHtml = this.stageRecitingOrReviewHtml();
      }

      container.innerHTML = `
        ${this.heroHtml()}
        ${this.metaHtml()}
        ${this.railHtml()}
        ${bodyHtml}
        ${this.actionsHtml()}
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
        { page: this.page, total },
        `بارك الله فيك! أتممت حفظ صفحة ${this.page} كاملة (${total} آية).`
      );
      container.innerHTML = `
        ${this.heroHtml()}
        <section class="consolidation-stage">
          <div class="consolidation-success" role="status">
            <div class="consolidation-success-icon" aria-hidden="true">✓</div>
            <h2>${hifzEsc(hifzT('hifz_completed_title', {}, 'تم إتمام الحفظ الجديد'))}</h2>
            <p>${hifzEsc(description)}</p>
          </div>
          <div class="consolidation-actions" style="justify-content: center; margin-top: 1.2rem;">
            <a href="dashboard.html" class="btn btn-primary btn-block">
              ${hifzEsc(hifzT('back_to_dashboard', {}, 'العودة لدفتر اليوم'))}
            </a>
          </div>
        </section>`;
    },

    paintError(error) {
      const container = document.getElementById('task-content');
      if (!container) return;
      const message = (error && error.message) ? error.message : hifzT('hifz_load_error', {}, 'تعذر تحميل الآيات.');
      container.innerHTML = `
        <div class="task-page-head hifz-head">
          <h2>${hifzEsc(hifzT('hifz_load_error', {}, 'تعذر تحميل نص الآيات.'))}</h2>
          <p class="hint">${hifzEsc(message)}</p>
          <button type="button" id="hifz-retry" class="btn btn-primary">${hifzEsc(hifzT('hifz_retry', {}, 'إعادة المحاولة'))}</button>
        </div>`;
      const retry = document.getElementById('hifz-retry');
      if (retry) retry.addEventListener('click', () => this.mount());
    },

    bindEvents() {
      // Memorized -> Start recording
      const primaryMemBtn = document.getElementById('btn-primary-memorized');
      if (primaryMemBtn) primaryMemBtn.addEventListener('click', () => this.onVerseMemorized());

      // Start recording
      const startRecBtn = document.getElementById('btn-start-record');
      if (startRecBtn) startRecBtn.addEventListener('click', () => this.startRecording());

      // Stop recording
      const stopRecBtn = document.getElementById('btn-stop-record');
      if (stopRecBtn) stopRecBtn.addEventListener('click', () => this.stopRecording());

      const primaryStopBtn = document.getElementById('btn-primary-stop');
      if (primaryStopBtn) primaryStopBtn.addEventListener('click', () => this.stopRecording());

      const primaryStopFinalBtn = document.getElementById('btn-primary-stop-final');
      if (primaryStopFinalBtn) primaryStopFinalBtn.addEventListener('click', () => this.stopRecording());

      // Reveal directly
      const revealBtn = document.getElementById('btn-reveal-direct');
      if (revealBtn) revealBtn.addEventListener('click', () => this.revealDirectly());

      // Re-record
      const rerecordBtn = document.getElementById('btn-rerecord');
      if (rerecordBtn) rerecordBtn.addEventListener('click', () => this.rerecord());

      // Qari audio
      const qariBtn = document.getElementById('btn-qari-audio');
      if (qariBtn) qariBtn.addEventListener('click', () => this.playQariRange(this.getRecitedRange()));

      const stopQariBtn = document.getElementById('btn-stop-qari');
      if (stopQariBtn) stopQariBtn.addEventListener('click', () => this.stopAudio());

      // Play single verse in memorize stage
      const playSingleBtn = document.getElementById('hifz-play-single');
      if (playSingleBtn) {
        playSingleBtn.addEventListener('click', () => {
          const v = this.verses[this.state.current];
          if (v) this.playQariRange([v]);
        });
      }

      // Hide / show text in memorize stage
      const toggleTextBtn = document.getElementById('hifz-toggle-text');
      if (toggleTextBtn) toggleTextBtn.addEventListener('click', () => this.toggleText());

      const textEl = document.getElementById('hifz-verse-text');
      if (textEl && this.textHidden) {
        textEl.addEventListener('click', () => this.toggleText(), { once: true });
      }

      // Next verse button
      const nextBtn = document.getElementById('btn-next-verse');
      if (nextBtn) nextBtn.addEventListener('click', () => this.onNextVerse());

      // To final pass button
      const toFinalBtn = document.getElementById('btn-to-final-pass');
      if (toFinalBtn) toFinalBtn.addEventListener('click', () => this.onGoToFinalPass());

      // Complete task button
      const completeBtn = document.getElementById('btn-complete-page');
      if (completeBtn) completeBtn.addEventListener('click', () => this.completeTask());

      // Mark page done direct button
      const markDoneBtn = document.getElementById('btn-mark-page-done');
      if (markDoneBtn) markDoneBtn.addEventListener('click', () => this.markPageDoneDirect());

      // Rail verse clicks
      document.querySelectorAll('.hifz-verse-chip[data-verse-idx]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const idx = Number(chip.dataset.verseIdx);
          this.jumpToVerse(idx);
        });
      });

      const finalChip = document.getElementById('chip-final-pass');
      if (finalChip) {
        finalChip.addEventListener('click', () => this.onGoToFinalPass());
      }

      // Modals
      const mushaf = document.getElementById('btn-view-mushaf');
      if (mushaf) mushaf.addEventListener('click', () => openMushafModal(this.page));

      const mistake = document.getElementById('btn-open-mistake');
      if (mistake) mistake.addEventListener('click', () => openMistakeModal(this.page));
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
          ? hifzT('hifz_show_text', {}, 'إظهار النص')
          : hifzT('hifz_hide_text', {}, 'إخفاء النص');
      }
      if (text && this.textHidden) {
        text.addEventListener('click', () => this.toggleText(), { once: true });
      }
    },

    mountNotes() {
      if (!window.PageNotes) return;
      PageNotes.mount(this.page, 'HIFZ_JADID');
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
  };

  window.HifzPage = HifzPage;
})();
