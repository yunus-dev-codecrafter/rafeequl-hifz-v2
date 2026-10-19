'use strict';

/* ==========================================================================
   Rafeequl Hifz — Page Recall Board ("بطاقة تثبيت الصفحة")

   A per-page memory aid that lives on the recitation stage:

     • Verse anchors (رؤوس الآيات): the opening words of every ayah on the
       page, pulled from the offline Uthmani bundle. Tap to drop one into the
       note, long-press to log a mistake on that exact ayah, or play it.
     • Play-the-page: recites the page ayah by ayah, highlighting each one as
       it goes, so the eye follows the recitation.
     • Your mistakes on this page, surfaced as ready-made "focus here" cues.
     • A free-form note that autosaves (server-backed, with an offline
       localStorage copy that syncs back when the server is reachable again).
     • Print / PDF export of the whole page map.

   Everything degrades gracefully: if the `page_notes` table has not been
   migrated yet, the board still works and simply keeps notes on the device.
   ========================================================================== */

const PageNotes = {
  ctx: null,
  userId: '0',
  cache: {},           // page -> { note, updated_at, dirty }
  mountedPage: null,
  rangeLoaded: false,
  quran: null,
  quranLoading: null,
  saveTimer: null,
  audio: null,
  seq: null,           // [{surah, ayah}] currently playing
  seqIdx: -1,
  playingKey: null,
  statusKey: 'saved',
  collapsed: false,
  drill: null,         // { list, idx, ok, missed, revealed, logged }
};

const PN_LS_NOTES = () => 'rh_page_notes_v1_' + PageNotes.userId;
const PN_LS_COLLAPSED = 'rh_page_notes_collapsed';

/* ---------------- Helpers ---------------- */

function pnEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pnT(key, params, fallback) {
  if (window.I18N && typeof I18N.t === 'function') {
    const out = I18N.t(key, params);
    if (out != null && out !== key) return out;
  }
  return fallback;
}

function pnRecitationUrl(surah, ayah) {
  const pad = (n) => String(n).padStart(3, '0');
  return 'https://everyayah.com/data/Alafasy_128kbps/' + pad(surah) + pad(ayah) + '.mp3';
}

function pnSurahName(id) {
  if (window.I18N && typeof I18N.getSurahName === 'function') {
    const n = I18N.getSurahName(id);
    if (n) return n;
  }
  const list = window.SURAHS_DATA || [];
  const s = list.find((x) => x.id === id);
  return (s && (s.name_ar || s.name)) || String(id);
}

function pnStatic(key, fallback) {
  return pnT(key, null, fallback);
}

/* ---------------- Local persistence ---------------- */

