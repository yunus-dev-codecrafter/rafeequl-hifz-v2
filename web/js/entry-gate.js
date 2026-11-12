'use strict';

/* ==========================================================================
   Rafeequl Hifz - entry gate
   A single blocking overlay with three sequential steps:
     1. تثبيت صفحة واحدة (سماع البداية، تسميع، كشف الصفحة والاستماع)
     2. معاني كلمات القرآن (25 repetitions per entry, 500 lifetime)
     3. بطاقة خطأ واحدة (15 repetitions per entry, 15 lifetime)
   The gate is re-armed once per browser app-session. It fails open only when
   the API or the optional catalog is unavailable, so a server problem never
   locks the user out of the app.
   ========================================================================== */

(function () {
  const SESSION_KEY = 'rh_entry_gate_done_v6';
  try {
    sessionStorage.removeItem('rh_entry_gate_done');
    sessionStorage.removeItem('rh_entry_gate_done_v2');
    sessionStorage.removeItem('rh_entry_gate_done_v3');
    sessionStorage.removeItem('rh_entry_gate_done_v4');
    sessionStorage.removeItem('rh_entry_gate_done_v5');
  } catch (e) {}
  let alreadyDone = false;
  try { alreadyDone = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) {}
  if (alreadyDone) return;

  const state = {
    data: null,
    quran: null,
    quranPromise: null,
    step: 'consolidation',
    steps: null,
    consolidation: null,
    consolidationAudio: null,
    consolidationPlaying: false,
    consolidationAudioUrl: null,
    consolidationRecording: false,
    consolidationPending: false,
    consolidationMediaRecorder: null,
    consolidationStream: null,
    consolidationChunks: [],
    consolidationSession: 0,
    consolidationTimerId: null,
    consolidationStartTime: 0,
    kalimaat: null,
    mistake: null,
    overlay: null,
    busy: false,
  };

  const STEP_ORDER = ['consolidation', 'kalimaat', 'mistake'];
  const STEP_LABELS = {
    consolidation: ['entry_gate_step_page', 'تثبيت الصفحة'],
    kalimaat: ['entry_gate_step_kalimaat', 'معاني الكلمات'],
    mistake: ['entry_gate_step_mistake', 'بطاقة الخطأ'],
  };

  function visibleSteps() {
    return STEP_ORDER.filter((key) => !state.steps || state.steps[key] !== false);
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

  function mistakeTypeLabel(type) {
    try {
      if (window.I18N && typeof I18N.getMistakeLabel === 'function') {
        return I18N.getMistakeLabel(type);
      }
    } catch (e) {}
    return type || '';
  }

  function mistakeTypeClass(type) {
    if (type === 'TRANSITION_FAILURE') return 'is-transition';
    if (type === 'MUTASHABIHAT') return 'is-mutashabihat';
    return 'is-ayah';
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
    stopGateAudio();
    state.consolidationPending = false;
    cleanupGateRecording();
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
      const done = (step === 'consolidation' && state.consolidation && state.consolidation.done)
        || (step === 'kalimaat' && state.kalimaat && state.kalimaat.done)
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
            ${visibleSteps().map((key) => {
              const label = STEP_LABELS[key];
              return `<span class="entry-gate-step" data-entry-step="${key}">${esc(t(label[0], label[1]))}</span>`;
            }).join('')}
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

  function formatRef(ref) {
    if (!ref) return '';
    const parts = String(ref).split(':');
    const surah = Number(parts[0]) || 0;
    const ayah = parts[1] || '';
    return surahName(surah) + ' ' + ayah;
  }

  function gateAudioUrl(surah, ayah) {
    const pad = (n) => String(n).padStart(3, '0');
    return 'https://everyayah.com/data/Alafasy_128kbps/' + pad(Number(surah)) + pad(Number(ayah)) + '.mp3';
  }

  function cleanupGateRecording() {
    state.consolidationSession += 1;
    if (state.consolidationTimerId) {
      clearInterval(state.consolidationTimerId);
      state.consolidationTimerId = null;
    }
    const recorder = state.consolidationMediaRecorder;
    state.consolidationMediaRecorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) {}
      }
    }
    if (state.consolidationStream) {
      state.consolidationStream.getTracks().forEach((track) => track.stop());
      state.consolidationStream = null;
    }
    if (state.consolidationAudioUrl) {
      URL.revokeObjectURL(state.consolidationAudioUrl);
      state.consolidationAudioUrl = null;
    }
    state.consolidationRecording = false;
    state.consolidationChunks = [];
  }

  function stopGateAudio() {
    state.consolidationPlaying = false;
    if (state.consolidationAudio) {
      state.consolidationAudio.onended = null;
      state.consolidationAudio.onerror = null;
      try { state.consolidationAudio.pause(); } catch (e) {}
    }
    const recPlayer = document.getElementById('entry-gate-recorded-audio');
    if (recPlayer) {
      try { recPlayer.pause(); } catch (e) {}
    }
    document.querySelectorAll('.entry-gate-ayah-block.is-playing').forEach((el) => {
      el.classList.remove('is-playing');
    });
    const stop = document.getElementById('entry-gate-qari-stop');
    if (stop) stop.classList.add('hidden');
    const play = document.getElementById('entry-gate-qari-play');
    if (play) play.classList.remove('hidden');
  }

  async function requestGateMic() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  async function startGateRecording() {
    const c = state.consolidation;
    if (!c || c.busy) return;
    if (state.consolidationRecording || state.consolidationPending) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      const status = document.getElementById('entry-gate-consolidation-status');
      if (status) status.textContent = t('page_mic_unsupported', 'التسجيل الصوتي غير مدعوم في هذا المتصفح.');
      return;
    }
    stopGateAudio();
    cleanupGateRecording();
    const session = state.consolidationSession;
    state.consolidationPending = true;
    c.revealed = false;
    const pendingStatus = document.getElementById('entry-gate-consolidation-status');
    if (pendingStatus) pendingStatus.textContent = t('page_mic_requesting', 'جارٍ تجهيز الميكروفون…');

    let stream;
    try {
      stream = await requestGateMic();
    } catch (err) {
      if (session === state.consolidationSession) {
        state.consolidationPending = false;
        renderConsolidation();
        const status = document.getElementById('entry-gate-consolidation-status');
        if (status) status.textContent = t('page_mic_permission_denied', 'تعذر الوصول إلى الميكروفون. يرجى السماح بالإذن أو كشف الصفحة مباشرة.');
      }
      return;
    }

    state.consolidationPending = false;
    if (session !== state.consolidationSession || c.revealed || !state.consolidation || state.step !== 'consolidation') {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.consolidationStream = stream;
    const chunks = state.consolidationChunks = [];
    let mimeType = '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    if (MediaRecorder.isTypeSupported) {
      for (const cand of candidates) {
        if (MediaRecorder.isTypeSupported(cand)) {
          mimeType = cand;
          break;
        }
      }
    }
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    } catch (e) {
      try {
        recorder = new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        state.consolidationStream = null;
        state.consolidationRecording = false;
        renderConsolidation();
        const status = document.getElementById('entry-gate-consolidation-status');
        if (status) status.textContent = t('page_recording_failed', 'تعذر بدء التسجيل. يمكنك إعادة المحاولة أو كشف الصفحة مباشرة.');
        return;
      }
    }
    state.consolidationMediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (session !== state.consolidationSession) return;
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = () => {
      if (session !== state.consolidationSession) return;
      cleanupGateRecording();
      renderConsolidation();
      const status = document.getElementById('entry-gate-consolidation-status');
      if (status) status.textContent = t('page_recording_failed', 'تعذر بدء التسجيل. يمكنك إعادة المحاولة أو كشف الصفحة مباشرة.');
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (state.consolidationStream === stream) state.consolidationStream = null;
      if (session !== state.consolidationSession) return;

      if (state.consolidationMediaRecorder === recorder) state.consolidationMediaRecorder = null;
      const finalMime = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: finalMime });
      if (blob.size > 0) {
        state.consolidationAudioUrl = URL.createObjectURL(blob);
      }
      // Reveal the page regardless so the user is never trapped in recording.
      state.consolidationRecording = false;
      c.revealed = true;
      renderConsolidation();
      scrollGateReveal();
      const player = document.getElementById('entry-gate-recorded-audio');
      if (state.consolidationAudioUrl && player) {
        player.src = state.consolidationAudioUrl;
        try {
          const p = player.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) {}
      }
    };

    state.consolidationStartTime = Date.now();
    c.revealed = false;
    state.consolidationRecording = true;
    try {
      recorder.start(250);
    } catch (e) {
      recorder.onstop = null;
      stream.getTracks().forEach((track) => track.stop());
      state.consolidationStream = null;
      state.consolidationMediaRecorder = null;
      state.consolidationRecording = false;
      renderConsolidation();
      const status = document.getElementById('entry-gate-consolidation-status');
      if (status) status.textContent = t('page_recording_failed', 'تعذر بدء التسجيل. يمكنك إعادة المحاولة أو كشف الصفحة مباشرة.');
      return;
    }
    renderConsolidation();

    if (state.consolidationTimerId) clearInterval(state.consolidationTimerId);
    state.consolidationTimerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.consolidationStartTime) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const timerEl = document.getElementById('entry-gate-rec-timer');
      if (timerEl) {
        timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }
    }, 500);
  }

  function stopGateRecording() {
    if (state.consolidationTimerId) {
      clearInterval(state.consolidationTimerId);
      state.consolidationTimerId = null;
    }
    state.consolidationRecording = false;
    const recorder = state.consolidationMediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      const status = document.getElementById('entry-gate-consolidation-status');
      if (status) status.textContent = t('page_recording_finishing', 'جارٍ تجهيز التسجيل…');
      try {
        recorder.stop();
      } catch (e) {
        try { recorder.onstop(); } catch (err) {}
      }
      const stopSession = state.consolidationSession;
      setTimeout(() => {
        if (state.consolidationSession === stopSession && state.step === 'consolidation' && state.consolidation && !state.consolidation.revealed) {
          state.consolidation.revealed = true;
          renderConsolidation();
        }
      }, 4000);
      return;
    }
    if (state.consolidationStream) {
      state.consolidationStream.getTracks().forEach((track) => track.stop());
      state.consolidationStream = null;
    }
    const c = state.consolidation;
    if (c) {
      c.revealed = true;
      renderConsolidation();
      scrollGateReveal();
    }
  }

  function playGateAudio() {
    const c = state.consolidation;
    if (!c || !c.task) return;
    const verses = Array.isArray(c.task.verses) ? c.task.verses : [];
    if (!verses.length) return;
    stopGateAudio();
    state.consolidationPlaying = true;
    const audio = state.consolidationAudio || new Audio();
    state.consolidationAudio = audio;
    audio.preload = 'none';

    const play = document.getElementById('entry-gate-qari-play');
    if (play) play.classList.add('hidden');
    const stop = document.getElementById('entry-gate-qari-stop');
    if (stop) stop.classList.remove('hidden');

    const playAt = (index) => {
      if (!state.consolidationPlaying || index >= verses.length) {
        stopGateAudio();
        return;
      }
      const verse = verses[index];
      document.querySelectorAll('.entry-gate-ayah-block.is-playing').forEach((el) => {
        el.classList.remove('is-playing');
      });
      const current = document.querySelector(`.entry-gate-ayah-block[data-gate-ayah="${esc(String(verse.key))}"]`);
      if (current) current.classList.add('is-playing');

      audio.onended = () => playAt(index + 1);
      audio.onerror = () => {
        stopGateAudio();
        const status = document.getElementById('entry-gate-consolidation-status');
        if (status) status.textContent = t('entry_gate_page_audio_error', 'تعذر تشغيل التلاوة. تأكد من الاتصال ثم أعد المحاولة.');
      };
      audio.src = gateAudioUrl(verse.surah, verse.ayah);
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          stopGateAudio();
          const status = document.getElementById('entry-gate-consolidation-status');
          if (status) status.textContent = t('entry_gate_page_audio_error', 'تعذر تشغيل التلاوة. تأكد من الاتصال ثم أعد المحاولة.');
        });
      }
    };

    playAt(0);
  }

  function startConsolidation() {
    const payload = state.data && state.data.consolidation;
    const task = payload && payload.task;
    if (!payload || !payload.available || !task) {
      nextAfterConsolidation();
      return;
    }
    cleanupGateRecording();
    state.step = 'consolidation';
    state.consolidation = {
      done: false,
      task,
      revealed: false,
      busy: false,
    };
    renderConsolidation();
  }

  function scrollGateReveal() {
    const target = document.getElementById('entry-gate-page-scroll');
    if (!target || typeof target.scrollIntoView !== 'function') return;
    try { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
  }

  function renderConsolidation() {
    const c = state.consolidation;
    if (!c || !c.task) return;
    const task = c.task;
    const page = Number(task.page_number) || Number(task.start_page) || 0;
    const intro = Array.isArray(task.intro_words) ? task.intro_words : [];
    const from = formatRef(task.start_ref);
    const to = formatRef(task.end_ref);
    const versesHtml = c.revealed
      ? `<div class="entry-gate-page-scroll" id="entry-gate-page-scroll">
          ${(task.verses || []).map((verse) => `
            <div class="entry-gate-ayah-block" data-gate-ayah="${esc(String(verse.key))}">
              <div class="entry-gate-ayah-label">${esc(surahName(verse.surah))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${Number(verse.ayah) || ''}</div>
              <div class="entry-gate-ayah">${esc(verse.text)}</div>
            </div>`).join('')}
        </div>`
      : '';

    let actionsHtml = '';
    if (state.consolidationRecording) {
      actionsHtml = `
        <div class="recording-pulse-badge" style="margin: 0.6rem auto; display: inline-flex;">
          <span class="recording-dot"></span>
          <span>${esc(t('page_recording_active', 'جارٍ التسجيل... سمّع الصفحة غيبًا'))}</span>
          <span class="recording-timer" id="entry-gate-rec-timer">00:00</span>
        </div>
        <div class="entry-gate-actions">
          <button type="button" class="btn btn-danger entry-gate-main-btn" id="entry-gate-record-stop">
            ⏹️ ${esc(t('page_stop_recording', 'إيقاف التسجيل وعرض الصفحة'))}
          </button>
        </div>`;
    } else if (!c.revealed) {
      actionsHtml = `
        <div class="entry-gate-actions entry-gate-actions-split">
          <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-record-start">
            🎙️ ${esc(t('page_start_recording', 'ابدأ تسجيل التلاوة'))}
          </button>
          <button type="button" class="btn btn-ghost entry-gate-main-btn" id="entry-gate-page-reveal">
            ${esc(t('page_reveal_without_record', 'كشف الصفحة مباشرة'))}
          </button>
        </div>`;
    } else {
      actionsHtml = `
        <div class="playback-card" style="margin: 0.6rem 0; padding: 0.65rem; border-radius: 12px; background: rgba(15, 118, 110, 0.05); border: 1px solid rgba(15, 118, 110, 0.15);">
          ${state.consolidationAudioUrl ? `
            <div style="font-size: 0.88rem; font-weight: 700; color: var(--primary, #0f766e); margin-bottom: 0.4rem;">
              🎙️ ${esc(t('page_my_recording_label', 'تسجيل تلاوتك:'))}
            </div>
            <audio controls class="recorded-audio-player" id="entry-gate-recorded-audio" src="${state.consolidationAudioUrl}" style="width: 100%; height: 40px;"></audio>
            <div class="playback-sub-actions" style="margin-top: 0.4rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-ghost btn-sm" id="entry-gate-record-rerecord">
                🔄 ${esc(t('page_rerecord', 'إعادة التسجيل'))}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" id="entry-gate-qari-play">
                🔊 ${esc(t('page_listen_qari', 'استمع للقارئ'))}
              </button>
              <button type="button" class="btn btn-ghost btn-sm hidden" id="entry-gate-qari-stop">
                ⏹️ ${esc(t('page_stop_qari', 'إيقاف تلاوة القارئ'))}
              </button>
            </div>
          ` : `
            <div class="entry-gate-actions entry-gate-actions-split">
              <button type="button" class="btn btn-ghost entry-gate-main-btn" id="entry-gate-record-rerecord">
                🎙️ ${esc(t('page_start_recording', 'ابدأ تسجيل التلاوة'))}
              </button>
              <button type="button" class="btn btn-ghost entry-gate-main-btn" id="entry-gate-qari-play">
                🔊 ${esc(t('page_listen_qari', 'استمع للقارئ'))}
              </button>
              <button type="button" class="btn btn-ghost entry-gate-main-btn hidden" id="entry-gate-qari-stop">
                ⏹️ ${esc(t('page_stop_qari', 'إيقاف تلاوة القارئ'))}
              </button>
            </div>
          `}
        </div>
        <p class="consolidation-review-notice" style="margin: 0.5rem 0;" data-i18n="page_review_check_hint">
          ${esc(t('page_review_check_hint', 'استمع لتسجيلك وقارنه بنص المصحف أدناه لرصد أي سقط أو خطأ:'))}
        </p>`;
    }

    const body = `
      <div class="entry-gate-page-head">
        <span class="entry-gate-page-badge">${esc(t('entry_gate_page_badge', 'صفحة {page}').replace('{page}', page))}</span>
        <span class="entry-gate-page-ref">${esc(from)} — ${esc(to)}</span>
      </div>
      <div class="entry-gate-page-prompt">
        <span class="entry-gate-page-prompt-label">${esc(t('entry_gate_page_start', 'ابدأ من هنا'))}</span>
        <div class="entry-gate-page-prompt-words" dir="rtl">
          ${intro.map((word) => `<span>${esc(word)}</span>`).join('') || `<span class="entry-gate-loading">${esc(t('entry_gate_page_loading', 'جارٍ تحميل الصفحة...'))}</span>`}
        </div>
      </div>
      <p class="entry-gate-hint">${esc(t('page_recitation_hint', 'اقرأ الصفحة غيبًا من الكلمات الظاهرة أثناء التسجيل، ثم أوقف التسجيل لتستمع إلى تلاوتك وأنت تنظر في المصحف لكشف أي خطأ.'))}</p>
      ${actionsHtml}
      ${versesHtml}
      <div class="entry-gate-actions entry-gate-actions-split ${c.revealed ? '' : 'hidden'}" id="entry-gate-page-result">
        <button type="button" class="btn btn-success entry-gate-main-btn" id="entry-gate-page-done">
          ${esc(t('entry_gate_page_done', 'تم، ثبّتها'))} ✓
        </button>
        <button type="button" class="btn btn-ghost entry-gate-main-btn" id="entry-gate-page-improve">
          ${esc(t('entry_gate_page_improve', 'أحتاج تحسينًا'))}
        </button>
      </div>
      <p class="entry-gate-hint" id="entry-gate-consolidation-status" role="status"></p>`;

    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_page_title', 'تثبيت صفحة من حفظك'),
      t('entry_gate_page_sub', 'صفحة واحدة كل دخول: تسميع وتسجيل ثم كشف واستماع'),
      body
    ));

    const startRec = document.getElementById('entry-gate-record-start');
    if (startRec) startRec.addEventListener('click', startGateRecording);
    const stopRec = document.getElementById('entry-gate-record-stop');
    if (stopRec) stopRec.addEventListener('click', stopGateRecording);
    const rerecord = document.getElementById('entry-gate-record-rerecord');
    if (rerecord) {
      rerecord.addEventListener('click', () => {
        state.consolidationPending = false;
        cleanupGateRecording();
        startGateRecording();
      });
    }
    const reveal = document.getElementById('entry-gate-page-reveal');
    if (reveal) {
      reveal.addEventListener('click', () => {
        stopGateAudio();
        state.consolidationPending = false;
        cleanupGateRecording();
        c.revealed = true;
        renderConsolidation();
        scrollGateReveal();
      });
    }
    const qariPlay = document.getElementById('entry-gate-qari-play');
    if (qariPlay) qariPlay.addEventListener('click', playGateAudio);
    const qariStop = document.getElementById('entry-gate-qari-stop');
    if (qariStop) qariStop.addEventListener('click', stopGateAudio);

    const done = document.getElementById('entry-gate-page-done');
    if (done) done.addEventListener('click', () => reviewConsolidation('DONE'));
    const improve = document.getElementById('entry-gate-page-improve');
    if (improve) improve.addEventListener('click', () => reviewConsolidation('IMPROVE'));
  }

  async function reviewConsolidation(result) {
    const c = state.consolidation;
    if (state.busy || !c || !c.task) return;
    state.busy = true;
    c.busy = true;
    stopGateAudio();
    cleanupGateRecording();
    const done = document.getElementById('entry-gate-page-done');
    const improve = document.getElementById('entry-gate-page-improve');
    if (done) done.disabled = true;
    if (improve) improve.disabled = true;
    const status = document.getElementById('entry-gate-consolidation-status');
    if (status) status.textContent = t('entry_gate_saving', 'جارٍ الحفظ...');

    try {
      const { ok, data } = await api('../api/tasks/consolidation.php', {
        method: 'POST',
        body: { action: 'result', task_id: c.task.id, result },
      });
      if (!ok || !data || !data.success) {
        if (status) status.textContent = (data && (data.exception || data.error)) || t('entry_gate_error', 'تعذر الحفظ. أعد المحاولة.');
        if (done) done.disabled = false;
        if (improve) improve.disabled = false;
        return;
      }
      c.done = true;
      c.lastResult = result;
      showConsolidationDone(result === 'IMPROVE');
    } catch (e) {
      if (status) status.textContent = t('entry_gate_network_error', 'تعذر الاتصال بالخادم. أعد المحاولة.');
      if (done) done.disabled = false;
      if (improve) improve.disabled = false;
    } finally {
      state.busy = false;
      c.busy = false;
    }
  }

  function showConsolidationDone(improve) {
    const c = state.consolidation;
    if (!c) return;
    const body = `
      <div class="entry-gate-success" role="status">
        <span class="entry-gate-success-icon" aria-hidden="true">${improve ? '↻' : '✓'}</span>
        <div>
          <strong>${esc(improve
            ? t('entry_gate_page_improve_title', 'سُجّلت الصفحة للمزيد من التثبيت')
            : t('entry_gate_page_done_title', 'أتممت تثبيت الصفحة'))}</strong>
          <p>${esc(improve
            ? t('entry_gate_page_improve_desc', 'ستستمر هذه الصفحة في التثبيت حتى تتقنها وتثبتها بإذن الله.')
            : t('entry_gate_page_done_desc', 'أحسنت! يمكنك تثبيت المزيد من الصفحات في أي وقت من دفتر المهام.'))}</p>
        </div>
      </div>
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-page-next">
          ${esc(t('entry_gate_next', 'التالي'))} ←
        </button>
      </div>`;
    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_page_title', 'تثبيت صفحة من حفظك'),
      t('entry_gate_step_done', 'تمت الخطوة'),
      body
    ));
    const next = document.getElementById('entry-gate-page-next');
    if (next) next.addEventListener('click', nextAfterConsolidation);
  }

  function nextAfterConsolidation() {
    const kalimaat = state.data && state.data.kalimaat;
    if (kalimaat && kalimaat.available && kalimaat.locked) {
      startKalimaat();
      return;
    }
    startMistake();
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
    const target = Math.max(1, Math.min(25, remaining));

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
        <strong>${Number(word.repeat_count) || 0} / 500</strong>
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
        if (status) status.textContent = (data && (data.exception || data.error)) || t('entry_gate_error', 'تعذر الحفظ. أعد المحاولة.');
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
      t('entry_gate_step_done', 'تمت الخطوة'),
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

  function ayahTextAt(surahNumber, ayahNumber) {
    if (!state.quran) return '';
    const surah = state.quran[String(Number(surahNumber) || 0)];
    if (!Array.isArray(surah)) return '';
    return surah[Number(ayahNumber) - 1] || '';
  }

  function nextAyahRef(surahNumber, ayahNumber) {
    if (!state.quran) return null;
    const currentSurah = Number(surahNumber) || 0;
    const currentAyah = Number(ayahNumber) || 0;
    const current = state.quran[String(currentSurah)];
    if (!Array.isArray(current) || currentAyah < 1 || currentAyah > current.length) {
      return null;
    }
    if (currentAyah < current.length) {
      return { surah: currentSurah, ayah: currentAyah + 1 };
    }
    const nextSurah = Object.keys(state.quran)
      .map(Number)
      .filter((key) => Number.isFinite(key) && key > currentSurah)
      .sort((a, b) => a - b)
      .find((key) => Array.isArray(state.quran[String(key)]) && state.quran[String(key)].length);
    return nextSurah ? { surah: nextSurah, ayah: 1 } : null;
  }

  function ayahBlockHtml(surahNumber, ayahNumber, label, extraClass) {
    const text = ayahTextAt(surahNumber, ayahNumber);
    return `
      <div class="entry-gate-ayah-block ${extraClass || ''}">
        <div class="entry-gate-ayah-label">${esc(label)}</div>
        <div class="entry-gate-ayah">${text
          ? esc(text)
          : `<span class="entry-gate-loading">${esc(t('entry_gate_loading_ayah', 'جارٍ تحميل الآية...'))}</span>`}</div>
        <div class="entry-gate-ayah-ref">${esc(surahName(surahNumber))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${Number(ayahNumber) || ''}</div>
      </div>`;
  }

  function startMistake() {
    const payload = state.data && state.data.mistake;
    const card = payload && payload.card;
    if (!payload || !payload.available || !card) {
      finish();
      return;
    }

    const remaining = Math.max(0, Number(card.remaining) || 0);
    const target = Math.max(1, Math.min(15, remaining || 15));
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
    const type = String(card.mistake_type || 'AYAH_MISTAKE');
    const typeLabel = mistakeTypeLabel(type);
    const typeClass = mistakeTypeClass(type);
    let pairSurah = Number(card.confused_with_surah) || 0;
    let pairAyah = Number(card.confused_with_ayah) || 0;
    if (type === 'TRANSITION_FAILURE' && (!pairSurah || !pairAyah)) {
      const next = nextAyahRef(card.surah_number, card.ayah_number);
      if (next) {
        pairSurah = next.surah;
        pairAyah = next.ayah;
      }
    }
    const hasPair = type !== 'AYAH_MISTAKE' && pairSurah > 0 && pairAyah > 0;
    const quranReady = state.quran !== null;
    const currentLabel = t('entry_gate_mistake_current_ayah', 'الآية التي وقفت عندها');
    const pairLabel = type === 'MUTASHABIHAT'
      ? t('entry_gate_mistake_similar_ayah', 'الآية المتشابهة')
      : t('entry_gate_mistake_next_ayah', 'الآية التالية');
    const linkHint = type === 'MUTASHABIHAT'
      ? t('entry_gate_mistake_compare_hint', 'قارن بين الآيتين')
      : t('entry_gate_mistake_link_hint', 'صل الآيتين معًا');
    const typeHint = type === 'TRANSITION_FAILURE'
      ? t('entry_gate_mistake_hint_transition', 'اقرأ الآية الأولى ثم صلها بالآية التالية. أعد الربط كاملًا قبل اختيار النتيجة.')
      : type === 'MUTASHABIHAT'
        ? t('entry_gate_mistake_hint_mutashabihat', 'اقرأ الآيتين المتشابهتين وفرّق بينهما، ثم اختر النتيجة.')
        : t('entry_gate_mistake_hint', 'أعد الآية مرة واحدة ثم اختر النتيجة. تُحسب المحاولة الصحيحة فقط.');
    const currentText = ayahTextAt(card.surah_number, card.ayah_number);
    const verses = hasPair
      ? `<div class="entry-gate-ayah-stack">
          ${ayahBlockHtml(card.surah_number, card.ayah_number, currentLabel, 'is-current')}
          <div class="entry-gate-ayah-link">
            <span aria-hidden="true">↓</span>
            <span>${esc(linkHint)}</span>
          </div>
          ${ayahBlockHtml(pairSurah, pairAyah, pairLabel, 'is-pair')}
        </div>`
      : `<div class="entry-gate-ayah" id="entry-gate-ayah">${currentText
          ? esc(currentText)
          : `<span class="entry-gate-loading">${esc(t('entry_gate_loading_ayah', 'جارٍ تحميل الآية...'))}</span>`}</div>
        ${type !== 'AYAH_MISTAKE' && quranReady
          ? `<p class="entry-gate-note">${esc(t('entry_gate_mistake_pair_missing', 'لم تُحفظ الآية المرتبطة بهذه البطاقة.'))}</p>`
          : ''}`;
    const body = `
      ${progressHtml(m.done, m.target, t('entry_gate_this_entry', 'هذا الدخول'))}
      <div class="entry-gate-mistake-card" dir="rtl">
        <div class="entry-gate-mistake-ref">
          <span class="entry-gate-mistake-type ${typeClass}">${esc(typeLabel)}</span>
          <span>${esc(surahName(card.surah_number))} • ${esc(t('entry_gate_ayah', 'الآية'))} ${Number(card.ayah_number) || ''}</span>
          <span>${esc(t('entry_gate_page', 'صفحة'))} ${Number(card.page_number) || ''}</span>
        </div>
        ${verses}
        ${card.notes ? `<p class="entry-gate-note">${esc(card.notes)}</p>` : ''}
        <div class="entry-gate-lifetime">
          <span>${esc(t('entry_gate_mistake_lifetime', 'تكرار البطاقة'))}</span>
          <strong>${Number(card.practice_count) || 0} / ${Number(card.practice_target) || 15}</strong>
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
          : typeHint)}
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
          if (m.done >= m.target || data.completed || data.deleted || data.status === 'ARCHIVED' || data.status === 'DELETED' || m.card.remaining <= 0) {
            showMistakeDone();
            return;
          }
          m.lastResult = 'correct';
        } else {
          m.lastResult = 'slip';
        }
        renderMistake();
      } else if (data && /already completed|mistake not found/i.test(String(data.error || ''))) {
        showMistakeDone();
      } else {
        m.lastResult = result === 'CORRECT' ? '' : 'slip';
        if (status) status.textContent = (data && (data.exception || data.error)) || t('entry_gate_error', 'تعذر الحفظ. أعد المحاولة.');
        if (correctBtn) correctBtn.disabled = false;
        if (slipBtn) slipBtn.disabled = false;
      }
    } catch (e) {
      if (status) status.textContent = t('entry_gate_network_error', 'تعذر الاتصال بالخادم. أعد المحاولة.');
      if (correctBtn) correctBtn.disabled = false;
      if (slipBtn) slipBtn.disabled = false;
    } finally {
      state.busy = false;
      if (state.step === 'mistake' && state.mistake && !state.mistake.done) {
        const correctBtn = document.getElementById('entry-gate-correct');
        const slipBtn = document.getElementById('entry-gate-slip');
        if (correctBtn) correctBtn.disabled = false;
        if (slipBtn) slipBtn.disabled = false;
      }
    }
  }

  function showMistakeDone() {
    const m = state.mistake;
    if (!m) return;
    m.done = true;
    const finished = Number(m.done) >= Number(m.target) ||
      Number(m.card.practice_count) >= Number(m.card.practice_target);
    const body = `
      <div class="entry-gate-success" role="status">
        <span class="entry-gate-success-icon" aria-hidden="true">✓</span>
        <div>
          <strong>${esc(t('entry_gate_mistake_done_title', 'أتممت بطاقة الخطأ'))}</strong>
          <p>${esc(finished
            ? t('entry_gate_mistake_deleted_desc', 'أكملت التكرارات المطلوبة، فحُذفت البطاقة تلقائيًا. إن تكرر الخطأ لاحقًا فسجّله من جديد.')
            : t('entry_gate_mistake_done_desc', 'أكملت هذه الجولة. ستحضر بطاقة جديدة في الدخول القادم.'))}</p>
        </div>
      </div>
      <div class="entry-gate-lifetime">
        <span>${esc(t('entry_gate_mistake_lifetime', 'تكرار البطاقة'))}</span>
        <strong>${Number(m.card.practice_count) || 0} / ${Number(m.card.practice_target) || 15}</strong>
      </div>
      <div class="entry-gate-actions">
        <button type="button" class="btn btn-primary entry-gate-main-btn" id="entry-gate-enter">
          ${esc(t('entry_gate_enter', 'ادخل إلى التطبيق'))} ←
        </button>
      </div>`;
    render(shell(
      t('entry_gate_kicker', 'بوابة الدخول'),
      t('entry_gate_mistake_title', 'بطاقة خطأ للمراجعة'),
      t('entry_gate_step_done_last', 'تمت الخطوة الأخيرة'),
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
        ${visibleSteps().map((key) => {
          const label = STEP_LABELS[key];
          const doneFlag = key === 'consolidation' ? state.consolidation : (key === 'kalimaat' ? state.kalimaat : state.mistake);
          return `<div><span>${esc(t(label[0], label[1]))}</span><strong>${doneFlag ? '✓' : '—'}</strong></div>`;
        }).join('')}
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

  async function resolveConsolidation(payload) {
    if (payload && payload.available && payload.task) return payload;
    // Older deployments of api/kalimaat/get_entry.php predate page
    // consolidation and omit the `consolidation` block entirely. Ask the page
    // API directly so the gate still opens with page consolidation first
    // instead of silently skipping it.
    try {
      const { ok, data } = await api('../api/tasks/consolidation.php', { method: 'GET' });
      if (ok && data && data.success && data.task && !data.task.is_completed) {
        return { available: true, task: data.task };
      }
    } catch (e) {}
    return payload || { available: false, reason: 'UNAVAILABLE' };
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
      data.consolidation = await resolveConsolidation(data.consolidation);
      const hasConsolidation = !!(data.consolidation && data.consolidation.available && data.consolidation.task);
      const hasKalimaat = !!(data.kalimaat && data.kalimaat.available);
      const hasMistake = !!(data.mistake && data.mistake.available);
      if (!hasConsolidation && !hasKalimaat && !hasMistake) {
        markDone();
        return;
      }

      state.steps = {
        consolidation: hasConsolidation,
        kalimaat: hasKalimaat,
        mistake: hasMistake,
      };

      showOverlay();
      if (hasConsolidation) startConsolidation();
      else if (hasKalimaat) startKalimaat();
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
