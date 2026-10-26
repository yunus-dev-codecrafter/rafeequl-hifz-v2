'use strict';

/* ==========================================================================
   Rafeequl Hifz — Rub' Consolidation (تثبيت الربع)
   One random rub' per day. Every stop station is recited 3 times, slowly.

   - Server: api/tasks/get_rub_verses.php + update_rub.php
   - Local:  per-task reps + an offline queue (latest state wins)
   ========================================================================== */

const RubPage = {
  taskId: 0,
  taskDate: '',
  rub: null,
  verses: [],
  reps: {},
  // Station text starts blurred; the user reveals it per station or all at once.
  revealed: {},
  order: [],
  stationMeta: {},
  verseByKey: {},
  tafsirOpen: {},
  activeKey: null,
  history: [],
  saving: false,
  saveTimer: null,
  queued: false,
  offlineNotified: false,
  initialized: false,
  completedShown: false,

  get storageKey() {
    return 'hifz-rub-state-v1-' + this.taskId;
  },

  t(key, fallback) {
    return window.I18N ? I18N.t(key) : fallback;
  },

  num(n) {
    return String(n);
  },

  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  refLabel(surah, ayah) {
    const name = window.I18N ? I18N.getSurahName(surah) : ('سورة ' + surah);
    return name + ' ' + ayah;
  },

  async boot() {
    if (this.initialized) return;
    this.initialized = true;

    this.bindUI();

    try {
      const data = await this.resolveTask();
      if (!data) {
        this.showInactive();
        return;
      }
      this.cacheData(data);
      this.applyData(data);
      this.render();
      this.hideLoading();
      await this.flushQueue();
      if (this.pendingLocalSync) {
        this.scheduleSync();
      }
    } catch (err) {
      this.hideLoading();
      if (err && err.status === 401) {
        return;
      }
      if (err && err.status === 404) {
        this.showInactive();
        return;
      }

      // Offline (or a server hiccup): keep reciting from the last cached rub'.
      const cached = this.loadCached();
      if (cached) {
        this.applyData(cached);
        this.render();
        showToast(this.t('rub_offline_open', 'أنت غير متصل — تم فتح آخر ربع محفوظ على جهازك'), true);
        return;
      }

      if (err && err.status !== 401) {
        showToast(err.message || 'تعذر تحميل ربع اليوم', true);
      }
      this.showInactive();
    }
  },

  cacheData(data) {
    try {
      if (!data || !data.task || !data.task.id) return;
      const prefix = 'hifz-rub-data-v1-';
      const currentKey = prefix + data.task.id;

      // Keep the device cache small: only the last few rub' payloads.
      const cached = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(prefix) === 0) cached.push(key);
      }
      if (cached.length >= 8) {
        cached
          .filter((key) => key !== currentKey)
          .sort((a, b) => parseInt(a.slice(prefix.length), 10) - parseInt(b.slice(prefix.length), 10))
          .slice(0, cached.length - 7)
          .forEach((key) => localStorage.removeItem(key));
      }

      localStorage.setItem(currentKey, JSON.stringify(data));
      localStorage.setItem('hifz-rub-last-task', String(data.task.id));
    } catch (e) {}
  },

  loadCached() {
    try {
      const id = localStorage.getItem('hifz-rub-last-task');
      if (!id) return null;
      const raw = localStorage.getItem('hifz-rub-data-v1-' + id);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.task && data.verses ? data : null;
    } catch (e) {
      return null;
    }
  },

  async resolveTask() {
    const params = new URLSearchParams(location.search);
    let taskId = parseInt(params.get('task') || '0', 10);

    if (!taskId) {
      const daily = await API.call('tasks/get_daily_tasks.php', { redirectOn401: true });
      const task = (daily.tasks || []).find((item) => item.task_type === 'RUB_TAMKIN');
      if (!task || !task.id) return null;
      taskId = task.id;
      if (task.is_completed) {
        // Still load the page for a completed task; the UI shows 100%.
      }
    }

    if (!taskId) return null;
    return API.call('tasks/get_rub_verses.php?task_id=' + encodeURIComponent(taskId), {
      redirectOn401: true,
    });
  },

  applyData(data) {
    this.taskId = data.task ? data.task.id : 0;
    this.taskDate = data.task ? data.task.task_date : (data.today || '');
    this.task = data.task || null;
    this.rub = data.rub;
    this.verses = data.verses || [];

    const local = this.readLocal();
    const localReps = local && local.reps && typeof local.reps === 'object' ? local.reps : {};
    const serverDone = new Set(data.completed_stations || []);

    this.reps = {};
    this.revealed = {};
    this.order = [];
    this.stationMeta = {};
    this.verseByKey = {};
    this.tafsirOpen = {};
    this.history = [];

    this.verses.forEach((verse) => {
      verse.segments.forEach((segment) => {
        const key = segment.key;
        let reps = Math.max(0, Math.min(3, parseInt(localReps[key], 10) || 0));
        if (serverDone.has(key)) {
          reps = 3;
        }
        this.reps[key] = reps;
        this.order.push(key);
        this.stationMeta[key] = {
          verse,
          segment,
          text: segment.text,
          stop: segment.stop,
          stopAr: segment.stop_ar,
        };
        this.verseByKey[verse.surah + ':' + verse.ayah] = verse;
      });
    });

    this.activeKey = this.firstIncomplete();
    this.pendingLocalSync = this.hasLocalProgressBeyondServer(serverDone);
  },

  hasLocalProgressBeyondServer(serverDone) {
    return this.order.some((key) => (this.reps[key] || 0) >= 3 && !serverDone.has(key));
  },

  readLocal() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  persistLocal() {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ reps: this.reps, savedAt: Date.now() })
      );
    } catch (e) {
      // Storage full / private mode: the page still works for this session.
    }
  },

  showLoading() {
    const loading = document.getElementById('rub-loading');
    const root = document.getElementById('rub-root');
    if (loading) loading.classList.remove('hidden');
    if (root) root.classList.add('hidden');
  },

  hideLoading() {
    const loading = document.getElementById('rub-loading');
    if (loading) loading.classList.add('hidden');
  },

  showInactive() {
    this.hideLoading();
    const root = document.getElementById('rub-root');
    const inactive = document.getElementById('rub-inactive');
    const dock = document.getElementById('rub-dock');
    if (root) root.classList.add('hidden');
    if (inactive) inactive.classList.remove('hidden');
    if (dock) dock.classList.add('hidden');
  },

  /* ---------------- Rendering ---------------- */

  render() {
    const root = document.getElementById('rub-root');
    if (!root || !this.rub) {
      this.showInactive();
      return;
    }
    root.classList.remove('hidden');

    const badge = document.getElementById('page-task-badge');
    if (badge) {
      badge.innerHTML = '🟢 ' + this.esc(this.t('task_rub_title', 'تثبيت الربع'));
    }

    const label = document.getElementById('rub-label');
    if (label) {
      label.textContent = this.t('rub_quarter_label', 'الربع') + ' ' + this.rub.id;
    }

    const refs = document.getElementById('rub-refs');
    if (refs) {
      refs.textContent =
        this.t('rub_from', 'من') + ' ' + this.refLabel(this.rub.start.surah, this.rub.start.ayah) +
        ' ' + this.t('rub_to', 'إلى') + ' ' + this.refLabel(this.rub.end.surah, this.rub.end.ayah);
    }

    const juz = document.getElementById('rub-chip-juz');
    if (juz) juz.textContent = this.t('rub_juz', 'الجزء') + ' ' + this.rub.juz;

    const pages = document.getElementById('rub-chip-pages');
    if (pages) {
      pages.textContent = this.rub.start_page === this.rub.end_page
        ? this.t('rub_page_one', 'صفحة') + ' ' + this.rub.start_page
        : this.t('rub_pages_range', 'صفحات') + ' ' + this.rub.start_page + '–' + this.rub.end_page;
    }

    const versesChip = document.getElementById('rub-chip-verses');
    if (versesChip) {
      versesChip.textContent = this.rub.verse_count + ' ' + this.t('rub_verses_unit', 'آية');
    }

    this.updateCarryChip();

    this.renderVerses();
    this.updateProgress();
    // Resume at the first unfinished station instead of the top of the rub'.
    this.refreshActive(true);

    const dock = document.getElementById('rub-dock');
    if (dock) dock.classList.remove('hidden');
  },

  updateCarryChip() {
    if (!this.rub) return;
    const carry = document.getElementById('rub-chip-carry');
    if (!carry) return;
    const rolloverCount = Number(this.task && this.task.rollover_count ? this.task.rollover_count : 0);
    const carried = rolloverCount > 0 || this.isCarriedOver();
    carry.classList.toggle('hidden', !carried);
    if (!carried) return;
    carry.textContent = rolloverCount > 0
      ? (window.I18N ? I18N.t('task_flag_carried_count', { count: rolloverCount }) : `مُرجَّلة ×${rolloverCount}`)
      : this.t('task_flag_carried', 'محولة من أمس');
  },

  isCarriedOver() {
    if (this.task && typeof this.task.carried_over === 'boolean') {
      return this.task.carried_over;
    }
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return this.taskDate !== y + '-' + m + '-' + d;
  },

  renderVerses() {
    const box = document.getElementById('rub-verses');
    if (!box) return;

    box.innerHTML = this.verses.map((verse, verseIndex) => {
      const stationCount = verse.segments.length;
      const surahName = window.I18N ? I18N.getSurahName(verse.surah) : ('سورة ' + verse.surah);
      const ayahText = this.t('rub_ayah', 'الآية') + ' ' + verse.ayah;

      const badges = [];
      if (verse.page) {
        badges.push(`<span class="rub-vbadge">${this.esc(this.t('page_prefix', 'صفحة '))}${verse.page}</span>`);
      }
      if (verse.has_rub_mark) {
        badges.push(`<span class="rub-vbadge rub-vbadge-rub">۞ ${this.esc(this.t('rub_badge_start', 'بداية ربع'))}</span>`);
      }
      if (verse.has_sajdah) {
        badges.push(`<span class="rub-vbadge rub-vbadge-sajdah">۩ ${this.esc(this.t('rub_badge_sajdah', 'سجدة'))}</span>`);
      }

      const stations = verse.segments.map((segment, index) => {
        const isLast = index === stationCount - 1;
        const revealed = !!this.revealed[segment.key];
        const revealLabel = revealed ? this.t('rub_hide_text', 'إخفاء') : this.t('rub_show_text', 'إظهار');
        const revealTitle = revealed
          ? this.t('rub_hide_station', 'إخفاء نص الموقف')
          : this.t('rub_reveal_station', 'إظهار نص الموقف');
        const stop = segment.stop
          ? `<span class="rub-stop-badge rub-stop-${this.esc(segment.stop)}">${this.stopGlyph(segment.stop)} ${this.esc(this.stopLabel(segment))}</span>`
          : (isLast
              ? `<span class="rub-stop-badge rub-stop-end">${this.esc(this.t('rub_stop_verse_end', 'نهاية الآية'))}</span>`
              : '');

        return `
          <div class="rub-station" data-key="${this.esc(segment.key)}" data-verse="${verseIndex}">
            <div class="rub-station-head">
              <span class="rub-station-no">${this.esc(this.t('rub_station', 'الموقف'))} ${index + 1}</span>
              <span class="rub-station-tools">
                ${stop}
                <button type="button" class="rub-reveal-btn" data-act="reveal" aria-pressed="${revealed ? 'true' : 'false'}" title="${this.esc(revealTitle)}" aria-label="${this.esc(revealTitle)}">
                  <svg class="rub-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <span class="rub-reveal-label">${this.esc(revealLabel)}</span>
                </button>
              </span>
            </div>
            <p class="rub-station-text ${revealed ? '' : 'is-blurred'}" lang="ar" dir="rtl">${this.esc(segment.text)}</p>
            <div class="rub-station-foot">
              <div class="rub-dots" aria-hidden="true">
                <span class="rub-dot"></span><span class="rub-dot"></span><span class="rub-dot"></span>
              </div>
              <span class="rub-rep-count">0 / 3</span>
              <button type="button" class="rub-reset-btn" data-act="reset" title="${this.esc(this.t('rub_reset_station', 'إعادة هذا الموقف'))}" aria-label="${this.esc(this.t('rub_reset_station', 'إعادة هذا الموقف'))}">↺</button>
            </div>
          </div>`;
      }).join('');

      return `
        <article class="rub-verse" data-verse-index="${verseIndex}">
          <header class="rub-verse-head">
            <div class="rub-verse-title">
              <span class="rub-verse-surah">${this.esc(surahName)}</span>
              <span class="rub-verse-ayah">${this.esc(ayahText)}</span>
            </div>
            <div class="rub-verse-badges">${badges.join('')}</div>
          </header>
          <div class="rub-stations">${stations}</div>
          ${this.renderTafsir(verse)}
        </article>`;
    }).join('');

    box.querySelectorAll('details.rub-tafsir').forEach((details) => {
      details.addEventListener('toggle', () => {
        const key = details.dataset.tafsirKey;
        if (key) this.tafsirOpen[key] = !!details.open;
      });
    });

    this.order.forEach((key) => this.paintStation(key));
    this.updateRevealAllButton();
  },

  tafsirForVerse(verse) {
    const ar = verse && verse.tafsir_ar ? String(verse.tafsir_ar).trim() : '';
    const en = verse && verse.tafsir_en ? String(verse.tafsir_en).trim() : '';
    const wantsEnglish = !!(window.I18N && I18N.lang === 'en');

    if (wantsEnglish) {
      if (en) return { text: en, lang: 'en', dir: 'ltr' };
      if (ar) return { text: ar, lang: 'ar', dir: 'rtl' };
    } else {
      if (ar) return { text: ar, lang: 'ar', dir: 'rtl' };
      if (en) return { text: en, lang: 'en', dir: 'ltr' };
    }

    return null;
  },

  renderTafsir(verse) {
    const tafsir = this.tafsirForVerse(verse);
    if (!tafsir) return '';

    const key = verse.surah + ':' + verse.ayah;
    const open = this.tafsirOpen[key] ? ' open' : '';
    const title = this.t('rub_tafsir_title', 'تفسير الآية');
    const source = this.t('rub_tafsir_source', 'المختصر في التفسير');

    return `
      <details class="rub-tafsir" data-tafsir-key="${this.esc(key)}"${open}>
        <summary class="rub-tafsir-summary">
          <svg class="rub-tafsir-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <span class="rub-tafsir-title">${this.esc(title)}</span>
          <span class="rub-tafsir-source">${this.esc(source)}</span>
          <svg class="rub-tafsir-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </summary>
        <div class="rub-tafsir-body" lang="${this.esc(tafsir.lang)}" dir="${this.esc(tafsir.dir)}">${this.esc(tafsir.text)}</div>
      </details>`;
  },

  stopGlyph(stop) {
    const map = {
      lazim: 'ۘ',
      qala: 'ۗ',
      muanaqah: 'ۛ',
      saktah: 'ۜ',
      salli: 'ۖ',
      la: 'ۙ',
      jaiz: 'ۚ',
    };
    return map[stop] || '';
  },

  stopLabel(segment) {
    if (window.I18N && I18N.lang === 'en' && segment.stop_en) {
      return segment.stop_en;
    }
    return segment.stop_ar || segment.stop || '';
  },

  stationEl(key) {
    return document.querySelector('.rub-station[data-key="' + this.cssEscape(key) + '"]');
  },

  cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  },

  paintStation(key) {
    const el = this.stationEl(key);
    if (!el) return;
    const reps = this.reps[key] || 0;
    const done = reps >= 3;

    el.classList.toggle('is-done', done);
    el.classList.toggle('is-active', key === this.activeKey);

    el.querySelectorAll('.rub-dot').forEach((dot, index) => {
      dot.classList.toggle('is-on', index < reps);
      dot.classList.toggle('is-done', done);
    });

    const count = el.querySelector('.rub-rep-count');
    if (count) count.textContent = reps + ' / 3';

    const revealed = !!this.revealed[key];
    const text = el.querySelector('.rub-station-text');
    if (text) text.classList.toggle('is-blurred', !revealed);

    const revealBtn = el.querySelector('.rub-reveal-btn');
    if (revealBtn) {
      const title = revealed
        ? this.t('rub_hide_station', 'إخفاء نص الموقف')
        : this.t('rub_reveal_station', 'إظهار نص الموقف');
      revealBtn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
      revealBtn.title = title;
      revealBtn.setAttribute('aria-label', title);
      const label = revealBtn.querySelector('.rub-reveal-label');
      if (label) {
        label.textContent = revealed
          ? this.t('rub_hide_text', 'إخفاء')
          : this.t('rub_show_text', 'إظهار');
      }
    }
  },

  toggleReveal(key) {
    if (!key) return;
    this.revealed[key] = !this.revealed[key];
    this.paintStation(key);
    this.updateRevealAllButton();
  },

  toggleAllReveal() {
    const allRevealed = this.order.length > 0 && this.order.every((key) => !!this.revealed[key]);
    const next = !allRevealed;
    this.order.forEach((key) => { this.revealed[key] = next; });
    this.order.forEach((key) => this.paintStation(key));
    this.updateRevealAllButton();
  },

  updateRevealAllButton() {
    const btn = document.getElementById('btn-toggle-all-reveal');
    if (!btn) return;
    const allRevealed = this.order.length > 0 && this.order.every((key) => !!this.revealed[key]);
    const label = allRevealed ? this.t('rub_hide_all', 'إخفاء الكل') : this.t('rub_show_all', 'إظهار الكل');
    btn.setAttribute('aria-pressed', allRevealed ? 'true' : 'false');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    const labelEl = document.getElementById('rub-reveal-all-label');
    if (labelEl) labelEl.textContent = label;
  },

  firstIncomplete() {
    for (const key of this.order) {
      if ((this.reps[key] || 0) < 3) return key;
    }
    return this.order.length ? this.order[this.order.length - 1] : null;
  },

  nextIncomplete(afterKey) {
    const start = Math.max(0, this.order.indexOf(afterKey));
    for (let i = start; i < this.order.length; i++) {
      if ((this.reps[this.order[i]] || 0) < 3) return this.order[i];
    }
    for (let i = 0; i < start; i++) {
      if ((this.reps[this.order[i]] || 0) < 3) return this.order[i];
    }
    return null;
  },

  refreshActive(scroll) {
    const completed = this.completedCount();
    const allDone = this.order.length > 0 && completed >= this.order.length;
    if (allDone) {
      this.activeKey = null;
    } else if (!this.activeKey || (this.reps[this.activeKey] || 0) >= 3) {
      this.activeKey = this.firstIncomplete();
    }

    this.order.forEach((key) => this.paintStation(key));

    if (scroll && this.activeKey) {
      const el = this.stationEl(this.activeKey);
      if (el) {
        const rect = el.getBoundingClientRect();
        const inView = rect.top >= 90 && rect.bottom <= (window.innerHeight - 110);
        if (!inView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    this.updateDock();
  },

  completedCount() {
    return this.order.reduce((sum, key) => sum + ((this.reps[key] || 0) >= 3 ? 1 : 0), 0);
  },

  updateProgress() {
    const total = this.order.length;
    const done = this.completedCount();
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const allDone = total > 0 && done >= total;

    const percentEl = document.getElementById('rub-percent');
    if (percentEl) percentEl.textContent = percent + '%';

    const ring = document.getElementById('rub-ring-fg');
    if (ring) {
      const c = 2 * Math.PI * 18;
      ring.style.strokeDasharray = String(c);
      ring.style.strokeDashoffset = String(c * (1 - percent / 100));
    }

    const hero = document.getElementById('rub-hero');
    if (hero) hero.classList.toggle('is-complete', allDone);

    const endCard = document.getElementById('rub-end-card');
    if (endCard) endCard.classList.toggle('hidden', !allDone);

    const step1 = document.getElementById('rub-step-1');
    const step2 = document.getElementById('rub-step-2');
    const step3 = document.getElementById('rub-step-3');
    if (step1) step1.classList.add('is-on');
    if (step2) step2.classList.toggle('is-on', percent > 0);
    if (step3) step3.classList.toggle('is-on', allDone);

    const mainBtn = document.getElementById('btn-add-rep');
    if (mainBtn) mainBtn.disabled = allDone;

    const mainLabel = document.querySelector('.rub-main-label');
    if (mainLabel) {
      mainLabel.textContent = allDone
        ? this.t('rub_all_done', 'تم تثبيت الربع')
        : this.t('rub_repeat_btn', 'كرّر الموقف');
    }

    const mainCount = document.getElementById('rub-main-count');
    if (mainCount) {
      if (allDone) {
        mainCount.textContent = '✓';
      } else if (this.activeKey) {
        const reps = this.reps[this.activeKey] || 0;
        mainCount.textContent = (reps + 1) + ' / 3';
      } else {
        mainCount.textContent = '';
      }
    }

    this.updateDock();

    if (!allDone) {
      this.completedShown = false;
    } else if (!this.completedShown) {
      this.completedShown = true;
      this.celebrate();
    }
  },

  updateDock() {
    const total = this.order.length;
    const done = this.completedCount();

    const count = document.getElementById('rub-dock-count');
    if (count) {
      count.textContent = done + ' / ' + total;
    }

    const next = document.getElementById('rub-dock-next');
    if (next) {
      if (total > 0 && done >= total) {
        next.textContent = this.t('rub_dock_done', 'أتممت كل المواقف');
      } else if (this.activeKey && this.stationMeta[this.activeKey]) {
        const meta = this.stationMeta[this.activeKey];
        next.textContent =
          this.t('rub_dock_next', 'التالي') + ': ' +
          this.refLabel(meta.verse.surah, meta.verse.ayah) + ' · ' +
          this.t('rub_station', 'الموقف') + ' ' + ((meta.segment.index || 0) + 1);
      } else {
        next.textContent = '';
      }
    }

    const mainCount = document.getElementById('rub-main-count');
    if (mainCount && this.activeKey && (this.reps[this.activeKey] || 0) < 3) {
      mainCount.textContent = ((this.reps[this.activeKey] || 0) + 1) + ' / 3';
    }
  },

  /* ---------------- Actions ---------------- */

  addRep(key) {
    const target = key || this.activeKey;
    if (!target) return;
    if ((this.reps[target] || 0) >= 3) return;

    this.reps[target] = (this.reps[target] || 0) + 1;
    this.history.push(target);

    this.paintStation(target);
    this.persistLocal();

    const justCompleted = this.reps[target] >= 3;
    if (justCompleted) {
      if (window.AudioEngine) AudioEngine.playSuccess();
      const next = this.nextIncomplete(target);
      this.activeKey = next || target;
    }

    // Bring the next station into view once this one is finished.
    this.refreshActive(justCompleted);
    this.updateProgress();
    this.scheduleSync();
  },

  resetStation(key) {
    if (!key) return;
    if ((this.reps[key] || 0) === 0) return;
    this.reps[key] = 0;
    this.history = this.history.filter((item) => item !== key);
    this.persistLocal();
    this.paintStation(key);
    this.activeKey = key;
    this.refreshActive(true);
    this.updateProgress();
    this.scheduleSync();
  },

  undoLast() {
    const key = this.history.pop();
    if (!key) {
      showToast(this.t('rub_nothing_to_undo', 'لا يوجد تكرار للتراجع عنه'));
      return;
    }
    if ((this.reps[key] || 0) > 0) {
      this.reps[key] = (this.reps[key] || 0) - 1;
    }
    if (window.AudioEngine) AudioEngine.playUndo();
    this.persistLocal();
    this.paintStation(key);
    this.activeKey = key;
    this.refreshActive(true);
    this.updateProgress();
    this.scheduleSync();
  },

  resetAll() {
    const ok = window.confirm(this.t('rub_reset_confirm', 'هل تريد إعادة ضبط الربع كاملاً والبدء من جديد؟'));
    if (!ok) return;

    this.order.forEach((key) => { this.reps[key] = 0; });
    this.revealed = {};
    this.history = [];
    this.completedShown = false;
    try {
      localStorage.removeItem('hifz-rub-celebrated-' + this.taskId);
    } catch (e) {}
    this.persistLocal();
    this.order.forEach((key) => this.paintStation(key));
    this.updateRevealAllButton();
    this.activeKey = this.firstIncomplete();
    this.refreshActive(true);
    this.updateProgress();
    this.syncNow();
  },

  celebrate() {
    const modal = document.getElementById('rub-complete-modal');
    if (!modal) return;

    try {
      const seen = localStorage.getItem('hifz-rub-celebrated-' + this.taskId);
      if (seen === this.taskDate) return;
      localStorage.setItem('hifz-rub-celebrated-' + this.taskId, this.taskDate);
    } catch (e) {}

    if (window.AudioEngine) AudioEngine.playCelebration();

    const desc = document.getElementById('rub-complete-desc');
    if (desc) {
      desc.textContent =
        this.t('rub_complete_desc', 'أتممت تكرار كل موقف ثلاث مرات في ربع اليوم. تقبّل الله منك.') +
        ' ' + (this.t('rub_quarter_label', 'الربع') + ' ' + this.rub.id) + '.';
    }
    const stations = document.getElementById('rub-complete-stations');
    if (stations) stations.textContent = this.order.length;
    const verses = document.getElementById('rub-complete-verses');
    if (verses) verses.textContent = this.rub.verse_count;

    modal.classList.remove('hidden');
  },

  closeComplete() {
    const modal = document.getElementById('rub-complete-modal');
    if (modal) modal.classList.add('hidden');
  },

  /* ---------------- Sync ---------------- */

  completedList() {
    return this.order.filter((key) => (this.reps[key] || 0) >= 3);
  },

  scheduleSync() {
    if (!this.taskId) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.syncNow(), 650);
  },

  async syncNow() {
    if (!this.taskId) return;
    if (this.saving) {
      this.queued = true;
      return;
    }

    const payload = { task_id: this.taskId, completed: this.completedList() };
    this.saving = true;

    try {
      const res = await API.call('tasks/update_rub.php', {
        method: 'POST',
        body: payload,
        redirectOn401: true,
      });
      this.offlineNotified = false;
      if (res && res.is_completed) {
        this.taskCompletedOnServer = true;
      }
      this.removeFromQueue(this.taskId);
    } catch (err) {
      if (err && err.status === 401) return;
      this.enqueue(payload);
      if (!this.offlineNotified) {
        this.offlineNotified = true;
        showToast(this.t('rub_offline_saved', 'تم الحفظ محليًا — ستتم المزامنة عند عودة الاتصال'), true);
      }
    } finally {
      this.saving = false;
      if (this.queued) {
        this.queued = false;
        this.scheduleSync();
      }
    }
  },

  queueKey() {
    return 'hifz-rub-queue-v1';
  },

  readQueue() {
    try {
      const raw = localStorage.getItem(this.queueKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  writeQueue(queue) {
    try {
      localStorage.setItem(this.queueKey(), JSON.stringify(queue));
    } catch (e) {}
  },

  enqueue(payload) {
    const queue = this.readQueue();
    queue[String(payload.task_id)] = payload;
    this.writeQueue(queue);
  },

  removeFromQueue(taskId) {
    const queue = this.readQueue();
    delete queue[String(taskId)];
    this.writeQueue(queue);
  },

  async flushQueue() {
    if (!navigator.onLine) return;
    const queue = this.readQueue();
    const ids = Object.keys(queue);
    if (!ids.length) return;

    for (const id of ids) {
      try {
        await API.call('tasks/update_rub.php', {
          method: 'POST',
          body: queue[id],
          redirectOn401: true,
        });
        delete queue[id];
        this.writeQueue(queue);
      } catch (e) {
        // A deleted task (plan change / account reset) can never be synced.
        if (e && e.status === 404) {
          delete queue[id];
          this.writeQueue(queue);
          continue;
        }
        break;
      }
    }
  },

  bindUI() {
    document.addEventListener('click', (event) => {
      const revealBtn = event.target.closest ? event.target.closest('.rub-reveal-btn') : null;
      if (revealBtn) {
        const station = revealBtn.closest('.rub-station');
        if (station) {
          event.preventDefault();
          event.stopPropagation();
          this.toggleReveal(station.dataset.key);
        }
        return;
      }

      const resetBtn = event.target.closest ? event.target.closest('.rub-reset-btn') : null;
      if (resetBtn) {
        const station = resetBtn.closest('.rub-station');
        if (station) {
          event.preventDefault();
          event.stopPropagation();
          this.resetStation(station.dataset.key);
        }
        return;
      }

      const station = event.target.closest ? event.target.closest('.rub-station') : null;
      if (station) {
        this.addRep(station.dataset.key);
      }
    });

    const addBtn = document.getElementById('btn-add-rep');
    if (addBtn) {
      addBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.addRep(this.activeKey);
      });
    }

    const undoBtn = document.getElementById('btn-undo-rep');
    if (undoBtn) {
      undoBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.undoLast();
      });
    }

    const resetAll = document.getElementById('btn-reset-rub');
    if (resetAll) resetAll.addEventListener('click', () => this.resetAll());

    const revealAll = document.getElementById('btn-toggle-all-reveal');
    if (revealAll) {
      revealAll.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleAllReveal();
      });
    }

    const closeComplete = document.getElementById('btn-rub-close-complete');
    if (closeComplete) closeComplete.addEventListener('click', () => this.closeComplete());

    const modal = document.getElementById('rub-complete-modal');
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) this.closeComplete();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeComplete();
    });

    window.addEventListener('online', async () => {
      await this.flushQueue();
      if (this.taskId) this.syncNow();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.syncNow();
    });

    window.addEventListener('beforeunload', () => {
      if (!this.taskId) return;
      const payload = { task_id: this.taskId, completed: this.completedList() };
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('../api/tasks/update_rub.php', blob);
      } catch (e) {}
    });

    if (window.I18N) {
      I18N.onChange(() => {
        if (this.rub) this.render();
      });
    }
  },
};

window.RubPage = RubPage;

document.addEventListener('DOMContentLoaded', () => {
  RubPage.boot();
});
