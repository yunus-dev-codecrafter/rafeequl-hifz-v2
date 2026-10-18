'use strict';

/* ==========================================================================
   Rafeequl Hifz — Page Recall Board ("بطاقة تثبيت الصفحة")

   A per-page memory aid that lives on the recitation stage:

     • Verse anchors (رؤوس الآيات): the opening words of every ayah on the
       page, pulled from the offline Uthmani bundle. Tap to drop into the note,
       or play the ayah's recitation. This is the classic "page map" that
       chains recall from one ayah to the next.
     • Your mistakes on this page, surfaced as ready-made "focus here" cues.
     • A free-form note that autosaves (server-backed, with an offline
       localStorage copy that syncs back when the server is reachable again).

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
  playingKey: null,
  statusKey: 'saved',
  collapsed: false,
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
      return pnT('pn_saving', null, 'جارٍ الحفظ…');
    case 'local':
      return pnT('pn_local_only', null, 'محفوظ على هذا الجهاز فقط');
    case 'saved':
    default:
      return pnT('pn_saved', null, 'تم الحفظ ✓');
  }
};

PageNotes.setStatus = function (page, key) {
  this.statusKey = key;
  if (this.mountedPage !== page) return;
  const el = document.getElementById('pn-status');
  if (!el) return;
  el.textContent = key === 'saving' ? this.statusText('saving') : this.statusText(key);
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
      chip.title = pnT('pn_chip_title', null, 'تحتوي هذه الصفحة على ملاحظة');
    } else if (chip.title) {
      chip.removeAttribute('title');
    }
  });
};

/* ---------------- Mount ---------------- */

PageNotes.mount = function (page, taskType) {
  const root = document.getElementById('page-notes-root');
  if (!root) return;

  this.mountedPage = page;

  const entry = this.cache[page] || { note: '', updated_at: null, dirty: false };
  if (!this.cache[page]) {
    this.cache[page] = entry;
  }

  const isCollapsed = this.collapsed;
  const anchorsLabel = pnT('pn_anchors_label', null, 'رؤوس الآيات');
  const anchorsHint = pnT('pn_anchors_hint', null, 'اضغط لإضافة بداية الآية إلى ملاحظتك، أو شغّل التلاوة');
  const cuesLabel = pnT('pn_cues_label', null, 'أخطاؤك على هذه الصفحة');
  const noteLabel = pnT('pn_note_label', null, 'ملاحظتك المساعدة');
  const placeholder = pnT(
    'pn_placeholder',
    null,
    'اكتب هنا ما يعينك على سرعة التذكر: بدايات الآيات، كلمات مفتاحية، روابط بين المواضع…'
  );
  const clearLabel = pnT('pn_clear', null, 'مسح');
  const hideLabel = pnT('pn_hide', null, 'إخفاء (اختبر نفسك)');
  const copyLabel = pnT('pn_copy', null, 'نسخ');
  const autoLabel = pnT('pn_hint_autosave', null, 'يُحفظ تلقائياً');

  root.innerHTML = `
    <div class="pn-card ${isCollapsed ? 'is-collapsed' : ''}" id="pn-card">
      <div class="pn-head">
        <button type="button" class="pn-toggle" id="pn-toggle" aria-expanded="${isCollapsed ? 'false' : 'true'}">
          <span class="pn-title">🗒️ ${pnEsc(pnT('pn_title', null, 'بطاقة تثبيت الصفحة'))}</span>
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
            <button type="button" class="pn-mini" id="pn-anchors-toggle" aria-pressed="true">${pnEsc(
              pnT('pn_toggle', null, 'إخفاء')
            )}</button>
          </div>
          <p class="pn-section-hint">${pnEsc(anchorsHint)}</p>
          <div class="pn-anchors" id="pn-anchors">
            <span class="pn-loading">…</span>
          </div>
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
        ? pnT('pn_show', null, 'إظهار')
        : pnT('pn_toggle', null, 'إخفاء');
      anchorsToggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    });
  }

  const clearBtn = document.getElementById('pn-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const textarea = document.getElementById('pn-note');
      if (!textarea) return;
      if (textarea.value.trim() && !window.confirm(pnT('pn_clear_confirm', null, 'مسح ملاحظة هذه الصفحة؟'))) {
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
        ? '👁️ ' + pnEsc(pnT('pn_show_note', null, 'إظهار الملاحظة'))
        : '👁️ ' + pnEsc(pnT('pn_hide', null, 'إخفاء (اختبر نفسك)'));
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
        <div class="pn-anchor">
          <button type="button" class="pn-anchor-add" data-surah="${sec.surahId}" data-ayah="${ayah}"
            title="${pnEsc(pnSurahName(sec.surahId))} — ${pnEsc(pnT('pn_insert', null, 'أضف بداية الآية'))}">
            <span class="pn-anchor-ref">${sec.surahId}:${ayah}</span>
            <span class="pn-anchor-txt">${pnEsc(text)}…</span>
          </button>
          <button type="button" class="pn-anchor-play" data-surah="${sec.surahId}" data-ayah="${ayah}"
            title="${pnEsc(pnT('pn_play', null, 'تشغيل التلاوة'))}" aria-label="${pnEsc(
              pnT('pn_play', null, 'تشغيل التلاوة')
            )}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
      `);
    }
  }

  box.innerHTML = parts.length
    ? parts.join('')
    : `<span class="pn-loading">${pnEsc(pnT('pn_no_verses', null, 'لا توجد آيات في هذه الصفحة'))}</span>`;

  box.querySelectorAll('.pn-anchor-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const surah = parseInt(btn.dataset.surah, 10);
      const ayah = parseInt(btn.dataset.ayah, 10);
      const text = this.firstWords(surah, ayah, 4) + '…';
      this.insertIntoNote(text);
    });
  });

  box.querySelectorAll('.pn-anchor-play').forEach((btn) => {
    btn.addEventListener('click', () => {
      this.playAyah(parseInt(btn.dataset.surah, 10), parseInt(btn.dataset.ayah, 10), btn);
    });
  });
};