PageNotes.readLocal = function () {
  try {
    const raw = localStorage.getItem(PN_LS_NOTES());
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
};

PageNotes.persistLocal = function () {
  try {
    localStorage.setItem(PN_LS_NOTES(), JSON.stringify(this.cache));
  } catch (e) {
    /* storage full / private mode — the in-memory copy still works */
  }
};

PageNotes.readCollapsed = function () {
  try {
    return localStorage.getItem(PN_LS_COLLAPSED) === '1';
  } catch (e) {
    return false;
  }
};

PageNotes.setCollapsed = function (value) {
  this.collapsed = !!value;
  try {
    localStorage.setItem(PN_LS_COLLAPSED, this.collapsed ? '1' : '0');
  } catch (e) {}
};

/* ---------------- Lifecycle ---------------- */

PageNotes.init = function (ctx) {
  this.ctx = ctx || this.ctx;

  const uid = (ctx && ctx.user && ctx.user.id) ? String(ctx.user.id) : '0';
  if (uid !== this.userId) {
    this.userId = uid;
    this.cache = this.readLocal();
    this.rangeLoaded = false;
  } else if (!Object.keys(this.cache).length) {
    this.cache = this.readLocal();
  }

  this.collapsed = this.readCollapsed();
  this.loadQuran();
  this.flushDirty();
};

PageNotes.loadQuran = function () {
  if (this.quran) return Promise.resolve(this.quran);
  if (this.quranLoading) return this.quranLoading;
  this.quranLoading = fetch('data/quran-uthmani.json', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { this.quran = d; return d; })
    .catch(() => { this.quranLoading = null; return null; });
  return this.quranLoading;
};

PageNotes.ayahText = function (surah, ayah) {
  if (!this.quran) return '';
  const arr = this.quran[String(surah)];
  return (arr && arr[ayah - 1]) || '';
};

PageNotes.firstWords = function (surah, ayah, count) {
  const full = this.ayahText(surah, ayah);
  if (!full) return '';
  const words = full.trim().split(/\s+/);
  return words.slice(0, count || 4).join(' ');
};

PageNotes.lastWords = function (surah, ayah, count) {
  const full = this.ayahText(surah, ayah);
  if (!full) return '';
  const words = full.trim().split(/\s+/);
  const n = count || 5;
  return words.slice(Math.max(0, words.length - n)).join(' ');
};

/** The verse that follows (surah, ayah) in mushaf order (null at the very end). */
PageNotes.nextRef = function (surah, ayah) {
  if (!this.quran) return null;
  const arr = this.quran[String(surah)];
  if (!arr) return null;
  if (ayah < arr.length) return { surah, ayah: ayah + 1 };
  const nextArr = this.quran[String(surah + 1)];
  if (nextArr && nextArr.length) return { surah: surah + 1, ayah: 1 };
  return null;
};

/* ---------------- Server sync ---------------- */

PageNotes.prefetchRange = async function (from, to) {
  if (this.rangeLoaded || !from || !to) return;
  this.rangeLoaded = true;
  try {
    const res = await API.call('notes/get_page_notes.php?from=' + from + '&to=' + to, {
      redirectOn401: false,
    });
    if (!res || res.available === false) return;
    const notes = res.notes || {};
    Object.keys(notes).forEach((key) => {
      const page = parseInt(key, 10);
      const local = this.cache[page];
      if (local && local.dirty) return; // never clobber unsynced edits
      this.cache[page] = {
        note: String(notes[key].note || ''),
        updated_at: notes[key].updated_at || null,
        dirty: false,
      };
    });
    this.persistLocal();
    this.decorateChips();
    this.fillMountedIfIdle();
  } catch (e) {
    this.rangeLoaded = false; // allow a later retry
  }
};

PageNotes.flushDirty = async function () {
  const pages = Object.keys(this.cache).filter((p) => this.cache[p] && this.cache[p].dirty);
  for (const p of pages) {
    await this.saveNote(parseInt(p, 10), { silent: true });
  }
};

PageNotes.saveNote = async function (page, opts) {
  const entry = this.cache[page];
  if (!entry) return;
  const snapshot = entry.note || '';
  const options = opts || {};

  if (!options.silent) this.setStatus(page, 'saving');

  try {
    const res = await API.call('notes/save_page_notes.php', {
      method: 'POST',
      body: { page_number: page, note: snapshot },
      redirectOn401: false,
    });

    if (res && res.available === false) {
      entry.dirty = true;
      if (!options.silent) this.setStatus(page, 'local');
    } else {
      entry.dirty = false;
      entry.updated_at = (res && res.updated_at) || null;
      if (!options.silent) this.setStatus(page, 'saved');
    }
  } catch (e) {
    // Network / server hiccup: keep the edit locally and retry later.
    entry.dirty = true;
    if (!options.silent) this.setStatus(page, 'local');
  }

  this.persistLocal();
  this.decorateChips();
};

/* ---------------- Status + chips ---------------- */

PageNotes.statusText = function (key) {
  switch (key) {
    case 'saving':
      return pnStatic('pn_saving', 'جارٍ الحفظ…');
    case 'local':
      return pnStatic('pn_local_only', 'محفوظ على هذا الجهاز فقط');
    case 'saved':
    default:
      return pnStatic('pn_saved', 'تم الحفظ ✓');
  }
};

PageNotes.setStatus = function (page, key) {
  this.statusKey = key;
  if (this.mountedPage !== page) return;
  const el = document.getElementById('pn-status');
  if (!el) return;
  el.textContent = this.statusText(key);
  el.dataset.state = key;
};

PageNotes.decorateChips = function () {
  const chips = document.querySelectorAll('.page-chip');
  if (!chips.length) return;
  chips.forEach((chip) => {
    const page = parseInt(chip.dataset.page, 10);
    const entry = this.cache[page];
    const has = !!(entry && entry.note && entry.note.trim());
    chip.classList.toggle('has-note', has);
    if (has) {
      chip.title = pnStatic('pn_chip_title', 'تحتوي هذه الصفحة على ملاحظة');
    } else if (chip.title) {
      chip.removeAttribute('title');
    }
  });
};

/* ---------------- Mount ---------------- */

PageNotes.mount = function (page, taskType) {
  const root = document.getElementById('page-notes-root');
  if (!root) return;

  this.stopAudio();
  this.mountedPage = page;
  this.drill = null;

  const entry = this.cache[page] || { note: '', updated_at: null, dirty: false };
  if (!this.cache[page]) {
    this.cache[page] = entry;
  }

  const isCollapsed = this.collapsed;
  const anchorsLabel = pnStatic('pn_anchors_label', 'رؤوس الآيات');
  const anchorsHint = pnStatic(
    'pn_anchors_hint',
    'اضغط لإضافة بداية الآية إلى ملاحظتك، أو شغّل التلاوة'
  );
  const longPressHint = pnStatic('pn_long_press_hint', 'اضغط مطولاً على أي آية لتسجيل خطأ عليها');
  const cuesLabel = pnStatic('pn_cues_label', 'أخطاؤك على هذه الصفحة');
  const noteLabel = pnStatic('pn_note_label', 'ملاحظتك المساعدة');
  const placeholder = pnStatic(
    'pn_placeholder',
    'اكتب هنا ما يعينك على سرعة التذكر: بدايات الآيات، كلمات مفتاحية، روابط بين المواضع…'
  );
  const clearLabel = pnStatic('pn_clear', 'مسح');
  const hideLabel = pnStatic('pn_hide', 'إخفاء (اختبر نفسك)');
  const copyLabel = pnStatic('pn_copy', 'نسخ');
  const autoLabel = pnStatic('pn_hint_autosave', 'يُحفظ تلقائياً');

  root.innerHTML = `
    <div class="pn-card ${isCollapsed ? 'is-collapsed' : ''}" id="pn-card">
      <div class="pn-head">
        <button type="button" class="pn-toggle" id="pn-toggle" aria-expanded="${isCollapsed ? 'false' : 'true'}">
          <span class="pn-title">🗒️ ${pnEsc(pnStatic('pn_title', 'بطاقة تثبيت الصفحة'))}</span>
          <span class="pn-status" id="pn-status" data-state="${this.statusKey}">${pnEsc(
            this.statusText(this.statusKey)
          )}</span>
          <span class="pn-chevron" aria-hidden="true">▾</span>
        </button>
      </div>

      <div class="pn-body" id="pn-body">
        <div class="pn-section">
          <div class="pn-section-head">
            <span class="pn-section-title">🔗 ${pnEsc(anchorsLabel)}</span>
            <span class="pn-section-tools">
              <button type="button" class="pn-mini pn-drill-start" id="pn-drill-start">🎯 ${pnEsc(
                pnStatic('pn_drill_start', 'اختبر الانتقالات')
              )}</button>
              <button type="button" class="pn-mini pn-play-page" id="pn-play-page">▶ ${pnEsc(
                pnStatic('pn_play_page', 'تشغيل الصفحة')
              )}</button>
              <button type="button" class="pn-mini" id="pn-anchors-toggle" aria-pressed="true">${pnEsc(
                pnStatic('pn_toggle', 'إخفاء')
              )}</button>
            </span>
          </div>
          <p class="pn-section-hint">${pnEsc(anchorsHint)} · <span class="pn-hint-strong">${pnEsc(
            longPressHint
          )}</span></p>
          <div class="pn-anchors" id="pn-anchors">
            <span class="pn-loading">…</span>
          </div>
        </div>

        <div class="pn-section hidden" id="pn-drill-section">
          <div class="pn-section-head">
            <span class="pn-section-title">🎯 ${pnEsc(
              pnStatic('pn_drill_title', 'اختبر انتقالات الصفحة')
            )}</span>
            <span class="pn-drill-score" id="pn-drill-score"></span>
          </div>
          <div class="pn-drill" id="pn-drill"></div>
        </div>

        <div class="pn-section hidden" id="pn-cues-section">
          <div class="pn-section-head">
            <span class="pn-section-title">🎯 ${pnEsc(cuesLabel)}</span>
          </div>
          <div class="pn-cues" id="pn-cues"></div>
        </div>

        <div class="pn-section">
          <div class="pn-section-head">
            <span class="pn-section-title">✍️ ${pnEsc(noteLabel)}</span>
            <button type="button" class="pn-mini" id="pn-clear">${pnEsc(clearLabel)}</button>
          </div>
          <textarea id="pn-note" class="pn-textarea" rows="3" dir="auto"
            placeholder="${pnEsc(placeholder)}" maxlength="20000"></textarea>
        </div>

        <div class="pn-foot">
          <button type="button" class="pn-btn" id="pn-hide">👁️ ${pnEsc(hideLabel)}</button>
          <button type="button" class="pn-btn" id="pn-copy">📋 ${pnEsc(copyLabel)}</button>
          <button type="button" class="pn-btn" id="pn-export">🖨️ ${pnEsc(
            pnStatic('pn_export', 'طباعة / PDF')
          )}</button>
          <span class="pn-hint">${pnEsc(autoLabel)}</span>
        </div>
      </div>
    </div>
  `;

  const textarea = document.getElementById('pn-note');
  if (textarea) {
    textarea.value = entry.note || '';
    textarea.addEventListener('input', () => this.onNoteInput(page));
  }

  this.wireBoard(page);
  this.renderAnchors(page);
  this.renderCues(page);
  this.setStatus(page, entry.dirty ? 'local' : 'saved');
};

PageNotes.wireBoard = function (page) {
  const toggle = document.getElementById('pn-toggle');
  const card = document.getElementById('pn-card');
  if (toggle && card) {
    toggle.addEventListener('click', () => {
      const collapsed = card.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      this.setCollapsed(collapsed);
    });
  }

  const anchorsToggle = document.getElementById('pn-anchors-toggle');
  const anchorsBox = document.getElementById('pn-anchors');
  if (anchorsToggle && anchorsBox) {
    anchorsToggle.addEventListener('click', () => {
      const hidden = anchorsBox.classList.toggle('is-hidden');
      anchorsToggle.textContent = hidden
        ? pnStatic('pn_show', 'إظهار')
        : pnStatic('pn_toggle', 'إخفاء');
      anchorsToggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    });
  }

  const playPageBtn = document.getElementById('pn-play-page');
  if (playPageBtn) {
    playPageBtn.addEventListener('click', () => this.playPage(playPageBtn));
  }

  const drillBtn = document.getElementById('pn-drill-start');
  if (drillBtn) {
    drillBtn.addEventListener('click', () => this.startDrill(page));
  }

  const clearBtn = document.getElementById('pn-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const textarea = document.getElementById('pn-note');
      if (!textarea) return;
      if (textarea.value.trim() && !window.confirm(pnStatic('pn_clear_confirm', 'مسح ملاحظة هذه الصفحة؟'))) {
        return;
      }
      textarea.value = '';
      this.onNoteInput(page, true);
    });
  }

  const hideBtn = document.getElementById('pn-hide');
  if (hideBtn) {
    hideBtn.addEventListener('click', () => {
      const textarea = document.getElementById('pn-note');
      if (!textarea) return;
      const hidden = textarea.classList.toggle('is-blurred');
      hideBtn.classList.toggle('is-active', hidden);
      hideBtn.innerHTML = hidden
        ? '👁️ ' + pnEsc(pnStatic('pn_show_note', 'إظهار الملاحظة'))
        : '👁️ ' + pnEsc(pnStatic('pn_hide', 'إخفاء (اختبر نفسك)'));
    });
  }

  const copyBtn = document.getElementById('pn-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const textarea = document.getElementById('pn-note');
      const value = textarea ? textarea.value : '';
      if (!value.trim()) return;
      try {
        await navigator.clipboard.writeText(value);
        copyBtn.classList.add('is-done');
        setTimeout(() => copyBtn.classList.remove('is-done'), 1200);
      } catch (e) {
        if (textarea) { textarea.select(); document.execCommand('copy'); }
      }
    });
  }

  const exportBtn = document.getElementById('pn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => this.exportPage(page));
  }
};

