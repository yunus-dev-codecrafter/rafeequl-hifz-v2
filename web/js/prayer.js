'use strict';

/**
 * Rafeequl Hifz — Prayer Recitation Companion (تلاوة الصلاة)
 * Handles verse fetching, font resizing, length switching, and full coverage cycle tracking.
 */

(function () {
  let currentLength = localStorage.getItem('rh_prayer_length') || 'SHORT';
  let currentFontSize = parseFloat(localStorage.getItem('rh_prayer_font_size')) || 1.15;
  let currentRecitationId = null;
  let isLoading = false;

  const MIN_FONT = 0.95;
  const MAX_FONT = 1.65;
  const FONT_STEP = 0.1;

  // DOM Elements
  const tabs = document.querySelectorAll('.prayer-segment-tab');
  const surahBadge = document.getElementById('prayer-badge-surah');
  const metaBadge = document.getElementById('prayer-badge-meta');
  const retryBadge = document.getElementById('prayer-badge-retry');
  const cycleBadgeEl = document.getElementById('prayer-badge-cycle');
  const cycleTitleEl = document.getElementById('prayer-cycle-title');
  const cycleProgressEl = document.getElementById('prayer-cycle-progress');
  const cycleFillEl = document.getElementById('prayer-cycle-fill');
  const textDisplay = document.getElementById('prayer-verses-text');
  const skeletonEl = document.getElementById('prayer-skeleton');
  const refreshBtn = document.getElementById('prayer-refresh-btn');
  const fontDecBtn = document.getElementById('prayer-font-dec');
  const fontIncBtn = document.getElementById('prayer-font-inc');
  const btnMastered = document.getElementById('btn-prayer-mastered');
  const btnRetry = document.getElementById('btn-prayer-retry');
  const feedbackCard = document.getElementById('prayer-feedback-card');
  const celebrationCard = document.getElementById('prayer-celebration-card');
  const celebrationSub = document.getElementById('prayer-celebration-sub');
  const btnNextPortion = document.getElementById('btn-next-portion');

  function init() {
    applyFontSize(currentFontSize, false);
    setupTabs();
    setupControls();
    setupActions();
    fetchVerses(false);
  }

  function applyFontSize(size, save = true) {
    currentFontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, size));
    const container = document.getElementById('prayer-card');
    if (container) {
      container.style.setProperty('--prayer-font-size', `${currentFontSize.toFixed(2)}rem`);
    }
    if (save) {
      localStorage.setItem('rh_prayer_font_size', currentFontSize.toFixed(2));
    }
  }

  function updateCycleDisplay(cycle) {
    if (!cycle) return;
    if (cycleTitleEl) {
      cycleTitleEl.textContent = `🔄 الدورة الشاملة ${cycle.cycle_number}`;
    }
    if (cycleProgressEl) {
      cycleProgressEl.textContent = `${cycle.mastered_verses} من ${cycle.total_memorized_verses} آية (${cycle.percent}%)`;
    }
    if (cycleFillEl) {
      cycleFillEl.style.width = `${cycle.percent}%`;
    }
    if (cycleBadgeEl) {
      cycleBadgeEl.textContent = `الدورة ${cycle.cycle_number}`;
    }
    if (cycle.cycle_completed) {
      showToast(`🎉 ما شاء الله! ختمت تلاوة كامل محفوظك في صلواتك بنجاح! تبدأ الآن الدورة رقم ${cycle.cycle_number}.`);
    }
  }

  function setupTabs() {
    tabs.forEach((tab) => {
      const len = tab.getAttribute('data-len');
      if (len === currentLength) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }

      tab.addEventListener('click', () => {
        if (isLoading) return;
        const newLen = tab.getAttribute('data-len') || 'SHORT';
        if (newLen === currentLength) return;

        currentLength = newLen;
        localStorage.setItem('rh_prayer_length', currentLength);

        tabs.forEach((t) => {
          const isActive = t === tab;
          t.classList.toggle('active', isActive);
          t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        fetchVerses(true);
      });
    });
  }

  function setupControls() {
    if (fontDecBtn) {
      fontDecBtn.addEventListener('click', () => {
        applyFontSize(currentFontSize - FONT_STEP);
      });
    }

    if (fontIncBtn) {
      fontIncBtn.addEventListener('click', () => {
        applyFontSize(currentFontSize + FONT_STEP);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (isLoading) return;
        refreshBtn.classList.add('spinning');
        fetchVerses(true).finally(() => {
          setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
        });
      });
    }

    if (btnNextPortion) {
      btnNextPortion.addEventListener('click', () => {
        if (celebrationCard) celebrationCard.classList.add('hidden');
        if (feedbackCard) feedbackCard.classList.remove('hidden');
        fetchVerses(true);
      });
    }
  }

  function setupActions() {
    if (btnMastered) {
      btnMastered.addEventListener('click', async () => {
        if (!currentRecitationId || isLoading) return;
        btnMastered.disabled = true;
        if (btnRetry) btnRetry.disabled = true;

        try {
          const res = await API.call('prayer/update_status.php', {
            method: 'POST',
            body: { recitation_id: currentRecitationId, status: 'MASTERED' },
          });

          if (res && res.success) {
            playFeedbackSound(true);
            if (res.cycle) {
              updateCycleDisplay(res.cycle);
              if (celebrationSub) {
                celebrationSub.textContent = `تم تسجيل إتقان المقطع بنجاح! أنجزتَ ${res.cycle.mastered_verses} من ${res.cycle.total_memorized_verses} آية (${res.cycle.percent}%) في الدورة ${res.cycle.cycle_number}.`;
              }
            }
            showCelebration();
          } else {
            showToast((res && res.error) || 'حدث خطأ أثناء حفظ التقييم');
          }
        } catch (err) {
          showToast('تعذر الاتصال بالخادم');
        } finally {
          btnMastered.disabled = false;
          if (btnRetry) btnRetry.disabled = false;
        }
      });
    }

    if (btnRetry) {
      btnRetry.addEventListener('click', async () => {
        if (!currentRecitationId || isLoading) return;
        btnRetry.disabled = true;
        if (btnMastered) btnMastered.disabled = true;

        try {
          const res = await API.call('prayer/update_status.php', {
            method: 'POST',
            body: { recitation_id: currentRecitationId, status: 'PENDING_RETRY' },
          });

          if (res && res.success) {
            playFeedbackSound(false);
            showToast('حُفظ المقطع، وسيكون هو وردك في صلاتك القادمة لإتقانه بإذن الله 🤲');
            if (retryBadge) retryBadge.classList.remove('hidden');
            if (res.cycle) {
              updateCycleDisplay(res.cycle);
            }
          } else {
            showToast((res && res.error) || 'حدث خطأ أثناء حفظ التقييم');
          }
        } catch (err) {
          showToast('تعذر الاتصال بالخادم');
        } finally {
          btnRetry.disabled = false;
          if (btnMastered) btnMastered.disabled = false;
        }
      });
    }
  }

  async function fetchVerses(forceNew = false) {
    isLoading = true;
    if (skeletonEl) skeletonEl.classList.remove('hidden');
    if (textDisplay) textDisplay.classList.add('hidden');
    if (celebrationCard) celebrationCard.classList.add('hidden');
    if (feedbackCard) feedbackCard.classList.remove('hidden');

    try {
      const res = await API.call('prayer/get_verses.php', {
        method: 'POST',
        body: { length: currentLength, force_new: forceNew },
      });

      if (!res || !res.success) {
        if (textDisplay) {
          textDisplay.innerHTML = `<p style="color:var(--danger); text-align:center; padding:1.5rem;">${
            res?.error || 'تعذر استحضار آيات من محفوظك، تأكد من تسجيل حفظك في الخطة.'
          }</p>`;
          textDisplay.classList.remove('hidden');
        }
        return;
      }

      currentRecitationId = res.recitation_id;

      // Update badges
      if (surahBadge) {
        surahBadge.textContent = `${res.surah_name_ar} • الآيات ${res.start_ayah} – ${res.end_ayah}`;
      }

      const firstPage = res.verses?.[0]?.page;
      if (metaBadge) {
        metaBadge.textContent = `${firstPage ? `صفحة ${firstPage} • ` : ''}${res.ayah_count} آيات`;
      }

      if (retryBadge) {
        if (res.is_retry) {
          const attemptText = res.attempts > 0 ? ` (محاولة ${res.attempts + 1})` : '';
          retryBadge.textContent = `⚠️ مقطع مُعاد من صلاة سابقة${attemptText}`;
          retryBadge.classList.remove('hidden');
        } else {
          retryBadge.classList.add('hidden');
        }
      }

      // Update cycle tracker
      if (res.cycle) {
        updateCycleDisplay(res.cycle);
      }

      // Render verses
      if (textDisplay && Array.isArray(res.verses)) {
        const html = res.verses
          .map((v) => {
            const verseText = escapeHtml(v.text);
            return `${verseText} <span class="prayer-ayah-mark">${v.ayah}</span>`;
          })
          .join(' ');

        textDisplay.innerHTML = html;
        textDisplay.classList.remove('hidden');
      }
    } catch (err) {
      if (textDisplay) {
        textDisplay.innerHTML =
          '<p style="color:var(--danger); text-align:center; padding:1.5rem;">حدث خطأ أثناء تحميل الآيات، يرجى المحاولة ثانية.</p>';
        textDisplay.classList.remove('hidden');
      }
    } finally {
      if (skeletonEl) skeletonEl.classList.add('hidden');
      isLoading = false;
    }
  }

  function showCelebration() {
    if (feedbackCard) feedbackCard.classList.add('hidden');
    if (celebrationCard) celebrationCard.classList.remove('hidden');
    if (retryBadge) retryBadge.classList.add('hidden');
  }

  function playFeedbackSound(isSuccess) {
    if (typeof playSoundEffect === 'function') {
      playSoundEffect(isSuccess ? 'complete' : 'click');
    }
  }

  function showToast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    const t = document.createElement('div');
    t.className = 'toast show';
    t.style.cssText =
      'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--ink); color:var(--bg); padding:0.6rem 1.1rem; border-radius:10px; font-size:0.88rem; font-weight:700; z-index:9999; box-shadow:0 6px 20px rgba(0,0,0,0.25); text-align:center; max-width:90vw;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.remove();
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