PageNotes.playAyah = function (surah, ayah, btn) {
  const key = surah + ':' + ayah;
  if (this.playingKey === key) {
    this.stopAudio();
    return;
  }
  this.stopAudio();
  try {
    const audio = new Audio(pnRecitationUrl(surah, ayah));
    this.audio = audio;
    this.playingKey = key;
    if (btn) btn.classList.add('is-playing');
    const clear = () => {
      if (this.audio === audio) {
        this.audio = null;
        this.playingKey = null;
      }
      if (btn) btn.classList.remove('is-playing');
    };
    audio.addEventListener('ended', clear);
    audio.addEventListener('error', () => {
      clear();
      if (typeof showToast === 'function') {
        showToast(pnT('pn_audio_error', null, 'تعذر تشغيل التلاوة الآن'), true);
      }
    });
    audio.play().catch(() => clear());
  } catch (e) {}
};

PageNotes.stopAudio = function () {
  if (this.audio) {
    try { this.audio.pause(); } catch (e) {}
    this.audio = null;
  }
  this.playingKey = null;
  document.querySelectorAll('.pn-anchor-play.is-playing').forEach((b) => b.classList.remove('is-playing'));
};

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

  const addLabel = pnT('pn_add_to_note', null, 'أضف للبطاقة');
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
    return `
      <div class="pn-cue" data-surah="${surah}" data-ayah="${ayah}">
        <div class="pn-cue-top">
          <span class="pn-cue-ref">${pnEsc(pnSurahName(surah))}:${ayah}</span>
          <span class="pn-cue-type">${pnEsc(typeLabel)}</span>
          <span class="pn-cue-sev sev-${sev}" title="${pnEsc(sevLabel)}">${'•'.repeat(sev)}</span>
          ${occ > 1 ? `<span class="pn-cue-occ">×${occ}</span>` : ''}
          <button type="button" class="pn-cue-add" data-surah="${surah}" data-ayah="${ayah}">＋ ${pnEsc(addLabel)}</button>
        </div>
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
      this.insertIntoNote((text ? label + ' ' + text + '…' : label));
    });
  });
};

/* ---------------- Public entry points (called from app.js) ---------------- */

window.PageNotes = PageNotes;
