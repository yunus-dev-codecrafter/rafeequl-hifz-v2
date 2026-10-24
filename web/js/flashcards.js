'use strict';

/* ==========================================================================
   Rafeequl Hifz (رفيق الحفظ) — Spaced-Repetition Flashcard Engine
   - Due-first deck with counter badges (due / new / active)
   - 4-way grading (AGAIN / HARD / GOOD / EASY) driven by review_mistake.php
   - Ayah text on the card back (offline bundle) + recitation audio
   - Swipe / tap to flip, keys 1-4 to grade, undo, session summary
   ========================================================================== */

const FC = {
  deck: [],
  pos: 0,
  busy: false,
  flipped: false,
  mode: 'due',
  shuffle: false,
  filters: { mistake_type: '', surah_number: '', juz_number: '' },
  counts: { due: 0, new: 0, total: 0 },
  stats: { again: 0, hard: 0, good: 0, easy: 0, graduated: 0 },
  initialTotal: 0,
  answered: 0,
  lastAction: null,
  audio: null,
  audioPlaying: false,
  pairPlaying: false,
  linkRevealed: false,
};

const fcEl = (id) => document.getElementById(id);

function fcT(key, params) {
  return window.I18N ? I18N.t(key, params) : key;
}

function sevLabel(sev) {
  if (sev >= 3) return fcT('sev_severe');
  if (sev === 2) return fcT('sev_medium');
  return fcT('sev_light');
}

/* ---------------- Offline Quran text ---------------- */

const QuranText = {
  data: null,
  loading: null,
  load() {
    if (this.data) return Promise.resolve(this.data);
    if (this.loading) return this.loading;
    this.loading = fetch('data/quran-uthmani.json', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { this.data = d; return d; })
      .catch(() => { this.loading = null; return null; });
    return this.loading;
  },
  get(surah, ayah) {
    if (!this.data) return null;
    const s = this.data[String(surah)];
    if (!s) return null;
    return s[ayah - 1] || null;
  },
};

function recitationUrl(surah, ayah) {
  const pad = (n) => String(n).padStart(3, '0');
  // EveryAyah hosts per-ayah MP3s; a stable, CORS-friendly CDN for recitation.
  return 'https://everyayah.com/data/Alafasy_128kbps/' + pad(surah) + pad(ayah) + '.mp3';
}

/* ---------------- Views ---------------- */

function fcShowOnly(view) {
  if (fcEl('deck-stage')) fcEl('deck-stage').classList.toggle('hidden', view !== 'stage');
  if (fcEl('deck-empty')) fcEl('deck-empty').classList.toggle('hidden', view !== 'empty');
  if (fcEl('deck-loading')) fcEl('deck-loading').classList.toggle('hidden', view !== 'loading');
  if (fcEl('deck-summary')) fcEl('deck-summary').classList.toggle('hidden', view !== 'summary');
  if (fcEl('fc-counters')) fcEl('fc-counters').classList.toggle('hidden', view === 'loading' || view === 'empty' || view === 'summary');
  if (fcEl('fc-progress-wrap')) fcEl('fc-progress-wrap').classList.toggle('hidden', view !== 'stage');
}

/* ---------------- Cards ---------------- */