PageNotes.onNoteInput = function (page, immediate) {
  const textarea = document.getElementById('pn-note');
  if (!textarea) return;

  const entry = this.cache[page] || (this.cache[page] = { note: '', updated_at: null, dirty: false });
  entry.note = textarea.value;
  entry.dirty = true;
  this.persistLocal();
  this.decorateChips();
  this.setStatus(page, 'saving');

  if (this.saveTimer) clearTimeout(this.saveTimer);
  this.saveTimer = setTimeout(() => this.saveNote(page), immediate ? 0 : 900);
};

PageNotes.fillMountedIfIdle = function () {
  const page = this.mountedPage;
  if (!page) return;
  const textarea = document.getElementById('pn-note');
  if (!textarea || document.activeElement === textarea) return;
  const entry = this.cache[page];
  if (!entry) return;
  const next = entry.note || '';
  if (textarea.value !== next) textarea.value = next;
};

/* ---------------- Anchors ---------------- */

PageNotes.renderAnchors = async function (page) {
  const box = document.getElementById('pn-anchors');
  if (!box) return;

  await this.loadQuran();

  if (typeof getPageVerseSections !== 'function') {
    box.innerHTML = '';
    return;
  }

  const sections = getPageVerseSections(page) || [];
  const parts = [];
  let count = 0;

  for (const sec of sections) {
    for (let ayah = sec.fromAyah; ayah <= sec.toAyah && count < 60; ayah++) {
      const text = this.firstWords(sec.surahId, ayah, 4);
      if (!text) continue;
      count++;
      parts.push(`
        <div class="pn-anchor" data-surah="${sec.surahId}" data-ayah="${ayah}">
          <button type="button" class="pn-anchor-add" data-surah="${sec.surahId}" data-ayah="${ayah}"
            title="${pnEsc(pnSurahName(sec.surahId))} — ${pnEsc(
              pnStatic('pn_insert', 'أضف بداية الآية')
            )} (${pnEsc(pnStatic('pn_long_press_short', 'اضغط مطولاً لخطأ'))})">
            <span class="pn-anchor-ref">${sec.surahId}:${ayah}</span>
            <span class="pn-anchor-txt">${pnEsc(text)}…</span>
          </button>
          <button type="button" class="pn-anchor-play" data-surah="${sec.surahId}" data-ayah="${ayah}"
            title="${pnEsc(pnStatic('pn_play', 'تشغيل التلاوة'))}" aria-label="${pnEsc(
              pnStatic('pn_play', 'تشغيل التلاوة')
            )}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button type="button" class="pn-anchor-link" data-surah="${sec.surahId}" data-ayah="${ayah}"
            title="${pnEsc(pnStatic('pn_link_title', 'سجّل خطأ الانتقال للآية التالية'))}"
            aria-label="${pnEsc(pnStatic('pn_link_title', 'سجّل خطأ الانتقال للآية التالية'))}">🔗</button>
        </div>
      `);
    }
  }

  box.innerHTML = parts.length
    ? parts.join('')
    : `<span class="pn-loading">${pnEsc(pnStatic('pn_no_verses', 'لا توجد آيات في هذه الصفحة'))}</span>`;

  box.querySelectorAll('.pn-anchor-add').forEach((btn) => {
    const surah = parseInt(btn.dataset.surah, 10);
    const ayah = parseInt(btn.dataset.ayah, 10);
    this.bindAnchorPress(btn, surah, ayah);
  });

  box.querySelectorAll('.pn-anchor-play').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playAyah(parseInt(btn.dataset.surah, 10), parseInt(btn.dataset.ayah, 10));
    });
  });

  box.querySelectorAll('.pn-anchor-link').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.logMistake(
        parseInt(btn.dataset.surah, 10),
        parseInt(btn.dataset.ayah, 10),
        'TRANSITION_FAILURE'
      );
    });
  });
};

