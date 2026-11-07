'use strict';

/* ==========================================================================
   Rafeequl Hifz — Rub' Consolidation exercise renderers (v13)

   Pure-ish rendering helpers for the core and advanced revision exercises. The
   session controller owns the state, persistence and answer validation; this
   module turns an item + local state into accessible RTL markup.

   The Arabic text always comes from the server plan. Nothing here invents or
   rewrites Qur'anic text.
   ========================================================================== */

(function () {
  const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  const ARABIC_TATWEEL = /\u0640/g;

  function normalizeArabic(value) {
    return String(value == null ? '' : value)
      .replace(ARABIC_MARKS, '')
      .replace(ARABIC_TATWEEL, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ء/g, '')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeStrict(value) {
    return String(value == null ? '' : value)
      .replace(ARABIC_MARKS, '')
      .replace(ARABIC_TATWEEL, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value == null ? '' : value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededShuffle(items, seed) {
    const list = Array.isArray(items) ? items.slice() : [];
    let state = (Number(seed) || 1) >>> 0;
    const rand = () => {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function wordText(word) {
    if (word && typeof word === 'object') return String(word.text == null ? '' : word.text);
    return String(word == null ? '' : word);
  }

  function wordNorm(word) {
    if (word && typeof word === 'object' && word.norm != null) return String(word.norm);
    return normalizeArabic(wordText(word));
  }

  function wordStrict(word) {
    if (word && typeof word === 'object' && word.strict != null) return String(word.strict);
    return normalizeStrict(wordText(word));
  }

  /**
   * Does a placed token answer the expected word position?
   *
   * Each occurrence has its own id and original wordIndex. Validation uses the
   * occurrence identity only: repeated Arabic words are NOT interchangeable,
   * because that would let an already-used/duplicate occurrence satisfy a
   * different slot. Decoys and similar-looking words (different letters before
   * diacritic removal) never match.
   */
  function tokenMatchesPosition(tokens, tokenId, expected) {
    const list = Array.isArray(tokens) ? tokens : [];
    const token = list.find((entry) => entry && entry.id === tokenId);
    if (!token || token.decoy || !Number.isInteger(token.wordIndex) || token.wordIndex < 0) return false;
    return token.wordIndex === expected;
  }

  function refLabel(surah, ayah, ctx) {
    const s = Number(surah) || 0;
    const a = Number(ayah) || 0;
    if (!s || !a) return '';
    if (ctx && typeof ctx.refLabel === 'function') return ctx.refLabel(s, a);
    return s + ':' + a;
  }

  function arabicBlock(text, className) {
    return '<div class="' + (className || 'rub-ex-prompt-text') + '" dir="rtl" lang="ar">' + esc(text) + '</div>';
  }

  function diffSegments(segments, prefix) {
    const list = Array.isArray(segments) ? segments : [];
    const html = list.map((segment) => {
      const text = esc(segment && segment.text != null ? segment.text : '');
      const changed = !!(segment && segment.changed);
      return '<span class="rub-diff-word' + (changed ? ' changed' : '') + '">' + text + '</span>';
    }).join(' ');
    return (prefix ? '<span class="rub-option-prefix" dir="rtl" lang="ar">' + esc(prefix) + '</span>' : '') + html;
  }

  function feedbackHtml(state, ctx, opts) {
    const options = opts || {};
    if (!state || (!state.checked && !(state.recorded && !state.practiceRetry))) return '';
    if (state.skipped) {
      return '<div class="rub-ex-feedback"><strong>' + esc(ctx.t('rub_ex_feedback_skipped', {}, 'تم تخطي هذا التمرين')) +
        '</strong><p>' + esc(ctx.t('rub_ex_feedback_skipped_note', {}, 'يمكنك إعادة التمرين في جلسة قادمة؛ لا تُحتسب الإجابة الصحيحة.')) + '</p></div>';
    }
    const correct = state.practiceRetry
      ? !!state.checkedCorrect
      : (state.recorded ? !!state.resultCorrect : !!state.checkedCorrect);
    const classes = correct ? 'is-correct' : 'is-wrong';
    const title = correct
      ? ctx.t('rub_ex_feedback_correct', {}, 'أحسنت — إجابة صحيحة')
      : ctx.t('rub_ex_feedback_wrong', {}, 'راجع الموضع ثم أعد المحاولة');
    const answer = options.answer
      ? '<div class="rub-feedback-answer" dir="rtl" lang="ar">' + esc(options.answer) + '</div>'
      : '';
    const note = options.note ? '<p>' + esc(options.note) + '</p>' : '';
    return '<div class="rub-ex-feedback ' + classes + '"><strong>' + esc(title) + '</strong>' + note + answer + '</div>';
  }

  function retryButton(ctx) {
    return '<button type="button" class="btn btn-ghost" data-rub-retry>' +
      esc(ctx.t('rub_ex_retry', {}, 'أعد المحاولة للتدريب')) +
      '</button>';
  }

  function exerciseHead(ctx, key, titleKey, fallbackTitle, subKey, fallbackSub, tag) {
    return '<div class="rub-ex-head"><div>' +
      '<span class="rub-ex-kicker">' + esc(ctx.t(key, {}, fallbackTitle)) + '</span>' +
      '<h3>' + esc(ctx.t(titleKey, {}, fallbackTitle)) + '</h3>' +
      '<p>' + esc(ctx.t(subKey, {}, fallbackSub)) + '</p>' +
      '</div>' + (tag || '') + '</div>';
  }

  /* ---------------------------------------------------------------------
   * 1. Word arrangement
   * ------------------------------------------------------------------ */
  function renderWordOrder(item, state, ctx) {
    const words = Array.isArray(item.words) ? item.words : [];
    const decoys = Array.isArray(item.decoys) ? item.decoys : [];
    const placed = Array.isArray(state.placed) ? state.placed : [];
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;

    const tokens = [];
    words.forEach((word, index) => {
      tokens.push({ id: 'w' + index, text: wordText(word), wordIndex: index, decoy: false });
    });
    decoys.forEach((word, index) => {
      tokens.push({ id: 'd' + index, text: wordText(word), wordIndex: -1, decoy: true });
    });
    const shuffled = seededShuffle(tokens, hashString(item.item_id));
    const tokenById = {};
    shuffled.forEach((token) => { tokenById[token.id] = token; });
    const placedSet = new Set(placed);

    const placedHtml = placed.map((id, index) => {
      const token = tokenById[id];
      if (!token) return '';
      return '<button type="button" class="rub-word-token is-placed" data-wo-placed="' + index + '" data-wo-pos="' + token.wordIndex + '"' +
        (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
    }).join('');

    const bankHtml = shuffled.map((token) => {
      if (placedSet.has(token.id)) return '';
      return '<button type="button" class="rub-word-token' + (token.decoy ? ' is-decoy' : '') +
        '" data-wo-token="' + esc(token.id) + '" data-wo-pos="' + token.wordIndex + '"' + (locked ? ' disabled' : '') +
        ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
    }).join('');

    const firstHint = item.hint_first && !state.recorded
      ? '<p class="rub-ex-prompt-label">' + esc(ctx.t('rub_wo_hint', {}, 'تبدأ الآية بـ:')) +
        ' <strong dir="rtl" lang="ar">' + esc(item.hint_first) + '</strong></p>'
      : '';

    const answer = revealed
      ? '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(item.text) + '</div>'
      : '<div class="rub-word-answer' + (placed.length === words.length ? ' is-full' : '') +
        '" data-wo-answer data-placeholder="' + esc(ctx.t('rub_wo_placeholder', {}, 'اضغط الكلمات بالترتيب…')) + '">' +
        placedHtml + '</div>' +
        '<div class="rub-word-bank" data-wo-bank>' + bankHtml + '</div>';

    const tools = locked
      ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
      : '<div class="rub-ex-tools">' +
        '<button type="button" class="btn btn-ghost" data-wo-undo>' + esc(ctx.t('rub_wo_undo', {}, 'تراجع')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-wo-reset>' + esc(ctx.t('rub_wo_reset', {}, 'إعادة')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-wo-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
        '</div>';

    return '<article class="rub-ex-card" data-exercise="WORD_ORDER">' +
      exerciseHead(ctx, 'rub_ex_wo_kicker', 'rub_ex_wo_title', 'ترتيب الكلمات',
        'rub_ex_wo_sub', 'رتّب كلمات الآية بالضغط عليها بالترتيب.', '') +
      '<div class="rub-ex-ref">' + (ctx.advanced ? '' : esc(refLabel(item.surah, item.ayah, ctx))) + '</div>' +
      firstHint + answer + tools +
      feedbackHtml(state, ctx, { answer: item.text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 2. Missing words
   * ------------------------------------------------------------------ */
  function renderMissingWords(item, state, ctx) {
    const words = Array.isArray(item.words) ? item.words : [];
    const hidden = new Set((Array.isArray(item.hidden) ? item.hidden : []).map(Number));
    const values = state.values && typeof state.values === 'object' ? state.values : {};
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;

    const verseHtml = words.map((word, index) => {
      const text = wordText(word);
      if (!hidden.has(index)) {
        return '<span class="rub-word">' + esc(text) + '</span>';
      }
      if (revealed) {
        return '<span class="rub-word is-missing"><strong dir="rtl" lang="ar">' + esc(text) + '</strong></span>';
      }
      const value = values[index] != null ? String(values[index]) : '';
      return '<span class="rub-blank-wrap">' +
        '<input class="rub-blank" data-mw-index="' + index + '" value="' + esc(value) + '"' +
        ' inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false"' +
        ' dir="rtl" lang="ar" aria-label="' + esc(ctx.t('rub_mw_blank', { n: index + 1 }, 'الكلمة الناقصة')) + '"' +
        (locked ? ' disabled' : '') + '>' +
        (locked ? '' : '<button type="button" class="rub-blank-clear" data-mw-clear="' + index + '" aria-label="' +
          esc(ctx.t('rub_mw_clear_one', {}, 'امسح هذه الكلمة')) + '">×</button>') +
        '</span>';
    }).join(' ');

    const bankHtml = (Array.isArray(item.word_bank) ? item.word_bank : []).map((word) => {
      return '<button type="button" class="rub-bank-word" data-mw-bank="' + esc(wordText(word)) + '"' +
        (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(wordText(word)) + '</button>';
    }).join('');

    const tools = locked
      ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
      : '<div class="rub-ex-tools">' +
        '<button type="button" class="btn btn-ghost" data-mw-reset>' + esc(ctx.t('rub_mw_reset', {}, 'امسح الكل')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-mw-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
        '</div>';

    return '<article class="rub-ex-card" data-exercise="MISSING_WORDS">' +
      exerciseHead(ctx, 'rub_ex_mw_kicker', 'rub_ex_mw_title', 'الكلمات الناقصة',
        'rub_ex_mw_sub', 'اكتب الكلمات المخفية أو اخترها من البنك.', '') +
      '<div class="rub-ex-ref">' + (ctx.advanced ? '' : esc(refLabel(item.surah, item.ayah, ctx))) + '</div>' +
      '<div class="rub-ex-verse" dir="rtl" lang="ar">' + verseHtml + '</div>' +
      (revealed || locked ? '' : '<div class="rub-bank" data-mw-bank-list>' + bankHtml + '</div>') +
      tools +
      feedbackHtml(state, ctx, { answer: item.text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 3. Continue the ayah
   * ------------------------------------------------------------------ */
  function renderContinueAyah(item, state, ctx) {
    const mode = String(item.mode || 'mcq');
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;

    if (mode === 'skip' || item.boundary_skip) {
      return '<article class="rub-ex-card" data-exercise="CONTINUE_AYAH">' +
        exerciseHead(ctx, 'rub_ex_ca_kicker', 'rub_ex_ca_title', 'أكمل الآية',
          'rub_ex_ca_sub', 'اختر الآية التالية الصحيحة.', '') +
        '<div class="rub-boundary">' +
        '<div class="rub-boundary-icon" aria-hidden="true">۞</div>' +
        '<h3>' + esc(ctx.t('rub_ca_boundary_title', {}, 'نهاية الربع')) + '</h3>' +
        '<p>' + esc(ctx.t('rub_ca_boundary_desc', {}, 'هذه آخر آية في الربع. تابع إلى التمرين التالي، أو أعد الجلسة مع السماح بآيات خارج الربع.')) + '</p>' +
        '<button type="button" class="btn btn-primary" data-ca-boundary>' +
        esc(ctx.t('rub_ca_boundary_btn', {}, 'متابعة')) + '</button>' +
        '</div></article>';
    }

    const prompt = '<div class="rub-ex-prompt">' +
      '<span class="rub-ex-prompt-label">' + esc(ctx.t('rub_ca_prompt_label', {}, 'الآية الحالية')) + '</span>' +
      arabicBlock(item.prompt_text) +
      (ctx.advanced ? '' : '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</span></div>') +
      '</div>';

    let body = '';
    if (mode === 'arrange') {
      const words = Array.isArray(item.words) ? item.words : [];
      const placed = Array.isArray(state.placed) ? state.placed : [];
      const tokens = words.map((word, index) => ({ id: 'c' + index, text: wordText(word), index }));
      const shuffled = seededShuffle(tokens, hashString(item.item_id));
      const tokenById = {};
      shuffled.forEach((token) => { tokenById[token.id] = token; });
      const placedSet = new Set(placed);

      const placedHtml = placed.map((id, index) => {
        const token = tokenById[id];
        if (!token) return '';
        return '<button type="button" class="rub-word-token is-placed" data-ca-placed="' + index + '"' +
          (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
      }).join('');

      const bankHtml = shuffled.map((token) => {
        if (placedSet.has(token.id)) return '';
        return '<button type="button" class="rub-word-token" data-ca-token="' + esc(token.id) + '"' +
          (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
      }).join('');

      body = '<div class="rub-ex-prompt-label">' + esc(ctx.t('rub_ca_arrange_label', {}, 'رتّب الآية التالية:')) + '</div>' +
        (revealed
          ? '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(item.next_ayah && item.next_ayah.text ? item.next_ayah.text : '') + '</div>'
          : '<div class="rub-word-answer' + (placed.length === words.length ? ' is-full' : '') +
            '" data-ca-answer data-placeholder="' + esc(ctx.t('rub_wo_placeholder', {}, 'اضغط الكلمات بالترتيب…')) + '">' +
            placedHtml + '</div>' +
            '<div class="rub-word-bank" data-ca-bank>' + bankHtml + '</div>') +
        (locked
          ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
          : '<div class="rub-ex-tools">' +
            '<button type="button" class="btn btn-ghost" data-ca-undo>' + esc(ctx.t('rub_wo_undo', {}, 'تراجع')) + '</button>' +
            '<button type="button" class="btn btn-ghost" data-ca-reset>' + esc(ctx.t('rub_wo_reset', {}, 'إعادة')) + '</button>' +
            '<button type="button" class="btn btn-ghost" data-ca-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
            '</div>');
    } else {
      const options = Array.isArray(item.options) ? item.options : [];
      const selected = state.selected != null ? String(state.selected) : '';
      const showMeta = !!state.checked;
      body = '<div class="rub-options" data-ca-options>' + options.map((option) => {
        const id = String(option.id || '');
        const isSelected = selected === id;
        const isCorrect = !!option.correct;
        let cls = 'rub-option';
        if (isSelected) cls += ' is-selected';
        if (showMeta && isCorrect) cls += ' is-correct';
        if (showMeta && isSelected && !isCorrect) cls += ' is-wrong';
        const ref = option.ref || '';
        const outside = !!option.outside_rub || (!!item.outside_rub && isCorrect);
        const meta = showMeta && ref
          ? '<div class="rub-option-meta"><span class="rub-option-ref' + (outside ? ' is-outside' : '') + '">' +
            esc(outside ? ctx.t('rub_outside_rub', {}, 'خارج الربع') + ' · ' + ref : ref) + '</span></div>'
          : '';
        return '<button type="button" class="' + cls + '" data-ca-option="' + esc(id) + '"' +
          (locked ? ' disabled' : '') + '>' +
          '<span class="rub-option-mark" aria-hidden="true">' + esc(id.toUpperCase()) + '</span>' +
          '<span class="rub-option-body"><span class="rub-option-text" dir="rtl" lang="ar">' +
          esc(option.text || '') + '</span>' + meta + '</span></button>';
      }).join('') + '</div>';
      if (locked) {
        body += '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>';
      }
    }

    return '<article class="rub-ex-card" data-exercise="CONTINUE_AYAH">' +
      exerciseHead(ctx, 'rub_ex_ca_kicker', 'rub_ex_ca_title', 'أكمل الآية',
        'rub_ex_ca_sub', 'اختر الآية التالية الصحيحة أو رتّب كلماتها.', '') +
      prompt + body +
      feedbackHtml(state, ctx, {
        answer: item.next_ayah && item.next_ayah.text ? item.next_ayah.text : '',
      }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 4. Similar ayat (mutashabihat)
   * ------------------------------------------------------------------ */
  function renderMutashabihat(item, state, ctx) {
    const mode = String(item.mode || 'rub_membership');
    const locked = !!state.recorded && !state.practiceRetry;
    const selected = state.selected != null ? String(state.selected) : '';
    const showMeta = !!state.checked;
    const options = Array.isArray(item.options) ? item.options : [];

    let question = '';
    let promptHtml = '';
    if (mode === 'rub_membership') {
      question = ctx.t('rub_mt_question_rub', {}, 'أي الآيتين من الربع الحالي؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_rub', {}, 'الربع الحالي')) + '</span>' +
        arabicBlock(ctx.rubLabel || '', 'rub-ex-prompt-text') + '</div>';
    } else if (mode === 'context_after') {
      question = ctx.t('rub_mt_question_after', {}, 'أي الآيتين تسبق الآية المعروضة؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_context', {}, 'الآية المعروضة')) + '</span>' +
        arabicBlock(item.prompt_text) +
        '<div class="rub-option-meta">' + (ctx.advanced ? '' : '<span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span>') + '</div></div>';
    } else if (mode === 'context_before') {
      question = ctx.t('rub_mt_question_before', {}, 'أي الآيتين تلي الآية المعروضة؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_context', {}, 'الآية المعروضة')) + '</span>' +
        arabicBlock(item.prompt_text) +
        '<div class="rub-option-meta">' + (ctx.advanced ? '' : '<span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span>') + '</div></div>';
    } else {
      question = ctx.t('rub_mt_question_continuation', {}, 'أي التكملتين الصحيحة لبداية الآية؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_prefix', {}, 'بداية الآية')) + '</span>' +
        arabicBlock(item.prompt_text) +
        '<div class="rub-option-meta">' + (ctx.advanced ? '' : '<span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span>') + '</div></div>';
    }

    const optionsHtml = '<div class="rub-options" data-mt-options>' + options.map((option) => {
      const id = String(option.id || '');
      const isSelected = selected === id;
      const isCorrect = !!option.correct;
      let cls = 'rub-option';
      if (isSelected) cls += ' is-selected';
      if (showMeta && isCorrect) cls += ' is-correct';
      if (showMeta && isSelected && !isCorrect) cls += ' is-wrong';
      const meta = [];
      if (showMeta) {
        if (option.ref) {
          meta.push('<span class="rub-option-ref' + (item.outside_rub && !isCorrect ? ' is-outside' : '') + '">' +
            esc(option.ref) + '</span>');
        }
        if (item.outside_rub && !isCorrect) {
          meta.push('<span class="rub-option-ref is-outside">' + esc(ctx.t('rub_outside_rub', {}, 'خارج الربع')) + '</span>');
        }
      }
      const text = showMeta && Array.isArray(option.segments)
        ? diffSegments(option.segments, mode === 'continuation' ? item.prompt_text : '')
        : esc(option.text || '');
      return '<button type="button" class="' + cls + '" data-mt-option="' + esc(id) + '"' +
        (locked ? ' disabled' : '') + '>' +
        '<span class="rub-option-mark" aria-hidden="true">' + esc(id.toUpperCase()) + '</span>' +
        '<span class="rub-option-body"><span class="rub-option-text" dir="rtl" lang="ar">' + text + '</span>' +
        (meta.length ? '<span class="rub-option-meta">' + meta.join('') + '</span>' : '') +
        '</span></button>';
    }).join('') + '</div>';

    const diffNote = showMeta && item.diff_count
      ? '<p class="rub-ex-prompt-label">' + esc(ctx.t('rub_mt_diff_note', { count: item.diff_count }, 'مواضع الاختلاف: {count}')) + '</p>'
      : '';

    const tools = state.recorded && !state.practiceRetry
      ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
      : '';

    return '<article class="rub-ex-card" data-exercise="MUTASHABIHAT">' +
      exerciseHead(ctx, 'rub_ex_mt_kicker', 'rub_ex_mt_title', 'الآيات المتشابهة',
        'rub_ex_mt_sub', 'ميّز الآية الصحيحة من بين آيتين متشابهتين. البيانات من قائمة موثقة فقط.',
        '<span class="rub-ex-tag' + (showMeta && item.outside_rub ? ' is-outside' : '') + '">' +
        esc(showMeta && item.outside_rub ? ctx.t('rub_outside_rub', {}, 'خارج الربع') : ctx.t('rub_mt_verified', {}, 'موثّق')) +
        '</span>') +
      '<p class="rub-ex-question">' + esc(question) + '</p>' +
      promptHtml + optionsHtml + diffNote + tools +
      feedbackHtml(state, ctx, {
        answer: item.prompt_full || '',
        note: item.outside_rub
          ? ctx.t('rub_mt_feedback_outside', {}, 'إحدى الآيتين من خارج الربع؛ وُسمت بعد الإجابة.')
          : '',
      }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 5. Progressive disappearing ayah
   * ------------------------------------------------------------------ */
  function renderProgressiveHide(item, state, ctx) {
    const words = Array.isArray(item.words) ? item.words : [];
    const order = Array.isArray(item.hide_order) ? item.hide_order.map(Number) : words.map((_, i) => i);
    const stage = Math.max(0, Math.min(5, Number(state.stage) || 0));
    const hiddenCount = Math.round((words.length * stage) / 5);
    const hidden = new Set(order.slice(0, hiddenCount));
    const revealed = !!state.reveal;
    const locked = !!state.recorded && !state.practiceRetry;

    const verseHtml = words.map((word, index) => {
      const isHidden = hidden.has(index);
      return '<span class="rub-hide-word' + (isHidden ? ' is-hidden' : '') + '"' +
        (isHidden && !revealed ? ' aria-hidden="true"' : '') +
        ' dir="rtl" lang="ar">' + esc(wordText(word)) + '</span>';
    }).join(' ');

    const stagePct = Math.round((stage / 5) * 100);
    const stageLabel = ctx.t('rub_ph_stage_label', { stage: stage, total: 5 }, 'المرحلة {stage} من {total}');

    const selfReport = locked
      ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
      : '<div class="rub-self-report">' +
        '<button type="button" class="btn btn-ghost is-good" data-ph-report="good">' +
        esc(ctx.t('rub_ph_good', {}, 'أتقنتها')) + '</button>' +
        '<button type="button" class="btn btn-ghost is-review" data-ph-report="review">' +
        esc(ctx.t('rub_ph_review', {}, 'أحتاج مراجعة')) + '</button>' +
        '</div>';

    return '<article class="rub-ex-card" data-exercise="PROGRESSIVE_HIDE">' +
      exerciseHead(ctx, 'rub_ex_ph_kicker', 'rub_ex_ph_title', 'التدرج في الإخفاء',
        'rub_ex_ph_sub', 'أخفِ الكلمات تدريجياً وسمّع الآية من حفظك، ثم قيّم نفسك.',
        '<span class="rub-ex-tag">' + (ctx.advanced ? '' : esc(refLabel(item.surah, item.ayah, ctx))) + '</span>') +
      '<div class="rub-hide-verse' + (revealed ? ' is-revealed' : '') + '" data-ph-verse dir="rtl" lang="ar">' +
      verseHtml + '</div>' +
      '<div class="rub-hide-stage">' +
      '<div class="rub-hide-stage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + stagePct + '">' +
      '<span style="width:' + stagePct + '%"></span></div>' +
      '<span class="rub-hide-stage-label">' + esc(stageLabel) + '</span></div>' +
      (stage >= 5 && !locked
        ? '<p class="rub-ex-prompt-label">' + esc(ctx.t('rub_ph_complete_hint', {}, 'أكملت إخفاء الكلمات — قيّم تسميعك الآن.')) + '</p>'
        : '') +
      (locked ? '' : '<div class="rub-ex-tools">' +
        '<button type="button" class="btn btn-ghost" data-ph-more' + (stage >= 5 ? ' disabled' : '') + '>' +
        esc(ctx.t('rub_ph_more', {}, 'اخفِ أكثر')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-ph-reveal>' +
        esc(revealed ? ctx.t('rub_ph_hide_again', {}, 'أخفِ مرة أخرى') : ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-ph-reset>' + esc(ctx.t('rub_ph_reset', {}, 'أعد من البداية')) + '</button>' +
        '</div>') +
      selfReport +
      feedbackHtml(state, ctx, { answer: item.text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 6b. Shared option list for the added challenge types
   * ------------------------------------------------------------------ */
  function renderChallengeOptions(item, state, ctx, kind) {
    const options = Array.isArray(item.options) ? item.options : [];
    const selected = state.selected != null ? String(state.selected) : '';
    const showMeta = !!state.checked;
    const locked = !!state.recorded && !state.practiceRetry;
    return '<div class="rub-options" data-' + kind + '-options>' + options.map((option) => {
      const id = String(option.id || '');
      const isSelected = selected === id;
      const isCorrect = id === String(item.correct_id || '');
      let cls = 'rub-option';
      if (isSelected) cls += ' is-selected';
      if (showMeta && isCorrect) cls += ' is-correct';
      if (showMeta && isSelected && !isCorrect) cls += ' is-wrong';
      const meta = showMeta && option.ref
        ? '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(option.ref) + '</span></div>'
        : '';
      return '<button type="button" class="' + cls + '" data-' + kind + '-option="' + esc(id) + '"' +
        (locked ? ' disabled' : '') + '>' +
        '<span class="rub-option-mark" aria-hidden="true">' + esc(id.toUpperCase()) + '</span>' +
        '<span class="rub-option-body"><span class="rub-option-text" dir="rtl" lang="ar">' +
        esc(option.text || '') + '</span>' + meta + '</span></button>';
    }).join('') + '</div>';
  }

  /* Local-only optional audio controls shared by the advanced challenges. */
  function audioControls(state, ctx, locked) {
    const recording = state.audioState === 'recording';
    const recorded = state.audioState === 'recorded';
    const starting = !!state.audioStarting;
    return '<div class="rub-rec-controls">' +
      '<button type="button" class="btn btn-ghost" data-audio-record' +
      (recording || starting || locked ? ' disabled' : '') + '>' +
      esc(ctx.t(recording ? 'rub_np_recording' : 'rub_np_record', {}, recording ? 'جارٍ التسجيل…' : 'تسجيل صوتي (اختياري)')) +
      '</button>' +
      '<button type="button" class="btn btn-ghost" data-audio-stop' + (recording ? '' : ' disabled') + '>' +
      esc(ctx.t('rub_np_stop', {}, 'أوقف التسجيل')) + '</button>' +
      '<button type="button" class="btn btn-ghost" data-audio-play' + (recorded ? '' : ' disabled') + '>' +
      esc(ctx.t('rub_np_play', {}, 'استمع للتسجيل')) + '</button>' +
      '<audio class="rub-np-audio" data-audio controls' + (recorded ? '' : ' hidden') + '></audio>' +
      '<small class="rub-rec-note">' + esc(ctx.t('rub_rec_local_note', {},
        'التسجيل اختياري ويبقى في متصفحك للمقارنة اليدوية؛ لا يُرفع ولا يُعد تحققاً آلياً.')) + '</small>' +
      '</div>';
  }

  /* ---------------------------------------------------------------------
   * 6. Sudden interruption
   * ------------------------------------------------------------------ */
  function renderInterrupt(item, state, ctx) {
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;
    const value = state.value != null ? String(state.value) : '';
    const position = String(item.stop_position || 'middle');
    const positionLabels = {
      beginning: ctx.t('rub_int_pos_beginning', {}, 'أول الآية'),
      middle: ctx.t('rub_int_pos_middle', {}, 'وسط الآية'),
      end: ctx.t('rub_int_pos_end', {}, 'آخر الآية'),
    };
    const showRef = !item.hide_reference;
    const input = revealed
      ? ''
      : '<input class="rub-typed-answer" data-int-input value="' + esc(value) + '"' +
        ' inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" dir="rtl" lang="ar"' +
        ' placeholder="' + esc(ctx.t('rub_int_placeholder', {}, 'اكتب أول الكلمات بعد التوقف…')) + '"' +
        (locked ? ' disabled' : '') + '>';
    return '<article class="rub-ex-card" data-exercise="INTERRUPT">' +
      exerciseHead(ctx, 'rub_ex_int_kicker', 'rub_ex_int_title', 'التوقف المفاجئ',
        'rub_ex_int_sub', 'توقف الاستماع/التسميع في موضع عشوائي، ثم أكمل من حيث توقف.',
        '<span class="rub-ex-tag">' + esc(positionLabels[position] || position) + '</span>') +
      '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_int_prompt', {}, 'توقف عند')) + '</span>' +
      arabicBlock(item.prompt_text) +
      (showRef
        ? '<div class="rub-option-meta"><span class="rub-option-ref">' +
          esc(item.prompt_ref || refLabel(item.surah, item.ayah, ctx)) + '</span></div>'
        : '') + '</div>' +
      '<div class="rub-interrupt-caret" aria-hidden="true">…</div>' +
      '<p class="rub-ex-prompt-label">' + esc(ctx.t('rub_int_ask', {}, 'أكمل من حيث توقف:')) + '</p>' +
      (revealed
        ? '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(item.full_text) + '</div>'
        : input) +
      (ctx.advanced ? audioControls(state, ctx, locked) : '') +
      (locked
        ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
        : '<div class="rub-ex-tools">' +
          '<button type="button" class="btn btn-ghost" data-int-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
          '</div>') +
      feedbackHtml(state, ctx, { answer: item.full_text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 7. Random starting point
   * ------------------------------------------------------------------ */
  function renderRandomStart(item, state, ctx) {
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;
    const value = state.value != null ? String(state.value) : '';
    const passages = item.passages && typeof item.passages === 'object' ? item.passages : {};
    const optionKeys = Array.isArray(item.continuation_options) && item.continuation_options.length
      ? item.continuation_options.map(String)
      : Object.keys(passages);
    const defaultKey = String(item.default_length != null ? item.default_length : (optionKeys[0] || '2'));
    const selectedKey = state.continuationLength != null ? String(state.continuationLength) : defaultKey;
    const passage = passages[selectedKey] || passages[defaultKey] || passages[optionKeys[0]] || null;
    const requiredWords = String(item.expected_text || '').trim().split(/\s+/).filter(Boolean).length || 2;
    const lengthLabel = selectedKey === 'all'
      ? ctx.t('rub_rs_length_all', {}, 'إلى نهاية الربع')
      : ctx.t('rub_rs_length_value', { count: Number(selectedKey) || 1 }, '{count} آية/آيات');
    const lengthButtons = optionKeys.length
      ? '<div class="rub-segmented rub-rs-lengths" role="group" aria-label="' +
        esc(ctx.t('rub_rs_length_label', {}, 'طول المتابعة')) + '">' +
        optionKeys.map((key) => '<button type="button" data-rs-length="' + esc(key) + '"' +
          (String(key) === selectedKey ? ' class="is-active"' : '') +
          (locked ? ' disabled' : '') + '>' +
          esc(key === 'all'
            ? ctx.t('rub_rs_length_all', {}, 'إلى نهاية الربع')
            : ctx.t('rub_rs_length_value', { count: Number(key) || 1 }, '{count} آية/آيات')) +
          '</button>').join('') + '</div>'
      : '';
    const passageHtml = passage
      ? (selectedKey === 'all'
        ? '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(passage.text || '') + '</div>'
        : (Array.isArray(passage.ayahs) ? passage.ayahs : []).map((entry) =>
          '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(entry.text || '') + '</div>').join(''))
      : '';
    const revealAnswer = passage
      ? ((passage.range ? passage.range + '\n' : '') + (passage.text || ''))
      : item.text;
    return '<article class="rub-ex-card" data-exercise="RANDOM_START">' +
      exerciseHead(ctx, 'rub_ex_rs_kicker', 'rub_ex_rs_title', 'بداية عشوائية',
        'rub_ex_rs_sub', 'ابدأ التسميع من آية عشوائية دون النظر إلى النص.', '') +
      '<div class="rub-random-start"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_rs_start_from', {}, 'ابدأ من')) + '</span>' +
      '<strong class="rub-random-ref" dir="rtl" lang="ar">' +
      esc(item.prompt_ref || refLabel(item.surah, item.ayah, ctx)) + '</strong>' +
      '<span class="rub-random-length">' + esc(lengthLabel) + '</span></div>' +
      lengthButtons +
      (revealed
        ? passageHtml
        : '<p class="rub-ex-prompt-label">' +
          esc(ctx.t('rub_rs_ask_words', { count: requiredWords },
            'اكتب الكلمات {count} الأولى من الآية بعد التسميع من الذاكرة:')) + '</p>' +
          '<input class="rub-typed-answer" data-rs-input value="' + esc(value) + '"' +
          ' inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" dir="rtl" lang="ar"' +
          ' placeholder="' + esc(ctx.t('rub_rs_placeholder', {}, 'أول كلمات الآية…')) + '"' +
          (locked ? ' disabled' : '') + '>') +
      (ctx.advanced ? audioControls(state, ctx, locked) : '') +
      (locked
        ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
        : '<div class="rub-ex-tools">' +
          '<button type="button" class="btn btn-ghost" data-rs-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
          '</div>') +
      feedbackHtml(state, ctx, { answer: revealAnswer }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 8. Ayah connection + verified similar ayat
   * ------------------------------------------------------------------ */
  function renderConnectionSimilar(item, state, ctx) {
    const mode = String(item.mode || 'rub_membership');
    const locked = !!state.recorded && !state.practiceRetry;
    const selected = state.selected != null ? String(state.selected) : '';
    const showMeta = !!state.checked;
    const options = Array.isArray(item.options) ? item.options : [];

    let question = ctx.t('rub_mt_question_rub', {}, 'أي الآيتين من الربع الحالي؟');
    let promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_mt_prompt_rub', {}, 'الربع الحالي')) + '</span>' +
      arabicBlock(ctx.rubLabel || '', 'rub-ex-prompt-text') + '</div>';
    if (mode === 'context_after' || mode === 'context_before' || mode === 'continuation') {
      question = mode === 'context_after'
        ? ctx.t('rub_mt_question_after', {}, 'أي الآيتين تسبق الآية المعروضة؟')
        : (mode === 'context_before'
          ? ctx.t('rub_mt_question_before', {}, 'أي الآيتين تلي الآية المعروضة؟')
          : ctx.t('rub_mt_question_continuation', {}, 'أي التكملتين الصحيحة لبداية الآية؟'));
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t(mode === 'continuation' ? 'rub_mt_prompt_prefix' : 'rub_mt_prompt_context', {},
          mode === 'continuation' ? 'بداية الآية' : 'الآية المعروضة')) + '</span>' +
        arabicBlock(item.prompt_text) +
        (!item.hide_reference && !ctx.advanced
          ? '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span></div>'
          : '') + '</div>';
    }

    const optionsHtml = '<div class="rub-options" data-cn-options>' + options.map((option) => {
      const id = String(option.id || '');
      const isSelected = selected === id;
      const isCorrect = !!option.correct;
      let cls = 'rub-option';
      if (isSelected) cls += ' is-selected';
      if (showMeta && isCorrect) cls += ' is-correct';
      if (showMeta && isSelected && !isCorrect) cls += ' is-wrong';
      const meta = [];
      if (showMeta && option.ref) {
        meta.push('<span class="rub-option-ref' + (item.outside_rub && !isCorrect ? ' is-outside' : '') + '">' +
          esc(option.ref) + '</span>');
      }
      if (showMeta && item.outside_rub && !isCorrect) {
        meta.push('<span class="rub-option-ref is-outside">' + esc(ctx.t('rub_outside_rub', {}, 'خارج الربع')) + '</span>');
      }
      const text = showMeta && Array.isArray(option.segments)
        ? diffSegments(option.segments, mode === 'continuation' ? item.prompt_text : '')
        : esc(option.text || '');
      return '<button type="button" class="' + cls + '" data-cn-option="' + esc(id) + '"' +
        (locked ? ' disabled' : '') + '>' +
        '<span class="rub-option-mark" aria-hidden="true">' + esc(id.toUpperCase()) + '</span>' +
        '<span class="rub-option-body"><span class="rub-option-text" dir="rtl" lang="ar">' + text + '</span>' +
        (meta.length ? '<span class="rub-option-meta">' + meta.join('') + '</span>' : '') +
        '</span></button>';
    }).join('') + '</div>';

    return '<article class="rub-ex-card" data-exercise="CONNECTION">' +
      exerciseHead(ctx, 'rub_ex_cn_kicker', 'rub_ex_cn_title', 'ربط الآيات والمتشابهات',
        'rub_ex_cn_similar_sub', 'الجزء الثاني: ميّز الآية الصحيحة من بين آيتين متشابهتين موثقتين.',
        '<span class="rub-ex-tag' + (showMeta && item.outside_rub ? ' is-outside' : '') + '">' +
        esc(showMeta && item.outside_rub ? ctx.t('rub_outside_rub', {}, 'خارج الربع') : ctx.t('rub_mt_verified', {}, 'موثّق')) +
        '</span>') +
      '<p class="rub-ex-question">' + esc(question) + '</p>' +
      promptHtml + optionsHtml +
      (showMeta && item.diff_count
        ? '<p class="rub-ex-prompt-label">' + esc(ctx.t('rub_mt_diff_note', { count: item.diff_count }, 'مواضع الاختلاف: {count}')) + '</p>'
        : '') +
      (locked ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>' : '') +
      feedbackHtml(state, ctx, {
        answer: item.prompt_full || '',
        note: item.outside_rub
          ? ctx.t('rub_mt_feedback_outside', {}, 'إحدى الآيتين من خارج الربع؛ وُسمت بعد الإجابة.')
          : '',
      }) +
      '</article>';
  }

  function renderConnection(item, state, ctx) {
    if (String(item.kind || '') === 'similar') {
      return renderConnectionSimilar(item, state, ctx);
    }
    const mode = String(item.mode || 'next_opening');
    const locked = !!state.recorded && !state.practiceRetry;
    const promptLabel = mode === 'current_ending'
      ? ctx.t('rub_cn_prompt_opening', {}, 'بداية الآية')
      : ctx.t('rub_cn_prompt_ending', {}, 'نهاية الآية');
    const question = mode === 'current_ending'
      ? ctx.t('rub_cn_question_ending', {}, 'أي نهاية آية تنتمي إلى هذه البداية؟')
      : ctx.t('rub_cn_question_opening', {}, 'أي بداية آية تأتي مباشرة بعدها؟');
    return '<article class="rub-ex-card" data-exercise="CONNECTION">' +
      exerciseHead(ctx, 'rub_ex_cn_kicker', 'rub_ex_cn_title', 'ربط الآيات والمتشابهات',
        'rub_ex_cn_sub', 'اربط نهاية الآية ببداية التالية، وميّز المتشابهات الموثقة.',
        '<span class="rub-ex-tag">' + esc(ctx.t('rub_cn_part_transition', {}, 'ربط انتقالي')) + '</span>') +
      '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' + esc(promptLabel) + '</span>' +
      arabicBlock(item.prompt_text) +
      (!item.hide_reference
        ? '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span></div>'
        : '') + '</div>' +
      '<p class="rub-ex-question">' + esc(question) + '</p>' +
      renderChallengeOptions(item, state, ctx, 'cn') +
      (locked
        ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>' : '') +
      feedbackHtml(state, ctx, { answer: item.text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 9. Reverse navigation
   * ------------------------------------------------------------------ */
  function renderReverse(item, state, ctx) {
    return '<article class="rub-ex-card" data-exercise="REVERSE">' +
      exerciseHead(ctx, 'rub_ex_rv_kicker', 'rub_ex_rv_title', 'التراجع العكسي',
        'rub_ex_rv_sub', 'من الآية المعروضة، اختر الآية التي تسبقها مباشرة.', '') +
      '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_rv_prompt', {}, 'الآية الحالية')) + '</span>' +
      arabicBlock(item.prompt_text) +
      '<div class="rub-option-meta">' + (ctx.advanced ? '' : '<span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span>') + '</div></div>' +
      '<p class="rub-ex-question">' + esc(ctx.t('rub_rv_question', {}, 'أي آية تسبقها مباشرة؟')) + '</p>' +
      renderChallengeOptions(item, state, ctx, 'rv') +
      (state.recorded && !state.practiceRetry
        ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>' : '') +
      feedbackHtml(state, ctx, { answer: item.text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 10. Error detection (altered text is always displayed separately)
   * ------------------------------------------------------------------ */
  function renderErrorDetect(item, state, ctx) {
    const locked = !!state.recorded && !state.practiceRetry;
    const showError = !!state.checked;
    const errorIndices = Array.isArray(item.error_indices) ? item.error_indices.map(Number) : [];
    const selected = state.selectedIndex != null ? Number(state.selectedIndex) : null;
    const words = Array.isArray(item.display_words) ? item.display_words : [];
    const wordsHtml = words.map((word, index) => {
      let cls = 'rub-ed-word';
      if (selected === index) cls += ' is-selected';
      if (showError && errorIndices.includes(index)) cls += ' is-error';
      return '<button type="button" class="' + cls + '" data-ed-word="' + index + '"' +
        (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(word.text || '') + '</button>';
    }).join(' ');
    return '<article class="rub-ex-card" data-exercise="ERROR_DETECT">' +
      exerciseHead(ctx, 'rub_ex_ed_kicker', 'rub_ex_ed_title', 'اكتشاف الخطأ',
        'rub_ex_ed_sub', 'النص أدناه معدّل عمداً للاختبار. اضغط الكلمة التي ترى أنها خاطئة.', '') +
      '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_ed_prompt', {}, 'النص المعدّل (ليس نصاً قرآنياً)')) + '</span>' +
      '<div class="rub-ed-verse" data-ed-verse dir="rtl" lang="ar">' + wordsHtml + '</div>' +
      '<div class="rub-option-meta">' + (ctx.advanced ? '' : '<span class="rub-option-ref">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</span>') + '</div></div>' +
      '<p class="rub-ed-disclaimer">' + esc(ctx.t('rub_ed_disclaimer', {}, 'هذا النص معدّل للاختبار فقط، وليس نصاً قرآنياً. النص الأصلي يظهر بعد الإجابة.')) + '</p>' +
      (state.checked || state.reveal
        ? '<div class="rub-ed-original"><span class="rub-ex-prompt-label">' + esc(ctx.t('rub_ed_original', {}, 'النص الأصلي الصحيح')) + '</span>' +
          '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(item.original_text) + '</div></div>'
        : '') +
      (locked
        ? '<div class="rub-ex-tools">' + retryButton(ctx) + '</div>'
        : '<div class="rub-ex-tools">' +
          '<button type="button" class="btn btn-ghost" data-ed-reveal>' + esc(ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
          '</div>') +
      feedbackHtml(state, ctx, { answer: item.original_text }) +
      '</article>';
  }

  /* ---------------------------------------------------------------------
   * 11. No-preview recitation + manual recording
   * ------------------------------------------------------------------ */
  function renderNoPreview(item, state, ctx) {
    const locked = !!state.recorded && !state.practiceRetry;
    const revealed = !!state.reveal;
    const recording = state.npState === 'recording';
    const hasRecording = state.npState === 'recorded';
    const report = state.selfReport || '';
    const passage = Array.isArray(item.passage)
      ? item.passage.map((entry) => '<div class="rub-ex-verse" dir="rtl" lang="ar">' + esc(entry.text) + '</div>').join('')
      : '';
    return '<article class="rub-ex-card" data-exercise="NO_PREVIEW">' +
      exerciseHead(ctx, 'rub_ex_np_kicker', 'rub_ex_np_title', 'التسميع بدون معاينة',
        'rub_ex_np_sub', 'أخفِ المصحف، سمّع من الذاكرة، وسجّل صوتك للمقارنة اليدوية.', '') +
      '<div class="rub-random-start"><span class="rub-ex-prompt-label">' +
      esc(ctx.t('rub_np_start_from', {}, 'ابدأ من')) + '</span>' +
      '<strong class="rub-random-ref" dir="rtl" lang="ar">' + esc(item.start_ref || refLabel(item.surah, item.ayah, ctx)) + '</strong>' +
      '<span class="rub-random-length">' + esc(ctx.t('rub_np_length', { count: item.length || 1 }, '{count} آية/آيات')) + '</span></div>' +
      '<p class="rub-np-note">' + esc(ctx.t('rub_np_no_verify', {}, 'لا يوجد تحقق آلي من التلاوة. التسجيل للمراجعة اليدوية فقط، ولن ندّعي أنه تم التحقق.')) + '</p>' +
      (revealed ? passage : '') +
      '<div class="rub-np-controls">' +
      '<button type="button" class="btn btn-primary" data-np-record' + (recording || locked ? ' disabled' : '') + '>' +
      esc(ctx.t('rub_np_record', {}, recording ? 'جارٍ التسجيل…' : 'ابدأ التسجيل')) + '</button>' +
      '<button type="button" class="btn btn-ghost" data-np-stop' + (recording ? '' : ' disabled') + '>' +
      esc(ctx.t('rub_np_stop', {}, 'أوقف التسجيل')) + '</button>' +
      '<button type="button" class="btn btn-ghost" data-np-play' + (hasRecording ? '' : ' disabled') + '>' +
      esc(ctx.t('rub_np_play', {}, 'استمع للتسجيل')) + '</button>' +
      '<button type="button" class="btn btn-ghost" data-np-reveal>' + esc(revealed ? ctx.t('rub_ph_hide_again', {}, 'أخفِ مرة أخرى') : ctx.t('rub_ex_reveal', {}, 'أظهر الحل')) + '</button>' +
      '</div>' +
      '<audio class="rub-np-audio" data-np-audio controls' + (hasRecording ? '' : ' hidden') + '></audio>' +
      '<div class="rub-self-report">' +
      '<button type="button" class="btn btn-ghost is-good' + (report === 'good' ? ' is-selected' : '') + '" data-np-report="good"' + (locked ? ' disabled' : '') + '>' +
      esc(ctx.t('rub_ph_good', {}, 'أتقنتها')) + '</button>' +
      '<button type="button" class="btn btn-ghost is-review' + (report === 'review' ? ' is-selected' : '') + '" data-np-report="review"' + (locked ? ' disabled' : '') + '>' +
      esc(ctx.t('rub_ph_review', {}, 'أحتاج مراجعة')) + '</button>' +
      '</div>' +
      feedbackHtml(state, ctx, { answer: item.text, note: ctx.t('rub_np_feedback_note', {}, 'التقييم ذاتي ولم يتم التحقق الآلي من الصوت.') }) +
      '</article>';
  }

  function renderUnavailable(exercise, stage, ctx, options) {
    const reason = stage && stage.reason ? String(stage.reason) : 'no_items';
    let title = ctx.t('rub_ex_unavailable_title', {}, 'هذا التمرين غير متاح الآن');
    let desc = ctx.t('rub_ex_unavailable_desc', {}, 'لا توجد بيانات كافية لهذا التمرين في هذا الربع. يمكنك المتابعة إلى التمرين التالي.');
    if (reason === 'outside_disabled') {
      title = ctx.t('rub_mt_outside_disabled_title', {}, 'لا توجد متشابهات داخل الربع');
      desc = ctx.t('rub_mt_outside_disabled_desc', {}, 'كل المتشابهات الموثقة لهذا الربع تقع خارج حدوده. فعّل خيار «السماح بالمتشابهات من خارج الربع» ثم أعد الجلسة.');
    } else if (reason === 'no_verified_pairs' || reason === 'no_verified_data') {
      title = ctx.t('rub_mt_no_pairs_title', {}, 'لا توجد أزواج موثقة');
      desc = ctx.t('rub_mt_no_pairs_desc', {}, 'لم نجد زوجاً موثقاً لهذا الربع في قائمة المتشابهات. لن نخترع مقارنة غير موثوقة؛ تابع إلى التمرين التالي.');
    } else if (reason === 'no_verses') {
      title = ctx.t('rub_ex_no_verses_title', {}, 'لا توجد آيات كافية');
      desc = ctx.t('rub_ex_no_verses_desc', {}, 'يحتاج هذا التمرين إلى آيات أكثر مما في الربع الحالي.');
    }
    const action = reason === 'outside_disabled' && options && typeof options.onEnableOutside === 'string'
      ? '<button type="button" class="btn btn-primary" data-rub-enable-outside>' + esc(ctx.t('rub_mt_enable_outside', {}, 'فعّل المتشابهات الخارجية')) + '</button>'
      : '';
    return '<article class="rub-ex-card" data-exercise="' + esc(exercise) + '">' +
      '<div class="rub-ex-empty"><div class="rub-ex-empty-icon" aria-hidden="true">۞</div>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(desc) + '</p>' + action + '</div></article>';
  }

  function render(exercise, item, state, ctx) {
    if (!item) return '';
    switch (String(exercise)) {
      case 'WORD_ORDER': return renderWordOrder(item, state, ctx);
      case 'MISSING_WORDS': return renderMissingWords(item, state, ctx);
      case 'CONTINUE_AYAH': return renderContinueAyah(item, state, ctx);
      case 'MUTASHABIHAT': return renderMutashabihat(item, state, ctx);
      case 'PROGRESSIVE_HIDE': return renderProgressiveHide(item, state, ctx);
      case 'INTERRUPT': return renderInterrupt(item, state, ctx);
      case 'RANDOM_START': return renderRandomStart(item, state, ctx);
      case 'CONNECTION': return renderConnection(item, state, ctx);
      case 'REVERSE': return renderReverse(item, state, ctx);
      case 'ERROR_DETECT': return renderErrorDetect(item, state, ctx);
      case 'NO_PREVIEW': return renderNoPreview(item, state, ctx);
      default: return '';
    }
  }

  window.RubExercises = {
    normalizeArabic,
    normalizeStrict,
    esc,
    hashString,
    seededShuffle,
    wordText,
    wordNorm,
    wordStrict,
    tokenMatchesPosition,
    refLabel,
    diffSegments,
    render,
    renderUnavailable,
    feedbackHtml,
  };
})();