function normalizeCard(raw) {
  if (!raw) return null;
  const mId = parseInt(raw.mistake_id ?? raw.id, 10);
  if (!mId || mId < 1) return null;
  const front = raw.front || {};
  const back = raw.back || {};
  return {
    mistake_id: mId,
    front: {
      surah_number: parseInt(front.surah_number, 10) || 1,
      surah_name: front.surah_name || '',
      page_number: parseInt(front.page_number, 10) || 1,
      ayah_number: parseInt(front.ayah_number, 10) || 1,
      mistake_type: front.mistake_type || 'MUTASHABIHAT',
      mistake_label: front.mistake_label || front.mistake_type || '',
      severity: parseInt(front.severity, 10) || 1,
      juz_number: front.juz_number || null,
      hizb_number: front.hizb_number || null,
      rub_el_hizb: front.rub_el_hizb || null,
      confused_with_surah: front.confused_with_surah || null,
      confused_with_surah_name: front.confused_with_surah_name || null,
      confused_with_ayah: front.confused_with_ayah || null,
      source_task: front.source_task || null,
    },
    back: {
      notes: back.notes || '',
      mastery_count: parseInt(back.mastery_count ?? 0, 10),
      occurrence_count: parseInt(back.occurrence_count ?? 1, 10),
      interval_days: parseInt(back.interval_days ?? 0, 10),
      lapses: parseInt(back.lapses ?? 0, 10),
      streak_correct: parseInt(back.streak_correct ?? 0, 10),
      is_new: !!back.is_new,
      due_at: back.due_at || null,
      last_reviewed_at: back.last_reviewed_at || null,
      logged_at: back.logged_at || '',
    },
  };
}

function fcCard() {
  return FC.deck[FC.pos] || null;
}

function fcIntervalLabel(card) {
  if (card.back.is_new || card.back.interval_days <= 0) return fcT('fc_interval_today');
  return fcT('fc_interval_days', { days: card.back.interval_days });
}

function fcUpdateProgress() {
  const total = FC.initialTotal || 0;
  const remaining = FC.deck.length;
  const done = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = fcEl('deck-progress-bar');
  if (bar) bar.style.width = pct + '%';
  const counter = fcEl('deck-counter');
  if (counter) counter.textContent = fcT('fc_deck_progress', { done, total });
}

function fcUpdateCounters() {
  if (fcEl('fc-due-count')) fcEl('fc-due-count').textContent = FC.counts.due;
  if (fcEl('fc-new-count')) fcEl('fc-new-count').textContent = FC.counts.new;
  if (fcEl('fc-total-count')) fcEl('fc-total-count').textContent = FC.counts.total;
}

function fcRender() {
  if (!FC.deck.length) return;
  if (FC.pos >= FC.deck.length) FC.pos = 0;

  const card = fcCard();
  const f = card.front;
  const b = card.back;

  const sName = (window.I18N) ? I18N.getSurahName(f.surah_number) : f.surah_name;
  const sDisplay = (window.I18N && I18N.lang === 'en') ? ('Surah ' + sName) : ('سورة ' + sName);

  if (fcEl('fc-page')) fcEl('fc-page').textContent = fcT('page_prefix') + f.page_number;
  if (fcEl('fc-surah')) fcEl('fc-surah').textContent = sDisplay;
  if (fcEl('fc-ayah')) fcEl('fc-ayah').textContent = fcT('ayah_label', { num: f.ayah_number });
  if (fcEl('fc-tag')) fcEl('fc-tag').textContent = window.I18N ? I18N.getMistakeLabel(f.mistake_type) : f.mistake_label;

  const parts = [];
  if (f.juz_number) parts.push(fcT('juz_label', { num: f.juz_number }));
  if (f.hizb_number) parts.push(fcT('hizb_label', { num: f.hizb_number }));
  if (fcEl('fc-meta')) fcEl('fc-meta').textContent = parts.join(' · ');

  // Flags: new / severity / occurrence / mutashabihat pairing
  const flags = [];
  if (b.is_new) flags.push(`<span class="fc-flag fc-flag-new">${fcT('fc_card_new')}</span>`);
  flags.push(`<span class="fc-flag fc-flag-sev fc-sev-${f.severity}">${fcT('fc_card_severity', { level: sevLabel(f.severity) })}</span>`);
  if (b.occurrence_count > 1) flags.push(`<span class="fc-flag fc-flag-occ">${fcT('fc_card_occurrence', { count: b.occurrence_count })}</span>`);
  if (f.confused_with_surah && f.confused_with_ayah) {
    const csName = (window.I18N) ? I18N.getSurahName(f.confused_with_surah) : (f.confused_with_surah_name || '');
    if (f.mistake_type === 'TRANSITION_FAILURE') {
      // Never reveal the next verse on the front — that is the answer.
      flags.push(`<span class="fc-flag fc-flag-link">${fcT('fc_card_transition')}</span>`);
    } else {
      flags.push(`<span class="fc-flag fc-flag-confused">${fcT('fc_card_confused', { surah: csName, ayah: f.confused_with_ayah })}</span>`);
    }
  }
  if (fcEl('fc-flags')) fcEl('fc-flags').innerHTML = flags.join('');

  // Record line (mastery + next interval)
  if (fcEl('fc-record')) {
    const rec = [];
    rec.push(fcT('fc_card_record') + ': ' + b.mastery_count);
    rec.push(fcT('fc_card_interval', { label: fcIntervalLabel(card) }));
    fcEl('fc-record').textContent = rec.join(' · ');
  }

  // Back: ayah text + notes
  fcRenderAyahText(card);
  fcRenderLink(card);
  if (fcEl('fc-notes')) {
    fcEl('fc-notes').textContent = b.notes || fcT('fc_card_no_notes');
  }

  // Reset audio
  fcStopAudio();

  fcUpdateProgress();
  fcFlip(false);
}