/**
 * Tap = insert the opening into the note.
 * Long-press (or right-click) = open the mistake log pre-filled with this ayah.
 */
PageNotes.bindAnchorPress = function (btn, surah, ayah) {
  let timer = null;
  let longPressed = false;

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return; // primary button / touch only
    longPressed = false;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      longPressed = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }
      this.logMistake(surah, ayah);
    }, 550);
  });

  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((evt) => {
    btn.addEventListener(evt, clearTimer);
  });

  btn.addEventListener('click', (e) => {
    if (longPressed) {
      longPressed = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const text = this.firstWords(surah, ayah, 4) + '…';
    this.insertIntoNote(text);
  });

  // Desktop convenience: right-click logs a mistake.
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    this.logMistake(surah, ayah);
  });
};

PageNotes.logMistake = function (surah, ayah, mistakeType) {
  this.stopAudio();
  const page = this.mountedPage;
  if (typeof openMistakeModalForAyah === 'function') {
    openMistakeModalForAyah(page, surah, ayah, mistakeType);
  } else if (typeof openMistakeModal === 'function') {
    openMistakeModal(page);
  }
};

/* ---------------- Audio: single ayah + whole page ---------------- */

PageNotes.playAyah = function (surah, ayah) {
  const key = surah + ':' + ayah;
  if (this.playingKey === key && this.audio) {
    this.stopAudio();
    return;
  }
  this.playSequence([{ surah, ayah }], 0);
};

