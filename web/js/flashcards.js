'use strict';

/* ==========================================================================
   Rafeequl Hifz (رفيق الحفظ) — Interactive Flashcard Practice Engine
   Fixes:
   - Fixed mistake_id bug: always normalized from card.mistake_id || card.id
   - Directly fetches from api/mistakes/get_flashcards.php
   - 3D Flip Card animations and gestures
   - Seamless update of mastery count and archiving
   ========================================================================== */

const FC = {
  deck: [],
  pos: 0,
  busy: false,
  flipped: false,
};

const fcEl = (id) => document.getElementById(id);

function fcShowOnly(view) {
  if (fcEl('deck-stage')) fcEl('deck-stage').classList.toggle('hidden', view !== 'stage');
  if (fcEl('deck-empty')) fcEl('deck-empty').classList.toggle('hidden', view !== 'empty');
  if (fcEl('deck-loading')) fcEl('deck-loading').classList.toggle('hidden', view !== 'loading');
}

function normalizeCard(raw) {
  if (!raw) return null;
  const mId = parseInt(raw.mistake_id ?? raw.id, 10);
  if (!mId || mId < 1) return null;

  if (raw.front && raw.back) {
    return {
      mistake_id: mId,
      front: raw.front,
      back: raw.back,
    };
  }

  return {
    mistake_id: mId,
    front: {
      surah_number: parseInt(raw.surah_number, 10) || 1,
      surah_name: raw.surah_name || ('سورة ' + (raw.surah_number || '')),
      page_number: parseInt(raw.page_number, 10) || 1,
      ayah_number: parseInt(raw.ayah_number, 10) || 1,
      mistake_type: raw.mistake_type || 'MUTASHABIHAT',
      mistake_label: raw.mistake_label || raw.mistake_type || 'خطأ',
      juz_number: raw.juz_number ? parseInt(raw.juz_number, 10) : null,
      hizb_number: raw.hizb_number ? parseInt(raw.hizb_number, 10) : null,
      rub_el_hizb: raw.rub_el_hizb ? parseInt(raw.rub_el_hizb, 10) : null,
    },
    back: {
      notes: raw.notes || '',
      mastery_count: parseInt(raw.mastery_count ?? 0, 10),
      logged_at: raw.created_at || raw.logged_at || '',
    },
  };
}

function fcStart(cards) {
  FC.deck = (cards || []).map(normalizeCard).filter(Boolean);
  FC.pos = 0;
  FC.busy = false;

  if (!FC.deck.length) {
    fcShowOnly('empty');
    return;
  }
  fcShowOnly('stage');
  fcRender();
}

function fcCard() {
  return FC.deck[FC.pos] || null;
}

function fcRender() {
  if (!FC.deck.length) {
    fcShowOnly('empty');
    return;
  }
  if (FC.pos >= FC.deck.length) FC.pos = 0;

  const card = FC.deck[FC.pos];
  const f = card.front;
  const b = card.back;

  const counterEl = fcEl('deck-counter');
  if (counterEl) {
    counterEl.textContent = window.I18N
      ? I18N.t('fc_counter_label', { current: FC.pos + 1, total: FC.deck.length })
      : ('البطاقة ' + (FC.pos + 1) + ' من ' + FC.deck.length);
  }

  const sName = window.I18N ? I18N.getSurahName(f.surah_number) : f.surah_name;
  const sDisplay = (window.I18N && I18N.lang === 'en') ? ('Surah ' + sName) : ('سورة ' + sName);

  if (fcEl('fc-page')) fcEl('fc-page').textContent = (window.I18N ? I18N.t('page_prefix') : 'صفحة ') + f.page_number;
  if (fcEl('fc-surah')) fcEl('fc-surah').textContent = sDisplay;
  if (fcEl('fc-ayah')) fcEl('fc-ayah').textContent = window.I18N ? I18N.t('ayah_label', { num: f.ayah_number }) : ('الآية ' + f.ayah_number);
  if (fcEl('fc-tag')) fcEl('fc-tag').textContent = window.I18N ? I18N.getMistakeLabel(f.mistake_type) : f.mistake_label;

  const parts = [];
  if (f.juz_number) parts.push(window.I18N ? I18N.t('juz_label', { num: f.juz_number }) : ('الجزء ' + f.juz_number));
  if (f.hizb_number) parts.push(window.I18N ? I18N.t('hizb_label', { num: f.hizb_number }) : ('الحزب ' + f.hizb_number));
  if (f.rub_el_hizb) parts.push(window.I18N ? I18N.t('rub_label', { num: f.rub_el_hizb }) : ('ربع الحزب ' + f.rub_el_hizb));
  if (fcEl('fc-meta')) fcEl('fc-meta').textContent = parts.join(' · ');

  if (fcEl('fc-notes')) fcEl('fc-notes').textContent = b.notes ? b.notes : (window.I18N ? I18N.t('fc_card_no_notes') : 'لا توجد ملاحظات مسجلة لهذه البطاقة.');
  if (fcEl('fc-mastery')) {
    const masteryTxt = window.I18N ? I18N.t('fc_card_mastery', { count: b.mastery_count }) : ('مرات الإتقان: ' + b.mastery_count);
    const dateTxt = b.logged_at ? (window.I18N ? I18N.t('fc_card_logged_date', { date: String(b.logged_at).slice(0, 10) }) : (' · سُجلت في ' + String(b.logged_at).slice(0, 10))) : '';
    fcEl('fc-mastery').textContent = masteryTxt + dateTxt;
  }

  fcFlip(false);
}