function fcRenderAyahText(card) {
  const el = fcEl('fc-ayah-text');
  if (!el) return;
  const f = card.front;
  const cached = QuranText.get(f.surah_number, f.ayah_number);
  if (cached) {
    el.textContent = cached;
    return;
  }
  el.textContent = fcT('fc_ayah_unavailable');
  QuranText.load().then(() => {
    // Only apply if the same card is still on screen.
    const current = fcCard();
    if (!current || current.mistake_id !== card.mistake_id) return;
    const txt = QuranText.get(f.surah_number, f.ayah_number);
    el.textContent = txt || fcT('fc_ayah_unavailable');
  });
}

/* ---------------- Audio ---------------- */

function fcStopAudio() {
  if (FC.audio) {
    try { FC.audio.onended = null; FC.audio.pause(); } catch (e) {}
  }
  FC.audioPlaying = false;
  FC.pairPlaying = false;
  const btn = fcEl('btn-play-ayah');
  if (btn) btn.textContent = fcT('fc_play_btn');
  const pbtn = fcEl('btn-play-pair');
  if (pbtn) pbtn.textContent = fcT('fc_play_pair');
}

function fcToggleAudio() {
  const card = fcCard();
  if (!card) return;
  if (FC.audioPlaying || FC.pairPlaying) {
    fcStopAudio();
    return;
  }
  const btn = fcEl('btn-play-ayah');
  const url = recitationUrl(card.front.surah_number, card.front.ayah_number);
  if (!FC.audio) FC.audio = new Audio();
  FC.audio.src = url;
  FC.audio.onended = () => fcStopAudio();
  FC.audio.onerror = () => { fcStopAudio(); showToast(fcT('fc_audio_error'), true); };
  FC.audio.play().then(() => {
    FC.audioPlaying = true;
    if (btn) btn.textContent = fcT('fc_stop_btn');
  }).catch(() => {
    fcStopAudio();
    showToast(fcT('fc_audio_error'), true);
  });
}

/* Play ayah A then its linked ayah B, so the ear learns the junction. */
function fcPlayPair() {
  const card = fcCard();
  if (!card) return;
  const f = card.front;
  if (!f.confused_with_surah || !f.confused_with_ayah) return;
  if (FC.audioPlaying || FC.pairPlaying) {
    fcStopAudio();
    return;
  }

  const seq = [
    { surah: f.surah_number, ayah: f.ayah_number },
    { surah: f.confused_with_surah, ayah: f.confused_with_ayah },
  ];
  if (!FC.audio) FC.audio = new Audio();
  const btn = fcEl('btn-play-pair');
  FC.pairPlaying = true;
  if (btn) btn.textContent = fcT('fc_stop_pair');

  let i = 0;
  const step = () => {
    if (!FC.pairPlaying) return;
    if (i >= seq.length) { fcStopAudio(); return; }
    const it = seq[i++];
    FC.audio.src = recitationUrl(it.surah, it.ayah);
    FC.audio.onended = step;
    FC.audio.onerror = () => { showToast(fcT('fc_audio_error'), true); fcStopAudio(); };
    FC.audio.play().catch(() => fcStopAudio());
  };
  step();
}