PageNotes.playPage = function (btn) {
  // Tapping again while the whole page is playing stops it.
  if (this.seq && this.seq.length > 1 && this.audio) {
    this.stopAudio();
    return;
  }

  const nodes = Array.from(document.querySelectorAll('#pn-anchors .pn-anchor-add'));
  const seq = nodes
    .map((n) => ({ surah: parseInt(n.dataset.surah, 10), ayah: parseInt(n.dataset.ayah, 10) }))
    .filter((x) => Number.isFinite(x.surah) && Number.isFinite(x.ayah));
  if (!seq.length) return;

  // Start first: playSequence() calls stopAudio(), which resets the button
  // label — so set the "playing" label afterwards.
  this.playSequence(seq, 0);
  this.setPlayPageLabel(btn, true);
};

PageNotes.setPlayPageLabel = function (btn, playing) {
  const el = btn || document.getElementById('pn-play-page');
  if (!el) return;
  el.classList.toggle('is-active', !!playing);
  el.innerHTML = playing
    ? '⏸ ' + pnEsc(pnStatic('pn_stop_page', 'إيقاف'))
    : '▶ ' + pnEsc(pnStatic('pn_play_page', 'تشغيل الصفحة'));
};

PageNotes.playSequence = function (seq, idx) {
  this.stopAudio();
  this.seq = seq;
  this.seqIdx = idx || 0;
  this.playSeqItem();
};