function fcFlip(force) {
  const cardEl = fcEl('flashcard');
  if (!cardEl) return;
  cardEl.classList.remove('exiting-left', 'exiting-right');
  FC.flipped = typeof force === 'boolean' ? force : !FC.flipped;
  cardEl.classList.toggle('is-flipped', FC.flipped);

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
    setTimeout(resolve, 360);
  });
}

async function fcSubmit(action) {
  const card = fcCard();
  if (!card || FC.busy) return;

  const mistakeId = parseInt(card.mistake_id, 10);
  if (!mistakeId || mistakeId < 1) {
    showToast('خطأ: معرّف الخطأ غير صالح (' + card.mistake_id + ')', true);
    return;
  }

  FC.busy = true;
  const mastered = action === 'MASTERED';

  if (fcEl('btn-mastered')) fcEl('btn-mastered').disabled = true;
  if (fcEl('btn-keep-practicing')) fcEl('btn-keep-practicing').disabled = true;

  try {
    await API.call('mistakes/clear_mistake.php', {
      method: 'POST',
      body: { mistake_id: mistakeId, action },
      redirectOn401: true,
    });

    await fcAnimateExit(mastered || action === 'DELETE' ? 'left' : 'right');

    const [current] = FC.deck.splice(FC.pos, 1);
    if (action === 'DELETE') {
      if (FC.pos >= FC.deck.length) FC.pos = 0;
      showToast(window.I18N ? I18N.t('fc_toast_deleted') : 'تم حذف البطاقة نهائياً بنجاح 🗑️');
    } else if (mastered) {
      if (FC.pos >= FC.deck.length) FC.pos = 0;
      if (window.AudioEngine) AudioEngine.playCelebration();
      showToast(window.I18N ? I18N.t('fc_toast_mastered') : 'أتقنتها بنجاح! انتقلت إلى الأرشيف ✓');
    } else {
      FC.deck.push(current);
      if (FC.pos >= FC.deck.length) FC.pos = 0;
      if (window.AudioEngine) AudioEngine.playSuccess();
      showToast(window.I18N ? I18N.t('fc_toast_recycled') : 'البطاقة عادت إلى نهاية رزمة التدريب 🔁');
    }

    if (!FC.deck.length) {
      fcShowOnly('empty');
    } else {
      fcRender();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    FC.busy = false;
    if (fcEl('btn-mastered')) fcEl('btn-mastered').disabled = false;
    if (fcEl('btn-keep-practicing')) fcEl('btn-keep-practicing').disabled = false;
    if (fcEl('btn-delete-card')) fcEl('btn-delete-card').disabled = false;
  }
}

async function loadFlashcardsDeck() {
  fcShowOnly('loading');
  try {
    const res = await API.call('mistakes/get_flashcards.php', { redirectOn401: true });
    if (res && res.cards && res.cards.length > 0) {
      fcStart(res.cards);
    } else {
      fcShowOnly('empty');
    }
  } catch (err) {
    showToast(err.message || 'تعذر تحميل البطاقات', true);
    fcShowOnly('empty');
  }
}

function initFlashcardsPage() {
  const cardEl = fcEl('flashcard');
  if (cardEl) {
    cardEl.addEventListener('click', () => fcFlip());
  }

  const hintBtn = fcEl('btn-show-hint');
  if (hintBtn) {
    hintBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fcFlip(true);
    });
  }

  const masteredBtn = fcEl('btn-mastered');
  if (masteredBtn) {
    masteredBtn.addEventListener('click', () => fcSubmit('MASTERED'));
  }

  const keepBtn = fcEl('btn-keep-practicing');
  if (keepBtn) {
    keepBtn.addEventListener('click', () => fcSubmit('KEEP_PRACTICING'));
  }

  const deleteBtn = fcEl('btn-delete-card');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const confirmMsg = window.I18N ? I18N.t('fc_delete_confirm') : 'هل أنت متأكد من حذف هذه البطاقة وسجل هذا الخطأ نهائياً؟';
      if (confirm(confirmMsg)) {
        fcSubmit('DELETE');
      }
    });
  }

  if (window.I18N) {
    I18N.onChange(() => {
      if (FC.deck.length) fcRender();
    });
  }

  loadFlashcardsDeck();
}

document.addEventListener('DOMContentLoaded', () => {
  if (fcEl('flashcard')) {
    initFlashcardsPage();
  }
});