/* Reveal the linked ("next") verse on the card back. */
function fcRenderLink(card) {
  const row = fcEl('fc-link-row');
  const pairBtn = fcEl('btn-play-pair');
  const revealBtn = fcEl('btn-reveal-link');
  const f = card.front;
  const hasLink = !!(f.confused_with_surah && f.confused_with_ayah);
  // Only a forgotten-next-verse (transition) card has a hidden answer. A
  // mutashabihat card shows its "confused with" verse as a hint.
  const gate = hasLink && f.mistake_type === 'TRANSITION_FAILURE';

  FC.linkRevealed = false;
  if (row) row.classList.toggle('hidden', gate || !hasLink);
  if (pairBtn) pairBtn.classList.toggle('hidden', gate || !hasLink);
  if (revealBtn) revealBtn.classList.toggle('hidden', !gate);
  if (!hasLink) return;

  const csName = (window.I18N) ? I18N.getSurahName(f.confused_with_surah) : (f.confused_with_surah_name || '');
  const csDisplay = (window.I18N && I18N.lang === 'en') ? ('Surah ' + csName) : ('سورة ' + csName);
  if (fcEl('fc-link-ref')) {
    fcEl('fc-link-ref').textContent = csDisplay + ' · ' + fcT('ayah_label', { num: f.confused_with_ayah });
  }

  const el = fcEl('fc-link-text');
  if (!el) return;
  const cached = QuranText.get(f.confused_with_surah, f.confused_with_ayah);
  if (cached) { el.textContent = cached; return; }
  el.textContent = fcT('fc_ayah_unavailable');
  QuranText.load().then(() => {
    const current = fcCard();
    if (!current || current.mistake_id !== card.mistake_id) return;
    const txt = QuranText.get(f.confused_with_surah, f.confused_with_ayah);
    el.textContent = txt || fcT('fc_ayah_unavailable');
  });
}

/* Show the linked verse (and its pair audio) after an explicit tap. */
function fcRevealLink() {
  const row = fcEl('fc-link-row');
  const pairBtn = fcEl('btn-play-pair');
  const revealBtn = fcEl('btn-reveal-link');
  if (row) row.classList.remove('hidden');
  if (pairBtn) pairBtn.classList.remove('hidden');
  if (revealBtn) revealBtn.classList.add('hidden');
  FC.linkRevealed = true;
}

/* Re-hide the linked verse every time the card is flipped to its back. */
function fcResetLinkReveal() {
  const row = fcEl('fc-link-row');
  const pairBtn = fcEl('btn-play-pair');
  const revealBtn = fcEl('btn-reveal-link');
  const card = fcCard();
  const front = card ? card.front : {};
  const hasLink = !!(front.confused_with_surah && front.confused_with_ayah);
  const gate = hasLink && front.mistake_type === 'TRANSITION_FAILURE';
  FC.linkRevealed = false;
  // Non-gated cards (mutashabihat) keep their paired verse visible.
  if (row) row.classList.toggle('hidden', gate || !hasLink);
  if (pairBtn) pairBtn.classList.toggle('hidden', gate || !hasLink);
  if (revealBtn) revealBtn.classList.toggle('hidden', !gate);
}

/* ---------------- Flip & animation ---------------- */

function fcFlip(force) {
  const cardEl = fcEl('flashcard');
  if (!cardEl) return;
  cardEl.classList.remove('exiting-left', 'exiting-right');
  FC.flipped = typeof force === 'boolean' ? force : !FC.flipped;
  cardEl.classList.toggle('is-flipped', FC.flipped);
  if (FC.flipped) fcResetLinkReveal();

  if (fcEl('deck-actions')) fcEl('deck-actions').classList.toggle('hidden', !FC.flipped);
  if (fcEl('btn-show-hint')) fcEl('btn-show-hint').classList.toggle('hidden', FC.flipped);
}