PageNotes.playSeqItem = function () {
  const item = this.seq && this.seq[this.seqIdx];
  if (!item) {
    this.stopAudio();
    return;
  }

  const { surah, ayah } = item;
  const key = surah + ':' + ayah;
  this.playingKey = key;

  const container = document.querySelector('.pn-anchor[data-surah="' + surah + '"][data-ayah="' + ayah + '"]');
  if (container) {
    container.classList.add('is-playing');
    try { container.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }

  let audio;
  try {
    audio = new Audio(pnRecitationUrl(surah, ayah));
  } catch (e) {
    this.advanceSequence();
    return;
  }
  this.audio = audio;

  const finish = (advance) => {
    if (container) container.classList.remove('is-playing');
    if (this.audio !== audio) return;
    this.audio = null;
    if (advance) {
      this.advanceSequence();
    } else {
      this.stopAudio();
    }
  };

  audio.addEventListener('ended', () => finish(true));
  audio.addEventListener('error', () => {
    // A missing file should not stall the whole page.
    finish(true);
  });

  audio.play().catch(() => finish(true));
};

PageNotes.advanceSequence = function () {
  if (!this.seq) return;
  this.seqIdx += 1;
  if (this.seqIdx >= this.seq.length) {
    this.stopAudio();
    return;
  }
  this.playSeqItem();
};

PageNotes.stopAudio = function () {
  if (this.audio) {
    try {
      this.audio.onended = null;
      this.audio.pause();
    } catch (e) {}
    this.audio = null;
  }
  this.seq = null;
  this.seqIdx = -1;
  this.playingKey = null;
  document.querySelectorAll('.pn-anchor.is-playing').forEach((n) => n.classList.remove('is-playing'));
  this.setPlayPageLabel(null, false);
};

/* ---------------- Note editing ---------------- */

PageNotes.insertIntoNote = function (text) {
  const textarea = document.getElementById('pn-note');
  if (!textarea) return;

  // A textarea reports selectionStart = 0 while unfocused, which would wrongly
  // drop the anchor at the very top. Only honour the caret when it is focused.
  let start;
  let end;
  if (document.activeElement === textarea && typeof textarea.selectionStart === 'number') {
    start = textarea.selectionStart;
    end = textarea.selectionEnd;
  } else {
    start = textarea.value.length;
    end = textarea.value.length;
  }

  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const needsSpace = before && !/\s$/.test(before);
  const insert = (needsSpace ? ' ' : '') + text + ' ';
  textarea.value = before + insert + after;
  const pos = (before + insert).length;
  try { textarea.setSelectionRange(pos, pos); } catch (e) {}
  textarea.focus();
  this.onNoteInput(this.mountedPage);
};

/* ---------------- Cues (this page's mistakes) ---------------- */

PageNotes.renderCues = function (page) {
  const section = document.getElementById('pn-cues-section');
  const box = document.getElementById('pn-cues');
  if (!section || !box) return;

  const history = (this.ctx && this.ctx.history) || [];
  const cues = history.filter((m) => Number(m.page_number) === Number(page));
  if (!cues.length) {
    section.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');

  // Most-repeated / most-severe first.
  cues.sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0) || (b.severity || 0) - (a.severity || 0));

  const addLabel = pnStatic('pn_add_to_note', 'أضف للبطاقة');
  box.innerHTML = cues.map((m) => {
    const surah = Number(m.surah_number);
    const ayah = Number(m.ayah_number);
    const typeLabel = (window.I18N && I18N.getMistakeLabel)
      ? I18N.getMistakeLabel(m.mistake_type)
      : m.mistake_type;
    const sev = Number(m.severity) || 1;
    const sevLabel = (window.I18N && typeof I18N.t === 'function')
      ? I18N.t(sev >= 3 ? 'sev_severe' : (sev === 2 ? 'sev_medium' : 'sev_light'))
      : '';
    const note = (m.notes || '').trim();
    const occ = Number(m.occurrence_count) || 1;
    const linkS = Number(m.confused_with_surah) || null;
    const linkA = Number(m.confused_with_ayah) || null;
    const linkLine = (linkS && linkA)
      ? `<p class="pn-cue-link">🔗 ${pnEsc(pnStatic('pn_cue_link', 'ثم'))}: ${pnEsc(
          pnSurahName(linkS)
        )}:${linkA}</p>`
      : '';
    return `
      <div class="pn-cue" data-surah="${surah}" data-ayah="${ayah}">
        <div class="pn-cue-top">
          <span class="pn-cue-ref">${pnEsc(pnSurahName(surah))}:${ayah}</span>
          <span class="pn-cue-type">${pnEsc(typeLabel)}</span>
          <span class="pn-cue-sev sev-${sev}" title="${pnEsc(sevLabel)}">${'•'.repeat(sev)}</span>
          ${occ > 1 ? `<span class="pn-cue-occ">×${occ}</span>` : ''}
          <button type="button" class="pn-cue-add" data-surah="${surah}" data-ayah="${ayah}">＋ ${pnEsc(addLabel)}</button>
        </div>
        ${linkLine}
        ${note ? `<p class="pn-cue-note">${pnEsc(note)}</p>` : ''}
      </div>
    `;
  }).join('');

  box.querySelectorAll('.pn-cue-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const surah = parseInt(btn.dataset.surah, 10);
      const ayah = parseInt(btn.dataset.ayah, 10);
      const text = this.firstWords(surah, ayah, 4);
      const label = '[' + surah + ':' + ayah + ']';
      this.insertIntoNote(text ? label + ' ' + text + '…' : label);
    });
  });
};

/* ---------------- Transition drill ---------------- */

PageNotes.buildDrillList = function (page) {
  if (typeof getPageVerseSections !== 'function') return [];
  const sections = getPageVerseSections(page) || [];
  const list = [];
  for (const sec of sections) {
    for (let a = sec.fromAyah; a <= sec.toAyah && list.length < 60; a++) {
      const b = this.nextRef(sec.surahId, a);
      if (!b) continue;
      // Only drill boundaries whose next verse we actually have text for.
      if (!this.ayahText(b.surah, b.ayah)) continue;
      list.push({ a: { surah: sec.surahId, ayah: a }, b });
    }
  }
  return list;
};

