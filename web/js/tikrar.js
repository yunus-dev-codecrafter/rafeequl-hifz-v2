'use strict';

/* ==========================================================================
   Rafeequl Hifz — TIKRAR_AMS Yesterday's Consolidation Gauntlet
   
   4-Step Mastery Flow:
     1. Ayah Sequencing Challenge (تحدي ترتيب تسلسل الآيات):
        Student reconstructs the correct order of the scrambled page's ayat
        from memory.
     2. Endings & Transitions Challenge (تحدي فواصل الآيات وروابط الانتقال):
        A high-difficulty recall test: tests exact ayah endings (فواصل الآيات)
        and next-ayah transitions (الانتقال للآية التالية) without hints.
     3. Voice Recitation (التسميع والتسجيل الصوتي غيباً):
        Student records yesterday's complete page from memory without looking.
        (Single stop button, no duplicates, no Mushaf peeking).
     4. Mushaf Audit & Verification (المطابقة والاستماع مع المصحف):
        The full Mushaf page is revealed for the first time. Student listens
        to their recording, verifies word by word, and confirms consolidation.
   ========================================================================== */

(function () {
  const AUDIO_BASE = 'https://everyayah.com/data/Alafasy_128kbps/';

  function t(key, params, fallback) {
    try {
      if (window.I18N && typeof I18N.t === 'function') {
        const val = I18N.t(key, params || {});
        if (val != null && val !== key) return val;
      }
    } catch (e) {}
    return fallback;
  }

  function escHtml(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function isEnglish() {
    return !!(window.I18N && I18N.lang === 'en');
  }

  function surahName(id) {
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

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  const GENERIC_QURAN_ENDINGS = [
    'إِنَّ اللَّهَ غَفُورٌ رَّحِيمٌ',
    'وَاللَّهُ عَلِيمٌ حَكِيمٌ',
    'إِنَّ اللَّهَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ',
    'وَكَانَ اللَّهُ بِمَا تَعْمَلُونَ بَصِيرًا',
    'وَاللَّهُ بِمَا تَعْمَلُونَ خَبِيرٌ',
    'إِنَّ فِي ذَٰلِكَ لَآيَاتٍ لِّقَوْمٍ يَعْقِلُونَ',
    'إِنَّ اللَّهَ شَدِيدُ الْعِقَابِ',
    'وَهُوَ الْعَزِيزُ الْحَكِيمُ',
  ];

  const TikrarPage = {
    task: null,
    page: 0,
    verses: [],
    shuffledBank: [],
    placed: [],
    quran: null,
    loading: false,
    stage: 'ordering', // 'ordering' | 'drill' | 'reciting' | 'audit' | 'complete'

    // Challenge 2: Drill State
    drillQuestions: [],
    drillIndex: 0,
    drillScore: 0,
    drillAnswered: false,

    // Recording engine
    recording: false,
    recordingPending: false,
    mediaRecorder: null,
    mediaStream: null,
    recordingChunks: [],
    recordingTimerId: null,
    recordingStartTime: 0,
    recordedAudioUrl: null,
    recordingSession: 0,

    // Qari playback
    audio: null,
    playingIndex: -1,
    playing: false,

    render(task) {
      const container = document.getElementById('task-content');
      if (!container || !task) return;

      this.task = task;
      this.page = Number(task.start_page) || 0;

      if (task.is_completed) {
        this.stage = 'complete';
        this.paintCompleted();
        return;
      }

      this.mount();
    },

    async mount() {
      const container = document.getElementById('task-content');
      if (!container || !this.task) return;

      this.loading = true;
      container.innerHTML = `
        <div class="consolidation-loading">
          <div class="consolidation-spinner" aria-hidden="true"></div>
          <p>${escHtml(t('page_loading', {}, 'جاري تجهيز صفحة تكرار الأمس…'))}</p>
        </div>`;

      try {
        await this.loadQuran();
        this.verses = this.buildVerses(this.page);
        if (!this.verses.length) {
          throw new Error(t('hifz_error_no_verses', {}, 'لم يتم العثور على آيات لهذه الصفحة.'));
        }

        // Initialize stage 1
        this.resetOrdering(false);
        this.loading = false;
        this.paint();
      } catch (error) {
        this.loading = false;
        this.paintError(error);
      }
    },

    buildVerses(page) {
      const sections = (typeof getPageVerseSections === 'function') ? getPageVerseSections(page) : [];
      const verses = [];
      let idx = 0;
      sections.forEach((section) => {
        for (let ayah = Number(section.fromAyah); ayah <= Number(section.toAyah); ayah++) {
          const sId = Number(section.surahId);
          verses.push({
            index: idx++,
            page,
            surah: sId,
            ayah,
            surahName: surahName(sId),
            text: this.getVerseText(sId, ayah),
            key: `${sId}:${ayah}`,
          });
        }
      });
      return verses;
    },

    async loadQuran() {
      if (this.quran) return this.quran;
      if (window.__quranUthmaniCache) {
        this.quran = window.__quranUthmaniCache;
        return this.quran;
      }
      const response = await fetch('data/quran-uthmani.json', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(t('hifz_load_error', {}, 'تعذر تحميل نص الآيات.'));
      }
      this.quran = await response.json();
      window.__quranUthmaniCache = this.quran;
      return this.quran;
    },

    getVerseText(surah, ayah) {
      if (!this.quran) return '';
      const s = this.quran[String(surah)];
      return (s && s[ayah - 1]) || '';
    },

    /* ---------------------------------------------------------------------
     * Stage 1: Ayah Sequencing Logic
     * ------------------------------------------------------------------ */

    resetOrdering(shouldPaint = true) {
      this.placed = [];
      let shuffled = shuffle(this.verses);
      if (this.verses.length > 2 && shuffled[0].index === 0) {
        shuffled = shuffle(this.verses);
      }
      this.shuffledBank = shuffled;
      if (shouldPaint) this.paint();
    },

    undoLastPlaced() {
      if (!this.placed.length) return;
      const last = this.placed.pop();
      this.shuffledBank.push(last);
      this.shuffledBank = shuffle(this.shuffledBank);
      if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
        AudioEngine.playUndo();
      }
      this.paint();
    },

    onAyahCardTapped(cardKey, cardEl) {
      const targetIndex = this.placed.length;
      const expectedAyah = this.verses[targetIndex];
      if (!expectedAyah) return;

      if (cardKey === expectedAyah.key) {
        const foundIdx = this.shuffledBank.findIndex((v) => v.key === cardKey);
        if (foundIdx !== -1) {
          const [placedAyah] = this.shuffledBank.splice(foundIdx, 1);
          this.placed.push(placedAyah);
        }

        if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') {
          AudioEngine.playSuccess();
        }

        if (this.placed.length === this.verses.length) {
          if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
            AudioEngine.playCelebration();
          }
          showToast(t('tikrar_challenge_done', {}, 'ما شاء الله! رتبت آيات الصفحة كاملة بنجاح ✓'), false);
        }

        this.paint();
      } else {
        if (cardEl) {
          cardEl.classList.remove('is-wrong');
          void cardEl.offsetWidth; // reflow
          cardEl.classList.add('is-wrong');
        }
        if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
          AudioEngine.playUndo();
        }
        showToast(t('tikrar_wrong_toast', {}, 'ليست هذه الآية التالية، تذكر بداية الآية بعد الآية الحالية...'), true);
      }
    },

    /* ---------------------------------------------------------------------
     * Stage 2: Endings & Transitions Drill (تحدي فواصل الآيات والانتقالات)
     * ------------------------------------------------------------------ */

    buildDrillQuestions() {
      const verses = this.verses || [];
      if (!verses.length) return [];

      const questions = [];
      const total = verses.length;
      const qCount = Math.min(5, Math.max(3, total));

      // Choose distinct indices spread across the page
      const chosenIndices = [];
      if (total <= qCount) {
        for (let i = 0; i < total; i++) chosenIndices.push(i);
      } else {
        for (let i = 0; i < qCount; i++) {
          const idx = Math.floor((i * total) / qCount);
          if (!chosenIndices.includes(idx)) chosenIndices.push(idx);
        }
        for (let i = 0; i < total && chosenIndices.length < qCount; i++) {
          if (!chosenIndices.includes(i)) chosenIndices.push(i);
        }
      }

      // Collect endings & openings pool
      const allEndings = [];
      const allOpenings = [];
      verses.forEach((v) => {
        const words = v.text.trim().split(/\s+/);
        if (words.length >= 3) {
          allEndings.push({ text: words.slice(-3).join(' '), ayahKey: v.key });
        }
        if (words.length >= 3) {
          allOpenings.push({ text: words.slice(0, 4).join(' '), ayahKey: v.key });
        }
      });

      chosenIndices.forEach((vIdx, stepIdx) => {
        const v = verses[vIdx];
        const words = v.text.trim().split(/\s+/);
        const canTestTransition = (vIdx < total - 1);
        const testType = (stepIdx % 2 === 1 && canTestTransition) ? 'transition' : 'ending';

        if (testType === 'transition') {
          const nextV = verses[vIdx + 1];
          const nextWords = nextV.text.trim().split(/\s+/);
          const promptEnding = words.slice(-4).join(' ');
          const correctNext = nextWords.slice(0, Math.min(5, nextWords.length)).join(' ');

          const distractors = allOpenings
            .filter((o) => o.ayahKey !== nextV.key && o.text !== correctNext)
            .map((o) => o.text);

          const shuffledDist = shuffle(distractors);
          const chosenDist = shuffledDist.slice(0, 2);

          let fallbackIdx = 0;
          const fallbackOpenings = ['يَا أَيُّهَا الَّذِينَ آمَنُوا', 'وَإِذْ قَالَ مُوسَىٰ', 'إِنَّ الَّذِينَ كَفَرُوا'];
          while (chosenDist.length < 2 && fallbackIdx < fallbackOpenings.length) {
            if (!chosenDist.includes(fallbackOpenings[fallbackIdx])) {
              chosenDist.push(fallbackOpenings[fallbackIdx]);
            }
            fallbackIdx++;
          }

          const options = shuffle([
            { text: correctNext, isCorrect: true },
            { text: chosenDist[0], isCorrect: false },
            { text: chosenDist[1], isCorrect: false },
          ]);

          questions.push({
            type: 'transition',
            surahName: v.surahName,
            ayah: v.ayah,
            nextAyah: nextV.ayah,
            promptEnding,
            correctText: correctNext,
            options,
          });
        } else {
          // Ending test
          let headWords = '';
          let correctEnding = '';
          if (words.length >= 7) {
            headWords = words.slice(0, words.length - 3).join(' ');
            correctEnding = words.slice(-3).join(' ');
          } else if (words.length >= 4) {
            headWords = words.slice(0, words.length - 2).join(' ');
            correctEnding = words.slice(-2).join(' ');
          } else {
            headWords = words[0] || '';
            correctEnding = words.slice(1).join(' ') || words[0];
          }

          const distractors = allEndings
            .filter((e) => e.ayahKey !== v.key && e.text !== correctEnding)
            .map((e) => e.text);

          const shuffledDist = shuffle(distractors);
          const chosenDist = shuffledDist.slice(0, 2);

          let genIdx = 0;
          while (chosenDist.length < 2 && genIdx < GENERIC_QURAN_ENDINGS.length) {
            const candidate = GENERIC_QURAN_ENDINGS[genIdx];
            if (!chosenDist.includes(candidate) && candidate !== correctEnding) {
              chosenDist.push(candidate);
            }
            genIdx++;
          }

          const options = shuffle([
            { text: correctEnding, isCorrect: true },
            { text: chosenDist[0] || GENERIC_QURAN_ENDINGS[0], isCorrect: false },
            { text: chosenDist[1] || GENERIC_QURAN_ENDINGS[1], isCorrect: false },
          ]);

          questions.push({
            type: 'ending',
            surahName: v.surahName,
            ayah: v.ayah,
            headWords,
            correctText: correctEnding,
            options,
          });
        }
      });

      return questions;
    },

    startDrill() {
      this.drillQuestions = this.buildDrillQuestions();
      this.drillIndex = 0;
      this.drillScore = 0;
      this.drillAnswered = false;
      this.stage = 'drill';
      this.paint();
    },

    onDrillAnswer(selectedOpt, optEl) {
      if (this.drillAnswered) return;
      this.drillAnswered = true;

      const q = this.drillQuestions[this.drillIndex];
      const isCorrect = selectedOpt && selectedOpt.isCorrect;

      if (isCorrect) {
        this.drillScore += 1;
        if (optEl) optEl.classList.add('is-correct');
        if (window.AudioEngine && typeof AudioEngine.playSuccess === 'function') {
          AudioEngine.playSuccess();
        }
        showToast(t('tikrar_drill_correct_toast', {}, 'إجابة صحيحة ومتقنة ✓'), false);
      } else {
        if (optEl) optEl.classList.add('is-wrong');
        // Highlight correct option
        document.querySelectorAll('.tikrar-drill-opt').forEach((btn) => {
          if (btn.dataset.correct === 'true') {
            btn.classList.add('is-correct');
          }
        });
        if (window.AudioEngine && typeof AudioEngine.playUndo === 'function') {
          AudioEngine.playUndo();
        }
        showToast(t('tikrar_drill_wrong_toast', {}, 'انتبه للفاصلة، الإجابة الصحيحة موضحة بالأخضر'), true);
      }

      // Disable all options
      document.querySelectorAll('.tikrar-drill-opt').forEach((btn) => {
        btn.disabled = true;
      });

      // Show feedback and auto advance
      const feedbackEl = document.getElementById('drill-feedback');
      if (feedbackEl) {
        feedbackEl.className = `tikrar-drill-feedback ${isCorrect ? 'is-correct' : 'is-wrong'}`;
        feedbackEl.innerHTML = isCorrect
          ? `<span>✓</span> <span>${escHtml(t('tikrar_drill_correct_toast', {}, 'إجابة صحيحة ومتقنة ✓'))}</span>`
          : `<span>⚠️</span> <span>${escHtml(t('tikrar_drill_wrong_toast', {}, 'الإجابة الصحيحة هي: '))} <strong>${escHtml(q.correctText)}</strong></span>`;
        feedbackEl.classList.remove('hidden');
      }

      const delay = isCorrect ? 900 : 1800;
      setTimeout(() => {
        this.nextDrillQuestion();
      }, delay);
    },

    nextDrillQuestion() {
      this.drillIndex += 1;
      this.drillAnswered = false;
      this.paint();
    },

    /* ---------------------------------------------------------------------
     * Stage 3: Voice Recording Engine (Single Stop Button, No Mushaf Help)
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
      for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) return candidate;
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
        showToast(t('page_mic_unsupported', {}, 'التسجيل الصوتي غير مدعوم في هذا المتصفح.'), true);
        return;
      }
      this.stopAudio();
      this.cleanupRecording();

      const session = this.recordingSession;
      this.recordingPending = true;
      this.stage = 'reciting';
      this.paint();

      let stream;
      try {
        stream = await this.requestMic();
      } catch (err) {
        if (session === this.recordingSession) {
          this.recordingPending = false;
          showToast(t('page_mic_permission_denied', {}, 'تعذر الوصول إلى الميكروفون. يرجى السماح بالإذن أو كشف الصفحة مباشرة.'), true);
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
      this.recordingChunks = [];

      const mimeType = this.getBestMimeType();
      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (err) {
        try {
          recorder = new MediaRecorder(stream);
        } catch (e2) {
          stream.getTracks().forEach((track) => track.stop());
          this.mediaStream = null;
          showToast(t('page_recorder_init_failed', {}, 'تعذر تهيئة المسجل الصوتي.'), true);
          this.paint();
          return;
        }
      }

      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e && e.data && e.data.size > 0) {
          this.recordingChunks.push(e.data);
        }
      };

      recorder.onerror = () => {
        showToast(t('page_recording_error', {}, 'حدث خطأ أثناء التسجيل.'), true);
        this.cleanupRecording();
        this.paint();
      };

      recorder.onstop = () => {
        const type = (recorder && recorder.mimeType) || mimeType || 'audio/webm';
        if (this.recordingChunks.length) {
          const blob = new Blob(this.recordingChunks, { type });
          if (this.recordedAudioUrl) URL.revokeObjectURL(this.recordedAudioUrl);
          this.recordedAudioUrl = URL.createObjectURL(blob);
        }
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((track) => track.stop());
          this.mediaStream = null;
        }
        this.mediaRecorder = null;
        this.recording = false;

        this.stage = 'audit';
        this.paint();
        this.scrollAuditReveal();

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
        showToast(t('page_recording_failed', {}, 'تعذر بدء التسجيل.'), true);
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
      this.stage = 'audit';
      this.paint();
      this.scrollAuditReveal();
    },

    rerecord() {
      this.recordingPending = false;
      this.cleanupRecording();
      this.startRecording();
    },

    revealDirectly() {
      this.stopAudio();
      this.cleanupRecording();
      this.stage = 'audit';
      this.paint();
      this.scrollAuditReveal();
    },

    scrollAuditReveal() {
      const pageEl = document.getElementById('recitation-page');
      if (!pageEl || typeof pageEl.scrollIntoView !== 'function') return;
      try { pageEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
    },

    /* ---------------------------------------------------------------------
     * Stage 4: Qari Audio & Completion
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
          showToast(t('page_audio_error', {}, 'تعذر تشغيل التلاوة. تأكد من الاتصال.'), true);
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

    async confirmConsolidation() {
      this.stopAudio();
      this.cleanupRecording();
      const completeBtn = document.getElementById('btn-confirm-tikrar');
      if (completeBtn) completeBtn.disabled = true;

      try {
        await API.call('tasks/update_progress.php', {
          method: 'POST',
          body: {
            task_type: 'TIKRAR_AMS',
            completed_page: this.page,
            repetition_count: 10,
          },
          redirectOn401: true,
        });

        if (window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
          AudioEngine.playCelebration();
        }
        showToast(t('tikrar_celebration_toast', {}, 'ما شاء الله! أتممت تثبيت وتكرار صفحة الأمس بنجاح وانضمت لنطاق الربط مباركاً 🎉'), false);
        this.stage = 'complete';
        await loadSharedData();
        this.paintCompleted();
      } catch (err) {
        if (completeBtn) completeBtn.disabled = false;
        showToast(err.message, true);
      }
    },

    /* ---------------------------------------------------------------------
     * HTML Generators
     * ------------------------------------------------------------------ */

    heroHtml() {
      const isDone = this.stage === 'complete';
      let percent = 0;
      if (isDone) {
        percent = 100;
      } else if (this.stage === 'ordering') {
        const total = this.verses.length;
        percent = total > 0 ? Math.round((this.placed.length / total) * 25) : 0;
      } else if (this.stage === 'drill') {
        const qTotal = this.drillQuestions.length || 1;
        percent = 25 + Math.round((this.drillIndex / qTotal) * 25);
      } else if (this.stage === 'reciting') {
        percent = 70;
      } else if (this.stage === 'audit') {
        percent = 90;
      }

      const circ = 2 * Math.PI * 18;
      const offset = circ * (1 - percent / 100);
      const taskTitle = (isEnglish() && this.task.title_en) ? this.task.title_en : (this.task.title_ar || 'تكرار حفظ الأمس');
      const rangeHint = (typeof formatPageVerseSummary === 'function')
        ? formatPageVerseSummary(this.page, isEnglish())
        : '';

      return `
        <section class="consolidation-hero">
          <div class="consolidation-hero-main">
            <div class="consolidation-eyebrow">🟠 ${escHtml(taskTitle)}</div>
            <h1 class="consolidation-title">${escHtml(t('hifz_page_title', { page: this.page }, `صفحة ${this.page}`))}</h1>
            <div class="consolidation-refs">${rangeHint ? escHtml(rangeHint) : ''}</div>
          </div>
          <div class="consolidation-ring" role="img" aria-label="${percent}%">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle class="consolidation-ring-bg" cx="22" cy="22" r="18"></circle>
              <circle class="consolidation-ring-fg" cx="22" cy="22" r="18"
                      style="stroke-dasharray: ${circ.toFixed(1)}; stroke-dashoffset: ${offset.toFixed(1)};"></circle>
            </svg>
            <strong>${percent}%</strong>
          </div>
        </section>`;
    },

    stepsNavHtml() {
      const isOrdering = this.stage === 'ordering';
      const isDrill = this.stage === 'drill';
      const isReciting = this.stage === 'reciting';
      const isAudit = this.stage === 'audit';
      const isDone = this.stage === 'complete';

      return `
        <section class="consolidation-steps" aria-label="مراحل التثبيت">
          <div class="consolidation-step ${isOrdering ? 'is-active' : ''} ${!isOrdering ? 'is-done' : ''}">
            <span>١</span><em>${escHtml(t('tikrar_step_order', {}, 'تسلسل الآيات'))}</em>
          </div>
          <div class="consolidation-step ${isDrill ? 'is-active' : ''} ${(isReciting || isAudit || isDone) ? 'is-done' : ''}">
            <span>٢</span><em>${escHtml(t('tikrar_step_drill', {}, 'فواصل وانتقالات'))}</em>
          </div>
          <div class="consolidation-step ${isReciting ? 'is-active' : ''} ${(isAudit || isDone) ? 'is-done' : ''}">
            <span>٣</span><em>${escHtml(t('tikrar_step_recite', {}, 'التسميع الصوتي'))}</em>
          </div>
          <div class="consolidation-step ${isAudit ? 'is-active' : ''} ${isDone ? 'is-done' : ''}">
            <span>٤</span><em>${escHtml(t('tikrar_step_audit', {}, 'مطابقة المصحف'))}</em>
          </div>
        </section>`;
    },

    orderingStageHtml() {
      const total = this.verses.length;
      const count = this.placed.length;
      const isAllPlaced = count === total;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;

      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div>
              <h2>${escHtml(t('tikrar_challenge_title', {}, 'تحدي تسلسل الآيات والربط'))}</h2>
              <p class="hint">${escHtml(t('tikrar_challenge_hint', {}, 'رتب آيات صفحة الأمس بالترتيب الصحيح غيباً لاختبار قوة الربط بين الآيات. انقر على الآية التالية في التسلسل:'))}</p>
            </div>
          </div>

          <div class="consolidation-progress-line">
            <span>${escHtml(t('tikrar_placed_count', { count, total }, `${count} من ${total} آية مرتبة`))}</span>
            <strong>${percent}%</strong>
          </div>
          <div class="consolidation-progress" style="margin: 0.45rem 0 1rem;">
            <span style="width: ${percent}%; background: #d97706;"></span>
          </div>

          <!-- Placed Target Slots -->
          <div class="tikrar-slots-container" dir="rtl">
            <div style="font-size:0.88rem; font-weight:700; color:#b45309; margin-bottom:0.5rem;">
              ${escHtml(t('tikrar_placed_title', {}, 'الآيات المرتبة بالترتيب الصحيح:'))}
            </div>
            ${count === 0 ? `
              <div class="tikrar-slot-empty">
                ${escHtml(t('tikrar_slot_empty_hint', {}, 'ابدأ بالنقر على الآية الأولى من الصفحة من البنك أدناه...'))}
              </div>
            ` : `
              <div class="tikrar-slot-list">
                ${this.placed.map((v, i) => `
                  <div class="tikrar-slot-item">
                    <span class="tikrar-slot-order">${i + 1}</span>
                    <div class="tikrar-slot-content">
                      <div class="tikrar-slot-ref">${escHtml(v.surahName)} • ${escHtml(t('page_ayah_word', {}, 'آية'))} ${v.ayah}</div>
                      <p class="tikrar-slot-text">${escHtml(v.text)}</p>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          ${isAllPlaced ? `
            <div class="consolidation-success" style="padding:1.2rem 0.5rem; text-align:center;">
              <div class="consolidation-success-icon" style="background:#166534; color:#fff; width:48px; height:48px; font-size:1.6rem; border-radius:50%; display:inline-grid; place-items:center; margin-bottom:0.5rem;">✓</div>
              <h3 style="margin:0 0 0.3rem; color:#166534;">${escHtml(t('tikrar_challenge_done', {}, 'ما شاء الله! رتبت آيات الصفحة كاملة بنجاح ✓'))}</h3>
              <p class="hint" style="margin:0 0 1rem;">${escHtml(t('tikrar_ready_to_drill_hint', {}, 'الآن حان وقت التحدي الثاني الأكثر دقة: اختبار فواصل الآيات وروابط الانتقال!'))}</p>
              <button type="button" class="btn btn-primary btn-record-main" id="btn-proceed-drill" style="background:#d97706; border-color:#d97706;">
                🔥 ${escHtml(t('tikrar_to_drill_btn', {}, 'الانتقال إلى التحدي الثاني: فواصل الآيات والانتقالات ←'))}
              </button>
            </div>
          ` : `
            <!-- Shuffled Bank -->
            <div class="tikrar-bank-head">
              <span class="tikrar-bank-title">${escHtml(t('tikrar_bank_title', {}, 'بنك الآيات المشوشة (انقر على الآية التالية):'))}</span>
              <span class="tikrar-bank-hint">${escHtml(t('tikrar_bank_subhint', {}, 'الآية التالية المطلوبة: رقم'))} ${count + 1}</span>
            </div>

            <div class="tikrar-bank" dir="rtl">
              ${this.shuffledBank.map((v) => {
                const words = promptWords(v.text, 6).join(' ');
                return `
                  <button type="button" class="tikrar-bank-item" data-ayah-key="${escHtml(v.key)}">
                    <span class="tikrar-bank-preview">${escHtml(words)} …</span>
                    <span class="tikrar-bank-badge">${escHtml(v.surahName)}</span>
                  </button>`;
              }).join('')}
            </div>

            <div class="consolidation-actions" style="margin-top:1rem;">
              <button type="button" class="btn btn-ghost btn-sm" id="btn-undo-order"${count === 0 ? ' disabled' : ''}>
                ↩ ${escHtml(t('tikrar_undo_btn', {}, 'تراجع عن آخر آية'))}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" id="btn-reset-order"${count === 0 ? ' disabled' : ''}>
                🔄 ${escHtml(t('tikrar_reset_btn', {}, 'إعادة ترتيب الآيات'))}
              </button>
            </div>
          `}
        </section>`;
    },

    drillStageHtml() {
      const qTotal = this.drillQuestions.length;
      const qIndex = this.drillIndex;
      const isDone = qIndex >= qTotal;

      if (isDone) {
        // Summary Card
        const pct = qTotal > 0 ? Math.round((this.drillScore / qTotal) * 100) : 100;
        const isMaster = pct >= 80;

        return `
          <section class="consolidation-stage">
            <div class="consolidation-stage-head">
              <div>
                <h2>${escHtml(t('tikrar_drill_result_title', {}, 'نتيجة تحدي فواصل الآيات والانتقالات'))}</h2>
                <p class="hint">${escHtml(t('tikrar_drill_hint', {}, 'أجب عن الأسئلة بدقة لاختبار تمكنك التام من خواتيم الآيات وبدايات الآيات التالية غيباً.'))}</p>
              </div>
            </div>

            <div class="consolidation-success" style="padding:1.5rem 1rem; text-align:center;">
              <div class="consolidation-success-icon" style="background:${isMaster ? '#166534' : '#d97706'}; color:#fff; width:52px; height:52px; font-size:1.8rem; border-radius:50%; display:inline-grid; place-items:center; margin-bottom:0.75rem;">
                ${isMaster ? '✓' : '⭐'}
              </div>
              <h3 style="margin:0 0 0.4rem; color:${isMaster ? '#166534' : '#b45309'}; font-size:1.3rem;">
                ${escHtml(t('tikrar_drill_score', { score: this.drillScore, total: qTotal }, `النقاط: ${this.drillScore} من ${qTotal} (${pct}%)`))}
              </h3>
              <p class="hint" style="margin:0 0 1.25rem; font-size:0.95rem;">
                ${isMaster
                  ? escHtml(t('tikrar_drill_success_msg', {}, 'ما شاء الله! إتقانك لفواصل الآيات وانتقالاتها قوي ومتين 🎉'))
                  : escHtml(t('tikrar_drill_encourage_msg', {}, 'أداء طيب! ركّز على الفواصل التي أخطأت فيها أثناء التسميع الصوتي الآن.'))}
              </p>

              <div class="consolidation-actions" style="justify-content:center; gap:0.75rem; flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-record-main" id="btn-proceed-recite" style="background:#d97706; border-color:#d97706;">
                  🎙️ ${escHtml(t('tikrar_btn_proceed_recite', {}, 'الانتقال إلى التسميع والتسجيل الصوتي غيباً ←'))}
                </button>
                <button type="button" class="btn btn-ghost" id="btn-retry-drill">
                  ${escHtml(t('tikrar_drill_retry_btn', {}, '🔄 إعادة التحدي'))}
                </button>
              </div>
            </div>
          </section>`;
      }

      const q = this.drillQuestions[qIndex];
      const isTransition = q.type === 'transition';

      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div>
              <h2>${escHtml(t('tikrar_drill_title', {}, 'تحدي فواصل الآيات وروابط الانتقال'))}</h2>
              <p class="hint">${escHtml(t('tikrar_drill_hint', {}, 'أجب عن الأسئلة بدقة لاختبار تمكنك التام من خواتيم الآيات وبدايات الآيات التالية غيباً.'))}</p>
            </div>
          </div>

          <div class="tikrar-drill-box" dir="rtl">
            <div class="tikrar-drill-head">
              <span class="tikrar-drill-pill">
                ${isTransition ? escHtml(t('tikrar_drill_badge_transition', {}, '🔗 رابط الانتقال')) : escHtml(t('tikrar_drill_badge_ending', {}, '🎯 فاصلة الآية'))}
              </span>
              <span class="tikrar-drill-pill" style="background:rgba(22, 101, 52, 0.08); color:#166534; border-color:rgba(22, 101, 52, 0.2);">
                ${escHtml(t('tikrar_drill_q_num', { current: qIndex + 1, total: qTotal }, `السؤال ${qIndex + 1} من ${qTotal}`))}
              </span>
            </div>

            <div class="tikrar-drill-card">
              <div class="tikrar-drill-q-title">
                <span>📖</span>
                <span>${escHtml(q.surahName)} • ${escHtml(t('page_ayah_word', {}, 'آية'))} ${q.ayah}</span>
              </div>

              ${isTransition ? `
                <div class="tikrar-drill-prompt-box">
                  <p class="tikrar-drill-prompt-text">
                    تنتهي الآية بـ: ﴿ … ${escHtml(q.promptEnding)} ﴾
                  </p>
                </div>
                <div style="font-weight:700; color:var(--text, #13302d); margin-bottom:0.75rem; font-size:0.95rem;">
                  ${escHtml(t('tikrar_drill_transition_q', {}, 'بماذا تبدأ الآية التالية مباشرة في التلاوة؟'))}
                </div>
              ` : `
                <div class="tikrar-drill-prompt-box">
                  <p class="tikrar-drill-prompt-text">
                    قال تعالى: ﴿ ${escHtml(q.headWords)} <span class="tikrar-drill-blank">[ ؟؟؟ ]</span> ﴾
                  </p>
                </div>
                <div style="font-weight:700; color:var(--text, #13302d); margin-bottom:0.75rem; font-size:0.95rem;">
                  ${escHtml(t('tikrar_drill_ending_q', {}, 'ما هي فاصلة وخاتمة هذه الآية الكريمة؟'))}
                </div>
              `}

              <!-- Options -->
              <div class="tikrar-drill-options">
                ${q.options.map((opt, i) => `
                  <button type="button" class="tikrar-drill-opt" data-opt-index="${i}" data-correct="${opt.isCorrect ? 'true' : 'false'}">
                    <span class="tikrar-drill-opt-text">${escHtml(opt.text)}</span>
                  </button>
                `).join('')}
              </div>

              <div id="drill-feedback" class="tikrar-drill-feedback hidden" role="status"></div>
            </div>
          </div>
        </section>`;
    },

    recitingStageHtml() {
      const first = this.verses[0];
      const words = promptWords(first ? first.text : '', 5);

      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div>
              <h2>${escHtml(t('tikrar_recitation_title', {}, 'التسميع الصوتي غيباً'))}</h2>
              <p class="hint">${escHtml(t('tikrar_recitation_hint', {}, 'سمّع الصفحة كاملة غيباً من أولها إلى آخرها أثناء التسجيل:'))}</p>
            </div>
          </div>

          <div class="consolidation-prompt">
            <span class="consolidation-prompt-label">${escHtml(t('page_start_from', {}, 'ابدأ من هنا:'))}</span>
            <div class="consolidation-prompt-words" dir="rtl">
              ${words.map((w) => `<span>${escHtml(w)}</span>`).join('')}
              <span>…</span>
            </div>
          </div>

          <div class="consolidation-recorder-box">
            ${this.recording ? `
              <div class="recorder-state recorder-state-active" style="align-items: center; text-align: center;">
                <div class="recording-pulse-badge" style="margin: 0.6rem auto; display: inline-flex;">
                  <span class="recording-dot"></span>
                  <span>${escHtml(t('page_recording_active', {}, 'جارٍ التسجيل... سمّع الصفحة كاملة غيباً'))}</span>
                  <span class="recording-timer" id="recording-timer">00:00</span>
                </div>
                <!-- Single Stop Recording Button -->
                <div class="consolidation-actions" style="justify-content: center; margin-top: 0.5rem;">
                  <button type="button" class="btn btn-danger btn-stop-record" id="btn-stop-record" style="min-width: 240px; padding: 0.85rem 1.4rem; font-size: 1.05rem;">
                    ⏹️ ${escHtml(t('page_stop_recording', {}, 'إيقاف التسجيل ومطابقة المصحف'))}
                  </button>
                </div>
              </div>
            ` : `
              <div class="recorder-state recorder-state-idle" style="align-items: center; text-align: center;">
                <div class="consolidation-actions" style="justify-content: center; gap: 0.65rem; flex-wrap:wrap;">
                  <button type="button" class="btn btn-primary btn-record-main" id="btn-start-record" style="background:#d97706; border-color:#d97706;"${this.recordingPending ? ' disabled' : ''}>
                    🎙️ ${escHtml(t('page_start_recording', {}, 'ابدأ تسجيل التلاوة الآن'))}
                  </button>
                  <button type="button" class="btn btn-ghost" id="btn-reveal-direct">
                    ${escHtml(t('page_reveal_without_record', {}, 'كشف المصحف مباشرة بدون تسجيل'))}
                  </button>
                </div>
              </div>
            `}
          </div>
        </section>`;
    },

    auditStageHtml() {
      return `
        <section class="consolidation-stage">
          <div class="consolidation-stage-head">
            <div>
              <h2>${escHtml(t('tikrar_audit_title', {}, 'المطابقة والاستماع مع المصحف'))}</h2>
              <p class="hint">${escHtml(t('tikrar_audit_hint', {}, 'استمع لتسجيلك وقارنه بنص المصحف أدناه للتأكد من إتقان حفظ الأمس:'))}</p>
            </div>
          </div>

          <div class="consolidation-recorder-box">
            <div class="recorder-state recorder-state-playback">
              <div class="playback-card" style="margin: 0.5rem 0; padding: 0.85rem; border-radius: 14px; background: rgba(217, 119, 6, 0.05); border: 1px solid rgba(217, 119, 6, 0.2);">
                ${this.recordedAudioUrl ? `
                  <div style="font-size: 0.92rem; font-weight: 700; color: #d97706; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                    <span>🎙️</span>
                    <span>${escHtml(t('page_my_recording_label', {}, 'تسجيل تلاوتك:'))}</span>
                  </div>
                  <audio controls class="recorded-audio-player" id="recorded-audio" src="${this.recordedAudioUrl}" style="width: 100%; height: 42px;"></audio>
                ` : ''}
                <div class="playback-sub-actions" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                  <button type="button" class="btn btn-ghost btn-sm" id="btn-rerecord">
                    🔄 ${escHtml(t('page_rerecord', {}, 'إعادة التسجيل'))}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm${this.playing ? ' hidden' : ''}" id="btn-qari-audio">
                    🔊 ${escHtml(t('page_listen_qari', {}, 'استمع للقارئ (مشاري العفاسي)'))}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm${!this.playing ? ' hidden' : ''}" id="btn-stop-qari">
                    ⏹️ ${escHtml(t('page_stop_qari', {}, 'إيقاف تلاوة القارئ'))}
                  </button>
                </div>
              </div>
              <p class="consolidation-review-notice">
                ${escHtml(t('tikrar_audit_notice', {}, 'استمع لتلاوتك وتابع في نص المصحف أدناه كلمة بكلمة لتدقيق أي خطأ أو سقط:'))}
              </p>
            </div>
          </div>

          <!-- Full Mushaf Page Revealed ONLY at Audit Stage -->
          <div id="recitation-page" class="consolidation-page-text" dir="rtl" style="margin-top:1rem;">
            ${this.verses.map((v) => `
              <div class="consolidation-ayah" data-ayah-key="${escHtml(v.key)}">
                <div class="consolidation-ayah-ref">${escHtml(v.surahName)} • ${escHtml(t('page_ayah_word', {}, 'آية'))} ${v.ayah}</div>
                <p>${escHtml(v.text || '…')}</p>
              </div>
            `).join('')}
          </div>
        </section>`;
    },

    actionsHtml() {
      const isAudit = this.stage === 'audit';

      let primaryBtn = '';
      if (isAudit) {
        primaryBtn = `
          <button type="button" id="btn-confirm-tikrar" class="btn btn-success hifz-main-action" style="background:#059669;">
            ✓ ${escHtml(t('tikrar_btn_confirm_done', {}, 'أتممت التسميع والتدقيق — تثبيت الصفحة'))}
          </button>`;
      }

      // Note: btn-view-mushaf is removed to prevent peeking.
      // During reciting, only the single button in the recorder box exists (no duplicate).
      return `
        <div class="stage-actions is-sticky hifz-actions">
          <div class="stage-primary-actions">${primaryBtn}</div>
          <div class="hifz-sub-actions">
            <button type="button" id="btn-direct-complete" class="btn btn-ghost stage-icon-btn" title="${escHtml(t('btn_complete_all_rep', {}, 'إتمام التثبيت مباشرة'))}">
              ✓ ${escHtml(t('btn_complete_all_rep', {}, 'إتمام التثبيت مباشرة'))}
            </button>
            <button type="button" id="btn-focus" class="btn btn-ghost btn-focus-toggle stage-icon-btn" title="${escHtml(t('focus_mode_title', {}, 'التركيز'))}">
              <span class="focus-enter-label">🎯 ${escHtml(t('focus_mode', {}, 'التركيز'))}</span>
              <span class="focus-exit-label">✅ ${escHtml(t('focus_exit', {}, 'خروج'))}</span>
            </button>
            <button type="button" id="btn-open-mistake" class="btn btn-danger stage-icon-btn" title="${escHtml(t('btn_open_mistake', {}, 'تسجيل خطأ'))}">
              ${escHtml(t('btn_open_mistake', {}, 'تسجيل خطأ'))}
            </button>
          </div>
        </div>`;
    },

    paint() {
      const container = document.getElementById('task-content');
      if (!container) return;

      let stageHtml = '';
      if (this.stage === 'ordering') {
        stageHtml = this.orderingStageHtml();
      } else if (this.stage === 'drill') {
        stageHtml = this.drillStageHtml();
      } else if (this.stage === 'reciting') {
        stageHtml = this.recitingStageHtml();
      } else if (this.stage === 'audit') {
        stageHtml = this.auditStageHtml();
      } else {
        this.paintCompleted();
        return;
      }

      container.innerHTML = `
        ${this.heroHtml()}
        ${this.stepsNavHtml()}
        ${stageHtml}
        ${this.actionsHtml()}
      `;

      this.bindEvents();
    },

    paintCompleted() {
      const container = document.getElementById('task-content');
      if (!container) return;
      const total = this.verses.length;

      container.innerHTML = `
        ${this.heroHtml()}
        <section class="consolidation-stage">
          <div class="consolidation-success" role="status" style="text-align:center; padding:2rem 1rem;">
            <div class="consolidation-success-icon" style="background:#166534; color:#fff; width:58px; height:58px; font-size:2rem; border-radius:50%; display:inline-grid; place-items:center; margin:0 auto 1rem;">✓</div>
            <h2 style="color:#166534; font-size:1.45rem;">${escHtml(t('tikrar_done_title', {}, 'بارك الله فيك، أتممت تثبيت صفحة الأمس'))}</h2>
            <p class="hint" style="font-size:1rem; margin:0.5rem 0 1.5rem;">
              ${escHtml(t('tikrar_done_desc', { page: this.page, total }, `انتقلت صفحة ${this.page} بنجاح إلى نطاق الربط المستمر لتلاوتها مع محفوظك.`))}
            </p>
            <div class="consolidation-actions" style="justify-content: center; gap:0.75rem;">
              <a href="rabt.html" class="btn btn-primary" style="background:#0f766e; border-color:#0f766e;">
                ${escHtml(t('btn_go_to_rabt', {}, 'الانتقال إلى نافذة الربط ←'))}
              </a>
              <a href="dashboard.html" class="btn btn-ghost">
                ${escHtml(t('back_to_dashboard', {}, 'العودة لدفتر اليوم'))}
              </a>
            </div>
          </div>
        </section>`;
    },

    paintError(error) {
      const container = document.getElementById('task-content');
      if (!container) return;
      const message = (error && error.message) ? error.message : t('hifz_load_error', {}, 'تعذر تحميل الآيات.');
      container.innerHTML = `
        <div class="task-page-head hifz-head">
          <h2>${escHtml(t('hifz_load_error', {}, 'تعذر تحميل نص الآيات.'))}</h2>
          <p class="hint">${escHtml(message)}</p>
          <button type="button" id="tikrar-retry" class="btn btn-primary">${escHtml(t('hifz_retry', {}, 'إعادة المحاولة'))}</button>
        </div>`;
      const retry = document.getElementById('tikrar-retry');
      if (retry) retry.addEventListener('click', () => this.mount());
    },

    bindEvents() {
      // Stage 1: Ayah bank tap
      document.querySelectorAll('.tikrar-bank-item[data-ayah-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.onAyahCardTapped(btn.dataset.ayahKey, btn);
        });
      });

      const undoBtn = document.getElementById('btn-undo-order');
      if (undoBtn) undoBtn.addEventListener('click', () => this.undoLastPlaced());

      const resetBtn = document.getElementById('btn-reset-order');
      if (resetBtn) resetBtn.addEventListener('click', () => this.resetOrdering(true));

      // Transition to Stage 2: Drill
      const proceedDrillBtn = document.getElementById('btn-proceed-drill');
      if (proceedDrillBtn) {
        proceedDrillBtn.addEventListener('click', () => {
          this.startDrill();
        });
      }

      // Stage 2: Drill option taps
      document.querySelectorAll('.tikrar-drill-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          const q = this.drillQuestions[this.drillIndex];
          if (!q) return;
          const optIdx = Number(btn.dataset.optIndex);
          const opt = q.options[optIdx];
          this.onDrillAnswer(opt, btn);
        });
      });

      const retryDrillBtn = document.getElementById('btn-retry-drill');
      if (retryDrillBtn) {
        retryDrillBtn.addEventListener('click', () => {
          this.startDrill();
        });
      }

      // Transition to Stage 3: Voice Recitation
      const proceedReciteBtn = document.getElementById('btn-proceed-recite');
      if (proceedReciteBtn) {
        proceedReciteBtn.addEventListener('click', () => {
          this.stage = 'reciting';
          this.paint();
        });
      }

      // Stage 3: Voice recording buttons (Single Stop Button)
      const startRecBtn = document.getElementById('btn-start-record');
      if (startRecBtn) startRecBtn.addEventListener('click', () => this.startRecording());

      const stopRecBtn = document.getElementById('btn-stop-record');
      if (stopRecBtn) stopRecBtn.addEventListener('click', () => this.stopRecording());

      const revealBtn = document.getElementById('btn-reveal-direct');
      if (revealBtn) revealBtn.addEventListener('click', () => this.revealDirectly());

      // Stage 4: Playback & Audit
      const rerecordBtn = document.getElementById('btn-rerecord');
      if (rerecordBtn) rerecordBtn.addEventListener('click', () => this.rerecord());

      const qariBtn = document.getElementById('btn-qari-audio');
      if (qariBtn) qariBtn.addEventListener('click', () => this.playQariRange(this.verses));

      const stopQariBtn = document.getElementById('btn-stop-qari');
      if (stopQariBtn) stopQariBtn.addEventListener('click', () => this.stopAudio());

      // Confirm consolidation
      const confirmBtn = document.getElementById('btn-confirm-tikrar');
      if (confirmBtn) confirmBtn.addEventListener('click', () => this.confirmConsolidation());

      // Direct complete fallback
      const directCompleteBtn = document.getElementById('btn-direct-complete');
      if (directCompleteBtn) {
        directCompleteBtn.addEventListener('click', () => {
          const ok = window.confirm(t('tikrar_direct_complete_confirm', {}, 'هل تريد إتمام تثبيت صفحة الأمس مباشرة؟'));
          if (ok) this.confirmConsolidation();
        });
      }

      // Mistake Logger Modal
      const mistake = document.getElementById('btn-open-mistake');
      if (mistake) mistake.addEventListener('click', () => openMistakeModal(this.page));
    },
  };

  window.TikrarPage = TikrarPage;
})();