function fcAnimateExit(direction) {
  return new Promise((resolve) => {
    const cardEl = fcEl('flashcard');
    if (!cardEl) return resolve();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return resolve();
    }
    cardEl.classList.add(direction === 'right' ? 'exiting-right' : 'exiting-left');
    setTimeout(resolve, 340);
  });
}

/* ---------------- Grading ---------------- */

async function fcGrade(grade) {
  const card = fcCard();
  if (!card || FC.busy) return;

  const mistakeId = parseInt(card.mistake_id, 10);
  if (!mistakeId || mistakeId < 1) {
    showToast(fcT('err_unexpected'), true);
    return;
  }

  FC.busy = true;
  fcSetGradeButtons(false);

  try {
    const res = await API.call('mistakes/review_mistake.php', {
      method: 'POST',
      body: { mistake_id: mistakeId, grade },
      redirectOn401: true,
    });

    await fcAnimateExit(grade === 'AGAIN' ? 'right' : 'left');

    // Local deck bookkeeping.
    FC.deck.splice(FC.pos, 1);
    FC.answered++;
    const statKey = grade.toLowerCase();
    FC.stats[statKey] = (FC.stats[statKey] || 0) + 1;
    if (res && res.graduated) FC.stats.graduated++;

    const requeue = (grade === 'AGAIN');
    if (requeue) {
      FC.deck.push(card);
    }

    FC.lastAction = { mistakeId, card, grade, graduated: !!(res && res.graduated) };
    if (fcEl('btn-fc-undo')) fcEl('btn-fc-undo').disabled = false;

    if (grade === 'EASY' || (res && res.graduated)) {
      if (window.AudioEngine) AudioEngine.playCelebration();
    } else if (grade === 'GOOD') {
      if (window.AudioEngine) AudioEngine.playSuccess();
    } else {
      if (window.AudioEngine) AudioEngine.playUndo();
    }

    if (requeue) {
      showToast(fcT('fc_grade_again') + ' — ' + fcT('fc_interval_today'));
    }

    if (!FC.deck.length) {
      fcRenderSummary();
    } else {
      if (FC.pos >= FC.deck.length) FC.pos = 0;
      fcRender();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    FC.busy = false;
    fcSetGradeButtons(true);
  }
}

function fcSetGradeButtons(enabled) {
  ['btn-again', 'btn-hard', 'btn-good', 'btn-easy', 'btn-delete-card'].forEach((id) => {
    const el = fcEl(id);
    if (el) el.disabled = !enabled;
  });
}

async function fcUndo() {
  if (FC.busy || !FC.lastAction) {
    showToast(fcT('fc_undo_none'));
    return;
  }
  FC.busy = true;
  const action = FC.lastAction;
  try {
    await API.call('mistakes/undo_review.php', {
      method: 'POST',
      body: { mistake_id: action.mistakeId },
      redirectOn401: true,
    });

    // Reverse local bookkeeping.
    const statKey = action.grade.toLowerCase();
    FC.stats[statKey] = Math.max(0, (FC.stats[statKey] || 0) - 1);
    if (action.graduated) FC.stats.graduated = Math.max(0, FC.stats.graduated - 1);
    FC.answered = Math.max(0, FC.answered - 1);

    // Remove the requeued copy if present, then restore to the front.
    const idx = FC.deck.findIndex((c) => c.mistake_id === action.mistakeId);
    if (idx !== -1) FC.deck.splice(idx, 1);
    FC.deck.splice(FC.pos, 0, action.card);
    FC.lastAction = null;
    if (fcEl('btn-fc-undo')) fcEl('btn-fc-undo').disabled = true;

    fcShowOnly('stage');
    fcRender();
    showToast(fcT('fc_undo_toast'));
  } catch (err) {
    showToast(err.message, true);
  } finally {
    FC.busy = false;
  }
}

async function fcDelete() {
  const card = fcCard();
  if (!card || FC.busy) return;
  const confirmMsg = fcT('fc_delete_confirm');
  if (!confirm(confirmMsg)) return;

  FC.busy = true;
  fcSetGradeButtons(false);
  try {
    await API.call('mistakes/clear_mistake.php', {
      method: 'POST',
      body: { mistake_id: card.mistake_id, action: 'DELETE' },
      redirectOn401: true,
    });
    await fcAnimateExit('left');
    FC.deck.splice(FC.pos, 1);
    showToast(fcT('fc_toast_deleted'));
    if (!FC.deck.length) {
      fcRenderSummary();
    } else {
      if (FC.pos >= FC.deck.length) FC.pos = 0;
      fcRender();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    FC.busy = false;
    fcSetGradeButtons(true);
  }
}

/* ---------------- Summary ---------------- */

function fcRenderSummary() {
  const el = fcEl('deck-summary');
  if (!el) return;
  const reviewed = FC.stats.again + FC.stats.hard + FC.stats.good + FC.stats.easy;
  const goodish = FC.stats.good + FC.stats.easy;
  const accuracy = reviewed > 0 ? Math.round((goodish / reviewed) * 100) : 0;

  el.innerHTML = `
    <div style="font-size:3rem; margin-bottom:0.25rem;">🌟</div>
    <h3>${fcT('fc_summary_title')}</h3>
    <p class="hint" style="margin-bottom:1.25rem;">${fcT('fc_summary_desc')}</p>
    <div class="fc-summary-grid">
      <div class="fc-summary-item"><span class="fc-summary-value">${reviewed}</span><span class="fc-summary-label">${fcT('fc_summary_total')}</span></div>
      <div class="fc-summary-item"><span class="fc-summary-value">${accuracy}%</span><span class="fc-summary-label">${fcT('fc_summary_accuracy')}</span></div>
      <div class="fc-summary-item"><span class="fc-summary-value">${FC.stats.graduated}</span><span class="fc-summary-label">${fcT('fc_summary_graduated')}</span></div>
    </div>
    <div style="display:flex; justify-content:center; gap:0.75rem; flex-wrap:wrap; margin-top:1.25rem;">
      <button type="button" id="btn-summary-restart" class="btn btn-primary">${fcT('fc_summary_restart')}</button>
      <a href="history.html" class="btn btn-ghost">${fcT('fc_btn_view_history')}</a>
    </div>
  `;
  fcShowOnly('summary');
  if (window.AudioEngine) AudioEngine.playCelebration();
  const restart = fcEl('btn-summary-restart');
  if (restart) restart.addEventListener('click', () => loadFlashcardsDeck());
}

/* ---------------- Empty state ---------------- */

function fcShowEmpty(modeApplied) {
  const title = fcEl('deck-empty-title');
  const desc = fcEl('deck-empty-desc');
  const practiceAll = fcEl('btn-practice-all');

  if (modeApplied === 'due' && FC.counts.total > 0) {
    if (title) title.textContent = fcT('fc_no_due_title');
    if (desc) desc.textContent = fcT('fc_no_due_desc');
    if (practiceAll) practiceAll.classList.remove('hidden');
  } else {
    if (title) title.textContent = fcT('fc_empty_title');
    if (desc) desc.textContent = fcT('fc_empty_desc');
    if (practiceAll) practiceAll.classList.add('hidden');
  }
  fcShowOnly('empty');
}

/* ---------------- Loading ---------------- */

function fcBuildQuery() {
  const q = new URLSearchParams();
  q.set('mode', FC.mode);
  if (FC.shuffle) q.set('shuffle', '1');
  if (FC.filters.mistake_type) q.set('mistake_type', FC.filters.mistake_type);
  if (FC.filters.surah_number) q.set('surah_number', FC.filters.surah_number);
  if (FC.filters.juz_number) q.set('juz_number', FC.filters.juz_number);
  return q.toString();
}

async function loadFlashcardsDeck() {
  fcShowOnly('loading');
  try {
    const res = await API.call('mistakes/get_flashcards.php?' + fcBuildQuery(), { redirectOn401: true });
    FC.counts = {
      due: (res && res.due_count) || 0,
      new: (res && res.new_count) || 0,
      total: (res && res.total_active) || 0,
    };
    fcUpdateCounters();

    const cards = ((res && res.cards) || []).map(normalizeCard).filter(Boolean);
    if (!cards.length) {
      FC.deck = [];
      fcShowEmpty(FC.mode);
      return;
    }
    fcStartDeck(cards);
    // Warm the offline text bundle for the back faces.
    QuranText.load();
  } catch (err) {
    showToast(err.message || fcT('err_unexpected'), true);
    fcShowEmpty(FC.mode);
  }
}

function fcStartDeck(cards) {
  FC.deck = cards.slice();
  FC.pos = 0;
  FC.busy = false;
  FC.answered = 0;
  FC.lastAction = null;
  FC.stats = { again: 0, hard: 0, good: 0, easy: 0, graduated: 0 };
  FC.initialTotal = cards.length;
  if (fcEl('btn-fc-undo')) fcEl('btn-fc-undo').disabled = true;
  fcShowOnly('stage');
  fcRender();
}

/* ---------------- Filters / toolbar ---------------- */

function fcPopulateFilters() {
  const typeSel = fcEl('fc-filter-type');
  if (typeSel && typeSel.options.length <= 1) {
    const types = ['TRANSITION_FAILURE', 'MUTASHABIHAT', 'TAWAQQUF', 'TASHKEEL', 'LAFDH'];
    types.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = window.I18N ? I18N.getMistakeLabel(t) : t;
      typeSel.appendChild(o);
    });
  }

  const juzSel = fcEl('fc-filter-juz');
  if (juzSel && juzSel.options.length <= 1) {
    for (let j = 1; j <= 30; j++) {
      const o = document.createElement('option');
      o.value = j;
      o.textContent = fcT('juz_label', { num: j });
      juzSel.appendChild(o);
    }
  }

  const surahSel = fcEl('fc-filter-surah');
  if (surahSel && surahSel.options.length <= 1) {
    const list = window.SURAHS_DATA || [];
    list.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      const name = window.I18N ? I18N.getSurahName(s.id) : (s.name_ar || s.name);
      o.textContent = s.id + '. ' + name;
      surahSel.appendChild(o);
    });
  }
}