PageNotes.startDrill = async function (page) {
  const section = document.getElementById('pn-drill-section');
  const box = document.getElementById('pn-drill');
  if (!section || !box) return;

  await this.loadQuran();
  const list = this.buildDrillList(page);
  if (!list.length) {
    if (typeof showToast === 'function') {
      showToast(pnStatic('pn_drill_empty', 'لا توجد انتقالات في هذه الصفحة'), true);
    }
    section.classList.add('hidden');
    return;
  }

  this.stopAudio();
  this.drill = { list, idx: 0, ok: 0, missed: 0, logged: 0 };
  section.classList.remove('hidden');
  this.renderDrillStep();
  try { section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
};

PageNotes.renderDrillStep = function () {
  const d = this.drill;
  const box = document.getElementById('pn-drill');
  const score = document.getElementById('pn-drill-score');
  if (!box || !d) return;

  if (d.idx >= d.list.length) {
    if (score) score.textContent = '';
    const pct = Math.round((d.ok / d.list.length) * 100);
    let loggedMsg = '';
    if (d.logged) {
      loggedMsg = pnT('pn_drill_logged', { count: d.logged }, '');
      if (!loggedMsg) loggedMsg = 'سُجّل ' + d.logged + ' خطأ انتقال';
    }
    box.innerHTML = `
      <div class="pn-drill-summary">
        <div class="pn-drill-big">${d.ok} / ${d.list.length}</div>
        <div class="pn-drill-sub">${pnEsc(pnStatic('pn_drill_summary', 'انتقالات سليمة'))} · ${pct}%</div>
        ${loggedMsg ? `<div class="pn-drill-logged">${pnEsc(loggedMsg)}</div>` : ''}
        <div class="pn-drill-actions">
          <button type="button" class="pn-btn" id="pn-drill-restart">↻ ${pnEsc(
            pnStatic('pn_drill_retry', 'أعد المحاولة')
          )}</button>
          <button type="button" class="pn-btn" id="pn-drill-close">${pnEsc(
            pnStatic('pn_drill_close', 'إغلاق')
          )}</button>
        </div>
      </div>`;
    const restart = document.getElementById('pn-drill-restart');
    if (restart) restart.addEventListener('click', () => this.startDrill(this.mountedPage));
    const close = document.getElementById('pn-drill-close');
    if (close) close.addEventListener('click', () => this.closeDrill());
    return;
  }

  const item = d.list[d.idx];
  if (score) score.textContent = (d.idx + 1) + ' / ' + d.list.length;

  box.innerHTML = `
    <div class="pn-drill-card">
      <div class="pn-drill-row">
        <span class="pn-drill-ref">${item.a.surah}:${item.a.ayah}</span>
        <span class="pn-drill-txt">…${pnEsc(this.lastWords(item.a.surah, item.a.ayah, 5))}</span>
        <button type="button" class="pn-anchor-play" id="pn-drill-play-a" title="${pnEsc(
          pnStatic('pn_play', 'تشغيل التلاوة')
        )}">▶</button>
      </div>
      <div class="pn-drill-q">${pnEsc(pnStatic('pn_drill_q', 'ما بداية الآية التالية؟'))}</div>
      <div class="pn-drill-answer hidden" id="pn-drill-answer">
        <div class="pn-drill-row">
          <span class="pn-drill-ref">${item.b.surah}:${item.b.ayah}</span>
          <span class="pn-drill-txt">${pnEsc(this.firstWords(item.b.surah, item.b.ayah, 5))}…</span>
          <button type="button" class="pn-anchor-play" id="pn-drill-play-b" title="${pnEsc(
            pnStatic('pn_play', 'تشغيل التلاوة')
          )}">▶</button>
        </div>
      </div>
    </div>
    <div class="pn-drill-actions">
      <button type="button" class="pn-btn" id="pn-drill-reveal">👁️ ${pnEsc(
        pnStatic('pn_drill_reveal', 'أظهر')
      )}</button>
      <button type="button" class="pn-btn hidden" id="pn-drill-ok">✓ ${pnEsc(
        pnStatic('pn_drill_ok', 'تذكرت')
      )}</button>
      <button type="button" class="pn-btn pn-drill-miss hidden" id="pn-drill-miss">✗ ${pnEsc(
        pnStatic('pn_drill_miss', 'نسيت')
      )}</button>
    </div>`;

  const reveal = document.getElementById('pn-drill-reveal');
  const okBtn = document.getElementById('pn-drill-ok');
  const missBtn = document.getElementById('pn-drill-miss');
  const answer = document.getElementById('pn-drill-answer');
  const playA = document.getElementById('pn-drill-play-a');
  const playB = document.getElementById('pn-drill-play-b');

  const playBtn = (el, ref) => {
    if (el) el.addEventListener('click', () => this.playAyah(ref.surah, ref.ayah));
  };
  playBtn(playA, item.a);
  playBtn(playB, item.b);

  if (reveal) {
    reveal.addEventListener('click', () => {
      if (answer) answer.classList.remove('hidden');
      reveal.classList.add('hidden');
      if (okBtn) okBtn.classList.remove('hidden');
      if (missBtn) missBtn.classList.remove('hidden');
    });
  }

  if (okBtn) {
    okBtn.addEventListener('click', () => {
      d.ok += 1;
      d.idx += 1;
      this.renderDrillStep();
    });
  }

  if (missBtn) {
    missBtn.addEventListener('click', async () => {
      d.missed += 1;
      d.idx += 1;
      const res = await this.logTransition(item.a, item.b);
      if (res) d.logged += 1;
      this.renderDrillStep();
    });
  }
};

PageNotes.closeDrill = function () {
  this.stopAudio();
  this.drill = null;
  const section = document.getElementById('pn-drill-section');
  if (section) section.classList.add('hidden');
  const box = document.getElementById('pn-drill');
  if (box) box.innerHTML = '';
  const score = document.getElementById('pn-drill-score');
  if (score) score.textContent = '';
};

/** Silently log a transition failure: at ayah A the reciter lost ayah B. */
PageNotes.logTransition = async function (a, b) {
  try {
    const res = await API.call('mistakes/record_mistake.php', {
      method: 'POST',
      body: {
        page_number: this.mountedPage,
        surah_number: a.surah,
        ayah_number: a.ayah,
        mistake_type: 'TRANSITION_FAILURE',
        severity: 2,
        confused_with_surah: b.surah,
        confused_with_ayah: b.ayah,
        source_task: document.body.dataset.taskType || null,
      },
      redirectOn401: false,
    });
    return res;
  } catch (e) {
    return null;
  }
};

/* ---------------- Print / PDF export ---------------- */

PageNotes.buildPrintable = function (page) {
  const entry = this.cache[page] || { note: '' };
  const note = (entry.note || '').trim();
  const isEnglish = !!(window.I18N && window.I18N.lang === 'en');

  const sections = (typeof getPageVerseSections === 'function') ? getPageVerseSections(page) : [];
  const range = (typeof formatPageVerseSummary === 'function')
    ? formatPageVerseSummary(page, isEnglish)
    : sections.map((s) => s.surahId + ':' + s.fromAyah + '–' + s.toAyah).join(' • ');

  let anchorsHtml = '';
  sections.forEach((sec) => {
    for (let a = sec.fromAyah; a <= sec.toAyah; a++) {
      const t = this.firstWords(sec.surahId, a, 8);
      if (!t) continue;
      anchorsHtml += `<li><span class="ref">${sec.surahId}:${a}</span><span class="txt">${pnEsc(t)}</span></li>`;
    }
  });

  const history = (this.ctx && this.ctx.history) || [];
  const cues = history.filter((m) => Number(m.page_number) === Number(page));
  let cuesHtml = '';
  if (cues.length) {
    cuesHtml = '<ul>' + cues.map((m) => {
      const tl = (window.I18N && I18N.getMistakeLabel) ? I18N.getMistakeLabel(m.mistake_type) : m.mistake_type;
      const extra = (m.notes || '').trim();
      const linkS = Number(m.confused_with_surah) || 0;
      const linkA = Number(m.confused_with_ayah) || 0;
      const link = (linkS && linkA) ? ' 🔗 ' + linkS + ':' + linkA : '';
      return `<li><span class="ref">${m.surah_number}:${m.ayah_number}</span><span class="txt"><b>${pnEsc(
        tl
      )}</b>${link}${extra ? ' — ' + pnEsc(extra) : ''}</span></li>`;
    }).join('') + '</ul>';
  }

  const title = pnStatic('pn_export_title', 'رفيق الحفظ — خريطة صفحة');
  const dateStr = new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'ar-EG');

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${pnEsc(title)} ${page}</title>
<style>
  @page { margin: 14mm; }
  body { font-family: 'Cairo','Amiri','Traditional Arabic',system-ui,sans-serif; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  .meta { color: #555; font-size: 10pt; margin-bottom: 14pt; }
  h2 { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
  .note { white-space: pre-wrap; font-size: 13pt; line-height: 2; border: 1px solid #ddd; border-radius: 8px; padding: 10pt; min-height: 60pt; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 8pt; padding: 3pt 0; border-bottom: 1px dotted #eee; font-size: 12pt; }
  .ref { font-weight: 800; color: #0f766e; min-width: 46pt; flex-shrink: 0; }
  .txt { font-family: 'Amiri','Traditional Arabic',serif; }
  .foot { margin-top: 18pt; font-size: 9pt; color: #888; }
</style></head><body>
<h1>${pnEsc(title)} ${page}</h1>
<div class="meta">${pnEsc(range)}<br>${pnEsc(pnStatic('pn_export_date', 'التاريخ'))}: ${pnEsc(dateStr)}</div>
<h2>${pnEsc(pnStatic('pn_export_note', 'ملاحظاتي'))}</h2>
<div class="note">${note ? pnEsc(note) : '—'}</div>
<h2>${pnEsc(pnStatic('pn_export_anchors', 'رؤوس الآيات'))}</h2>
<ul>${anchorsHtml || '<li><span class="txt">—</span></li>'}</ul>
${cuesHtml ? '<h2>' + pnEsc(pnStatic('pn_export_mistakes', 'أخطائي على هذه الصفحة')) + '</h2>' + cuesHtml : ''}
<div class="foot">${pnEsc(pnStatic('brand_name', 'رفيق الحفظ'))}</div>
</body></html>`;
};

PageNotes.exportPage = function (page) {
  const html = this.buildPrintable(page);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  let doc;
  try {
    doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  } catch (e) {
    iframe.remove();
    if (typeof showToast === 'function') {
      showToast(pnStatic('pn_export_error', 'تعذر تجهيز الطباعة'), true);
    }
    return;
  }

  const cleanup = () => setTimeout(() => iframe.remove(), 800);
  try { iframe.contentWindow.onafterprint = cleanup; } catch (e) {}

  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      cleanup();
    }
  }, 350);

  // Safety net in case onafterprint never fires.
  setTimeout(cleanup, 60000);
};

/* ---------------- Public entry points (called from app.js) ---------------- */

window.PageNotes = PageNotes;
