'use strict';

/* ==========================================================================
   Rafeequl Hifz — Rub' Consolidation exercise renderers (v12)

   Pure-ish rendering helpers for the five revision exercises. The session
   controller owns the state, persistence and answer validation; this module
   turns an item + local state into accessible RTL markup.

   The Arabic text always comes from the server plan. Nothing here invents or
   rewrites Qur'anic text.
   ========================================================================== */

(function () {
  const ARABIC_MARKS = /[\u064B-\u0652\u0670\u06D6-\u06ED]/g;
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

    const placedHtml = placed.map((id, index) => {
      const token = tokenById[id];
      if (!token) return '';
      return '<button type="button" class="rub-word-token is-placed" data-wo-placed="' + index + '"' +
        (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
    }).join('');

    const bankHtml = shuffled.map((token) => {
      const isPlaced = placed.indexOf(token.id) !== -1;
      if (isPlaced) return '';
      return '<button type="button" class="rub-word-token' + (token.decoy ? ' is-decoy' : '') +
        '" data-wo-token="' + esc(token.id) + '"' + (locked ? ' disabled' : '') +
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
      '<div class="rub-ex-ref">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</div>' +
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
      '<div class="rub-ex-ref">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</div>' +
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
      '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</span></div>' +
      '</div>';

    let body = '';
    if (mode === 'arrange') {
      const words = Array.isArray(item.words) ? item.words : [];
      const placed = Array.isArray(state.placed) ? state.placed : [];
      const tokens = words.map((word, index) => ({ id: 'c' + index, text: wordText(word), index }));
      const shuffled = seededShuffle(tokens, hashString(item.item_id));
      const tokenById = {};
      shuffled.forEach((token) => { tokenById[token.id] = token; });

      const placedHtml = placed.map((id, index) => {
        const token = tokenById[id];
        if (!token) return '';
        return '<button type="button" class="rub-word-token is-placed" data-ca-placed="' + index + '"' +
          (locked ? ' disabled' : '') + ' dir="rtl" lang="ar">' + esc(token.text) + '</button>';
      }).join('');

      const bankHtml = shuffled.map((token) => {
        if (placed.indexOf(token.id) !== -1) return '';
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
        '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span></div></div>';
    } else if (mode === 'context_before') {
      question = ctx.t('rub_mt_question_before', {}, 'أي الآيتين تلي الآية المعروضة؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_context', {}, 'الآية المعروضة')) + '</span>' +
        arabicBlock(item.prompt_text) +
        '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span></div></div>';
    } else {
      question = ctx.t('rub_mt_question_continuation', {}, 'أي التكملتين الصحيحة لبداية الآية؟');
      promptHtml = '<div class="rub-ex-prompt"><span class="rub-ex-prompt-label">' +
        esc(ctx.t('rub_mt_prompt_prefix', {}, 'بداية الآية')) + '</span>' +
        arabicBlock(item.prompt_text) +
        '<div class="rub-option-meta"><span class="rub-option-ref">' + esc(item.prompt_ref || '') + '</span></div></div>';
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
        '<span class="rub-ex-tag">' + esc(refLabel(item.surah, item.ayah, ctx)) + '</span>') +
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
      default: return '';
    }
  }

  window.RubExercises = {
    normalizeArabic,
    esc,
    hashString,
    seededShuffle,
    wordText,
    wordNorm,
    refLabel,
    diffSegments,
    render,
    renderUnavailable,
    feedbackHtml,
  };
})();