function fcRefreshFilterLabels() {
  const allLabel = fcT('fc_filter_all');
  ['fc-filter-type', 'fc-filter-surah', 'fc-filter-juz'].forEach((id) => {
    const sel = fcEl(id);
    if (sel && sel.options[0]) sel.options[0].textContent = allLabel;
  });
  const typeSel = fcEl('fc-filter-type');
  if (typeSel) {
    const types = ['TRANSITION_FAILURE', 'MUTASHABIHAT', 'TAWAQQUF', 'TASHKEEL', 'LAFDH'];
    types.forEach((t) => {
      const opt = Array.from(typeSel.options).find((o) => o.value === t);
      if (opt) opt.textContent = window.I18N ? I18N.getMistakeLabel(t) : t;
    });
  }
}

function initFlashcardsPage() {
  const cardEl = fcEl('flashcard');

  cardEl.addEventListener('click', () => fcFlip());
  cardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fcFlip(); }
  });

  // Swipe to flip
  let touchX = 0, touchY = 0, touching = false;
  cardEl.addEventListener('touchstart', (e) => {
    if (!e.touches.length) return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; touching = true;
  }, { passive: true });
  cardEl.addEventListener('touchend', (e) => {
    if (!touching) return;
    touching = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) fcFlip();
  }, { passive: true });

  const hintBtn = fcEl('btn-show-hint');
  if (hintBtn) hintBtn.addEventListener('click', (e) => { e.stopPropagation(); fcFlip(true); });

  const gradeMap = { 'btn-again': 'AGAIN', 'btn-hard': 'HARD', 'btn-good': 'GOOD', 'btn-easy': 'EASY' };
  Object.entries(gradeMap).forEach(([id, grade]) => {
    const b = fcEl(id);
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); fcGrade(grade); });
  });

  const playBtn = fcEl('btn-play-ayah');
  if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); fcToggleAudio(); });

  const pairBtn = fcEl('btn-play-pair');
  if (pairBtn) pairBtn.addEventListener('click', (e) => { e.stopPropagation(); fcPlayPair(); });

  const revealLinkBtn = fcEl('btn-reveal-link');
  if (revealLinkBtn) revealLinkBtn.addEventListener('click', (e) => { e.stopPropagation(); fcRevealLink(); });

  const delBtn = fcEl('btn-delete-card');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); fcDelete(); });

  const undoBtn = fcEl('btn-fc-undo');
  if (undoBtn) undoBtn.addEventListener('click', fcUndo);

  const practiceAll = fcEl('btn-practice-all');
  if (practiceAll) practiceAll.addEventListener('click', () => {
    FC.mode = 'all';
    document.querySelectorAll('.fc-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'all'));
    loadFlashcardsDeck();
  });

  // Mode switch
  document.querySelectorAll('.fc-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      FC.mode = btn.dataset.mode === 'all' ? 'all' : 'due';
      document.querySelectorAll('.fc-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      loadFlashcardsDeck();
    });
  });

  // Shuffle
  const shuffleBtn = fcEl('btn-fc-shuffle');
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => {
    FC.shuffle = !FC.shuffle;
    shuffleBtn.classList.toggle('btn-primary', FC.shuffle);
    loadFlashcardsDeck();
  });

  // Filters
  const filtersBtn = fcEl('btn-fc-filters');
  if (filtersBtn) filtersBtn.addEventListener('click', () => {
    const p = fcEl('fc-filter-panel');
    if (p) p.classList.toggle('hidden');
  });
  const applyBtn = fcEl('btn-fc-filter-apply');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    FC.filters.mistake_type = fcEl('fc-filter-type') ? fcEl('fc-filter-type').value : '';
    FC.filters.surah_number = fcEl('fc-filter-surah') ? fcEl('fc-filter-surah').value : '';
    FC.filters.juz_number = fcEl('fc-filter-juz') ? fcEl('fc-filter-juz').value : '';
    const p = fcEl('fc-filter-panel');
    if (p) p.classList.add('hidden');
    loadFlashcardsDeck();
  });
  const resetBtn = fcEl('btn-fc-filter-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    FC.filters = { mistake_type: '', surah_number: '', juz_number: '' };
    ['fc-filter-type', 'fc-filter-surah', 'fc-filter-juz'].forEach((id) => { if (fcEl(id)) fcEl(id).value = ''; });
    const p = fcEl('fc-filter-panel');
    if (p) p.classList.add('hidden');
    loadFlashcardsDeck();
  });

  // Keyboard grading / flip
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (FC.busy) return;
    const stage = fcEl('deck-stage');
    if (!stage || stage.classList.contains('hidden')) return;
    if (e.key === '1') { e.preventDefault(); fcGrade('AGAIN'); }
    else if (e.key === '2') { e.preventDefault(); fcGrade('HARD'); }
    else if (e.key === '3') { e.preventDefault(); fcGrade('GOOD'); }
    else if (e.key === '4') { e.preventDefault(); fcGrade('EASY'); }
    else if (e.key === '+' || e.key === 'o' || e.key === 'O') { fcFlip(true); }
  });

  if (window.I18N) {
    I18N.onChange(() => {
      fcPopulateFilters();
      fcRefreshFilterLabels();
      if (fcEl('deck-summary') && !fcEl('deck-summary').classList.contains('hidden')) fcRenderSummary();
      else if (fcEl('deck-stage') && !fcEl('deck-stage').classList.contains('hidden') && FC.deck.length) fcRender();
      fcUpdateCounters();
    });
  }

  fcPopulateFilters();
  loadFlashcardsDeck();
}

document.addEventListener('DOMContentLoaded', () => {
  if (fcEl('flashcard')) {
    initFlashcardsPage();
  }
});
