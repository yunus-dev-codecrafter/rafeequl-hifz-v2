'use strict';

/* ==========================================================================
   Rafeequl Hifz — Rub' Consolidation session controller (v13)

   Runs the five core revision exercises plus the three optional advanced
   challenges inside the existing rub' page:
     • server-generated plan, client-side rendering + first-attempt validation;
     • immediate local persistence and a small offline retry queue;
     • resume from any device because the server stores every result;
     • summary, weak-item review and spaced-repetition hand-off.

   The legacy one-verse arrangement flow remains untouched in js/rub.js.
   ========================================================================== */

(function () {
  const CACHE_PREFIX = 'hifz-rub-session-v1-';
  const TAB_KEY = 'hifz-rub-tab-v1';
  const SAVE_DELAY = 450;

  const EXERCISE_META = [
    {
      key: 'WORD_ORDER',
      titleKey: 'rub_ex_wo_title',
      title: 'ترتيب الكلمات',
      subKey: 'rub_ex_wo_setup',
      sub: 'رتّب كلمات الآية بالضغط عليها بالترتيب.',
    },
    {
      key: 'MISSING_WORDS',
      titleKey: 'rub_ex_mw_title',
      title: 'الكلمات الناقصة',
      subKey: 'rub_ex_mw_setup',
      sub: 'اكتب الكلمات المخفية أو اخترها من البنك.',
    },
    {
      key: 'CONTINUE_AYAH',
      titleKey: 'rub_ex_ca_title',
      title: 'أكمل الآية',
      subKey: 'rub_ex_ca_setup',
      sub: 'اختر الآية التالية الصحيحة أو رتّب كلماتها.',
    },
    {
      key: 'MUTASHABIHAT',
      titleKey: 'rub_ex_mt_title',
      title: 'الآيات المتشابهة',
      subKey: 'rub_ex_mt_setup',
      sub: 'ميّز الآية الصحيحة من بين آيتين متشابهتين.',
    },
    {
      key: 'PROGRESSIVE_HIDE',
      titleKey: 'rub_ex_ph_title',
      title: 'التدرج في الإخفاء',
      subKey: 'rub_ex_ph_setup',
      sub: 'أخفِ الكلمات تدريجياً وسمّع الآية من حفظك.',
    },
    {
      key: 'RANDOM_START',
      titleKey: 'rub_ex_rs_title',
      title: 'بداية عشوائية',
      subKey: 'rub_ex_rs_setup',
      sub: 'سمّع من آية عشوائية دون معاينة النص، واختر طول المتابعة.',
    },
    {
      key: 'INTERRUPT',
      titleKey: 'rub_ex_int_title',
      title: 'التوقف المفاجئ',
      subKey: 'rub_ex_int_setup',
      sub: 'أكمل الآية من موضع توقف في أولها أو وسطها أو آخرها.',
    },
    {
      key: 'CONNECTION',
      titleKey: 'rub_ex_cn_title',
      title: 'ربط الآيات والمتشابهات',
      subKey: 'rub_ex_cn_setup',
      sub: 'اربط نهاية الآية ببداية التالية، وميّز المتشابهات الموثقة.',
    },
  ];

  // Retired challenges remain readable in old sessions/results. They are never
  // offered in the new-session setup and are not part of advanced mode.
  const LEGACY_EXERCISE_META = [
    {
      key: 'REVERSE',
      titleKey: 'rub_ex_rv_title',
      title: 'التراجع العكسي',
      subKey: 'rub_ex_rv_setup',
      sub: 'من الآية الحالية، اختر الآية التي تسبقها.',
    },
    {
      key: 'ERROR_DETECT',
      titleKey: 'rub_ex_ed_title',
      title: 'اكتشاف الخطأ',
      subKey: 'rub_ex_ed_setup',
      sub: 'حدّد الكلمة المحرّفة في نص معدّل للاختبار.',
    },
    {
      key: 'NO_PREVIEW',
      titleKey: 'rub_ex_np_title',
      title: 'التسميع بدون معاينة',
      subKey: 'rub_ex_np_setup',
      sub: 'سمّع من الذاكرة مع تسجيل يدوي للمقارنة.',
    },
  ];

  const CORE_EXERCISES = ['WORD_ORDER', 'MISSING_WORDS', 'CONTINUE_AYAH', 'MUTASHABIHAT', 'PROGRESSIVE_HIDE'];
  const ADVANCED_EXERCISES = ['RANDOM_START', 'INTERRUPT', 'CONNECTION'];
  const ALL_EXERCISES = EXERCISE_META.map((item) => item.key);
  const ADVANCED_MODE_EXERCISES = CORE_EXERCISES.concat(ADVANCED_EXERCISES);
  const LEGACY_EXERCISES = LEGACY_EXERCISE_META.map((item) => item.key);
  const KNOWN_EXERCISES = ALL_EXERCISES.concat(LEGACY_EXERCISES);
  const META_BY_KEY = EXERCISE_META.concat(LEGACY_EXERCISE_META).reduce((map, item) => {
    map[item.key] = item;
    return map;
  }, {});

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function uniqueInts(values) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
    return out;
  }

  const RubSession = {
    page: null,
    state: null,
    session: null,
    plan: null,
    exercises: [],
    exerciseIndex: 0,
    itemIndex: 0,
    answers: {},
    itemStates: {},
    pending: [],
    settings: {
      difficulty: 'INTERMEDIATE',
      exercises: CORE_EXERCISES.slice(),
      sample_size: 6,
      allow_outside_rub: true,
      focus: 'ALL',
    },
    loading: false,
    saving: false,
    finishing: false,
    startedAt: 0,
    activeTab: 'session',
    bound: false,
    loaded: false,
    attachedTaskId: 0,
    saveTimer: null,
    offline: false,
    schemaMissing: false,
    lastSummary: null,
    els: {},

    /* ------------------------------------------------------------------
     * Boot / wiring
     * --------------------------------------------------------------- */
    attach(page) {
      this.page = page || this.page;
      if (!this.bound) {
        this.loading = true;
        this.bind();
        this.bound = true;
      }
      const taskId = this.taskId();
      if (!taskId) return;
      if (this.attachedTaskId === taskId && this.loaded) return;
      this.attachedTaskId = taskId;
      this.loaded = true;
      this.restoreTab();
      this.loadState();
    },

    bind() {
      const $ = (id) => document.getElementById(id);
      this.els = {
        alert: $('rub-session-alert'),
        setup: $('rub-session-setup'),
        active: $('rub-session-active'),
        summary: $('rub-session-summary'),
        dueBadge: $('rub-session-due-badge'),
        difficulty: $('rub-session-difficulty'),
        sample: $('rub-session-sample'),
        exercises: $('rub-session-exercises'),
        outside: $('rub-session-outside'),
        advanced: $('rub-session-advanced'),
        start: $('rub-session-start'),
        resume: $('rub-session-resume'),
        weak: $('rub-session-weak'),
        last: $('rub-session-last'),
        title: $('rub-session-title'),
        sub: $('rub-session-sub'),
        percent: $('rub-session-percent'),
        count: $('rub-session-count'),
        bar: $('rub-session-bar'),
        steps: $('rub-session-steps'),
        stage: $('rub-session-stage'),
        prev: $('rub-session-prev'),
        check: $('rub-session-check'),
        next: $('rub-session-next'),
        skip: $('rub-session-skip'),
        pause: $('rub-session-pause'),
        sessionPanel: $('rub-session-panel'),
        practicePanel: $('rub-practice-panel'),
        dock: $('rub-dock'),
      };

      document.querySelectorAll('[data-rub-tab]').forEach((button) => {
        button.addEventListener('click', () => this.switchTab(button.dataset.rubTab));
      });

      if (this.els.difficulty) {
        this.els.difficulty.addEventListener('click', (event) => {
          const button = event.target.closest('[data-difficulty]');
          if (!button) return;
          this.settings.difficulty = button.dataset.difficulty;
          if (this.settings.difficulty === 'ADVANCED') {
            this.settings.exercises = ADVANCED_MODE_EXERCISES.slice();
          } else {
            const kept = this.settings.exercises.filter((key) => CORE_EXERCISES.includes(key));
            this.settings.exercises = kept.length ? kept : CORE_EXERCISES.slice();
          }
          this.applySettingsToControls();
        });
      }

      if (this.els.advanced) {
        this.els.advanced.addEventListener('change', () => {
          if (this.els.advanced.checked) {
            this.settings.difficulty = 'ADVANCED';
            this.settings.exercises = ADVANCED_MODE_EXERCISES.slice();
          } else {
            if (this.settings.difficulty === 'ADVANCED') this.settings.difficulty = 'INTERMEDIATE';
            const kept = this.settings.exercises.filter((key) => CORE_EXERCISES.includes(key));
            this.settings.exercises = kept.length ? kept : CORE_EXERCISES.slice();
          }
          this.applySettingsToControls();
        });
      }

      if (this.els.sample) {
        this.els.sample.addEventListener('click', (event) => {
          const button = event.target.closest('[data-size]');
          if (!button) return;
          const size = Number(button.dataset.size);
          this.settings.sample_size = [4, 6, 8, 999].includes(size) ? size : 6;
          this.applySettingsToControls();
        });
      }

      if (this.els.exercises) {
        this.els.exercises.addEventListener('change', () => {
          const checked = Array.from(this.els.exercises.querySelectorAll('input[type="checkbox"]:checked'))
            .map((input) => input.value)
            .filter((key) => ALL_EXERCISES.includes(key));
          this.settings.exercises = checked;
          this.applySettingsToControls();
        });
      }

      if (this.els.outside) {
        this.els.outside.addEventListener('change', () => {
          this.settings.allow_outside_rub = !!this.els.outside.checked;
        });
      }

      if (this.els.start) this.els.start.addEventListener('click', () => this.start({ force: true }));
      if (this.els.resume) this.els.resume.addEventListener('click', () => this.resume());
      if (this.els.weak) {
        this.els.weak.addEventListener('click', () => {
          if (!this.hasWeak()) {
            this.toast(this.t('rub_session_no_weak', {}, 'لا توجد آيات أو كلمات ضعيفة مسجلة بعد'), true);
            return;
          }
          this.start({ focus: 'WEAK', force: true });
        });
      }

      if (this.els.prev) this.els.prev.addEventListener('click', () => this.prev());
      if (this.els.check) this.els.check.addEventListener('click', () => this.check());
      if (this.els.next) this.els.next.addEventListener('click', () => this.next());
      if (this.els.skip) this.els.skip.addEventListener('click', () => this.skip());
      if (this.els.pause) this.els.pause.addEventListener('click', () => this.pause());

      if (this.els.stage) {
        this.els.stage.addEventListener('click', (event) => this.onStageClick(event));
        this.els.stage.addEventListener('input', (event) => this.onStageInput(event));
        this.els.stage.addEventListener('focusin', (event) => this.onStageFocus(event));
        this.els.stage.addEventListener('keydown', (event) => this.onStageKeydown(event));
      }

      if (this.els.summary) {
        this.els.summary.addEventListener('click', (event) => this.onSummaryClick(event));
      }

      window.addEventListener('online', () => this.onOnline());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.writeCache();
          this.flush().catch(() => {});
        }
      });
      window.addEventListener('beforeunload', () => this.onBeforeUnload());

      if (window.I18N && typeof I18N.onChange === 'function') {
        I18N.onChange(() => this.rerender());
      }

      // Render the default setup immediately; loadState() will replace it with
      // the user's saved settings once the server responds.
      this.renderExerciseToggles();
      this.applySettingsToControls();
    },

    rerender() {
      if (this.session && this.session.status === 'IN_PROGRESS' && !this.els.active.classList.contains('hidden')) {
        this.renderActive();
      } else if (this.lastSummary && !this.els.summary.classList.contains('hidden')) {
        this.renderSummary(this.lastSummary.session, this.lastSummary.state);
      } else {
        this.renderExerciseToggles();
        this.applySettingsToControls();
        this.renderHome();
      }
    },

    /* ------------------------------------------------------------------
     * Small helpers
     * --------------------------------------------------------------- */
    t(key, params, fallback) {
      if (this.page && typeof this.page.t === 'function') return this.page.t(key, params, fallback);
      if (window.I18N && typeof I18N.t === 'function') {
        const value = I18N.t(key, params || {});
        if (value != null && value !== key) return value;
      }
      return fallback != null ? fallback : key;
    },

    esc(value) {
      if (this.page && typeof this.page.esc === 'function') return this.page.esc(value);
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    refLabel(surah, ayah) {
      if (this.page && typeof this.page.refLabel === 'function') return this.page.refLabel(surah, ayah);
      return Number(surah) + ':' + Number(ayah);
    },

    refFromKey(key) {
      const parts = String(key || '').split(':');
      return this.refLabel(Number(parts[0]) || 0, Number(parts[1]) || 0);
    },

    isEnglish() {
      return !!(this.page && typeof this.page.isEnglish === 'function' && this.page.isEnglish());
    },

    taskId() {
      if (!this.page) return 0;
      return Number(this.page.taskId || (this.page.task && this.page.task.id) || 0) || 0;
    },

    toast(message, isError) {
      if (typeof window.showToast === 'function') {
        window.showToast(message, !!isError);
      }
    },

    showAlert(message, isInfo) {
      if (!this.els.alert) return;
      if (!message) {
        this.els.alert.classList.add('hidden');
        this.els.alert.textContent = '';
        return;
      }
      this.els.alert.textContent = message;
      this.els.alert.classList.remove('hidden');
      this.els.alert.classList.toggle('is-info', !!isInfo);
      if (isInfo) {
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => this.showAlert(''), 6000);
      }
    },

    setHeroStep(step) {
      [1, 2, 3].forEach((n) => {
        const el = document.getElementById('rub-step-' + n);
        if (el) el.classList.toggle('is-on', n === step);
      });
    },

    setRing(percent) {
      const safe = clamp(Number(percent) || 0, 0, 100);
      const percentEl = document.getElementById('rub-percent');
      if (percentEl) percentEl.textContent = Math.round(safe) + '%';
      const ring = document.getElementById('rub-ring-fg');
      if (ring) {
        const c = 2 * Math.PI * 18;
        ring.style.strokeDasharray = String(c);
        ring.style.strokeDashoffset = String(c * (1 - safe / 100));
      }
    },

    syncHeroProgress() {
      if (this.session && this.session.status === 'IN_PROGRESS') {
        const total = this.requiredTotal();
        const done = this.answeredRequiredCount();
        this.setRing(total > 0 ? (done / total) * 100 : 0);
        return;
      }
      if (this.session && this.session.status === 'COMPLETED') {
        this.setRing(100);
        return;
      }
      if (this.state && this.state.last_session && this.state.last_session.status === 'COMPLETED') {
        this.setRing(100);
        return;
      }
      if (this.page && typeof this.page.updateProgress === 'function') {
        this.page.updateProgress();
      }
    },

    /* ------------------------------------------------------------------
     * Settings
     * --------------------------------------------------------------- */
    applySettings(settings) {
      const incoming = settings && typeof settings === 'object' ? settings : {};
      const difficulty = String(incoming.difficulty || this.settings.difficulty || 'INTERMEDIATE').toUpperCase();
      this.settings.difficulty = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(difficulty)
        ? difficulty
        : 'INTERMEDIATE';

      const exercises = Array.isArray(incoming.exercises)
        ? incoming.exercises.filter((key) => ALL_EXERCISES.includes(key))
        : [];
      this.settings.exercises = exercises.length ? exercises : CORE_EXERCISES.slice();

      const size = Number(incoming.sample_size);
      this.settings.sample_size = [4, 6, 8, 999].includes(size) ? size : 6;
      this.settings.allow_outside_rub = incoming.allow_outside_rub == null
        ? true
        : !!incoming.allow_outside_rub;
      const focus = String(incoming.focus || 'ALL').toUpperCase();
      this.settings.focus = focus === 'WEAK' ? 'WEAK' : 'ALL';
    },

    renderExerciseToggles() {
      if (!this.els.exercises) return;
      const selected = new Set(this.settings.exercises);
      this.els.exercises.innerHTML = EXERCISE_META.map((meta) => {
        const checked = selected.has(meta.key);
        return '<label class="rub-exercise-toggle">' +
          '<input type="checkbox" value="' + this.esc(meta.key) + '"' + (checked ? ' checked' : '') + '>' +
          '<span><span>' + this.esc(this.t(meta.titleKey, {}, meta.title)) + '</span>' +
          '<small>' + this.esc(this.t(meta.subKey, {}, meta.sub)) + '</small></span>' +
          '</label>';
      }).join('');
    },

    applySettingsToControls() {
      if (this.els.difficulty) {
        this.els.difficulty.querySelectorAll('[data-difficulty]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.difficulty === this.settings.difficulty);
        });
      }
      if (this.els.sample) {
        this.els.sample.querySelectorAll('[data-size]').forEach((button) => {
          button.classList.toggle('is-active', Number(button.dataset.size) === this.settings.sample_size);
        });
      }
      if (this.els.outside) this.els.outside.checked = !!this.settings.allow_outside_rub;
      if (this.els.advanced) {
        const selected = new Set(this.settings.exercises);
        this.els.advanced.checked = this.settings.difficulty === 'ADVANCED' &&
          ADVANCED_MODE_EXERCISES.every((key) => selected.has(key));
      }
      if (this.els.exercises) {
        const selected = new Set(this.settings.exercises);
        this.els.exercises.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = selected.has(input.value);
        });
      }
      if (this.els.start) {
        this.els.start.disabled = !!this.schemaMissing || !!this.loading || !this.settings.exercises.length;
        this.els.start.textContent = this.loading
          ? this.t('rub_session_preparing', {}, 'جارٍ التجهيز…')
          : this.t('rub_session_start', {}, 'ابدأ الجلسة');
      }
      if (this.els.weak) {
        this.els.weak.disabled = !!this.schemaMissing || !!this.loading;
      }
      if (this.els.difficulty) {
        this.els.difficulty.querySelectorAll('button').forEach((button) => {
          button.disabled = !!this.schemaMissing || !!this.loading;
        });
      }
      if (this.els.sample) {
        this.els.sample.querySelectorAll('button').forEach((button) => {
          button.disabled = !!this.schemaMissing || !!this.loading;
        });
      }
    },

    /* ------------------------------------------------------------------
     * Server state / cache
     * --------------------------------------------------------------- */
    cacheKey() {
      const id = this.taskId();
      return id ? CACHE_PREFIX + id : '';
    },

    readCache() {
      try {
        const key = this.cacheKey();
        if (!key) return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (e) {
        return null;
      }
    },

    writeCache() {
      try {
        const key = this.cacheKey();
        if (!key) return;
        if (!this.session && !this.state) {
          localStorage.removeItem(key);
          return;
        }
        localStorage.setItem(key, JSON.stringify({
          state: this.state,
          session: this.session,
          answers: this.answers,
          pending: this.pending,
          settings: this.settings,
          startedAt: this.startedAt,
          savedAt: Date.now(),
        }));
      } catch (e) {
        // Private mode / quota: the session still works in memory.
      }
    },

    clearCache() {
      try {
        const key = this.cacheKey();
        if (key) localStorage.removeItem(key);
      } catch (e) {}
    },

    async loadState() {
      const taskId = this.taskId();
      if (!taskId) return;
      this.loading = true;
      this.applySettingsToControls();
      try {
        const data = await API.call('tasks/rub_session.php?task_id=' + encodeURIComponent(taskId), {
          redirectOn401: true,
        });
        this.state = data || null;
        this.schemaMissing = false;
        this.offline = false;
        this.applySettings((data && data.settings) || {});
        this.renderExerciseToggles();
        this.applySettingsToControls();
        this.renderHome();
        if (data && data.active_session) {
          this.beginSession(data.active_session, (data && data.settings) || {});
          this.mergeCachedPending(data.active_session);
        } else {
          this.session = null;
          this.showSetup();
          this.renderHome();
        }
      } catch (err) {
        if (err && err.status === 401) return;
        const payload = err && err.data ? err.data : null;
        if (payload && payload.code === 'schema_missing') {
          this.schemaMissing = true;
          this.showAlert(
            payload.error || this.t('rub_session_schema_missing', {}, 'جداول جلسة التثبيت غير مثبتة بعد. شغّل migrate.php ثم أعد تحميل الصفحة.'),
            false
          );
          this.applySettingsToControls();
          this.renderExerciseToggles();
          this.renderHome();
          return;
        }

        this.offline = true;
        const cached = this.readCache();
        if (cached && cached.session && cached.session.id) {
          this.state = cached.state || null;
          this.session = cached.session;
          this.plan = cached.session.plan || {};
          this.exercises = Array.isArray(cached.session.exercises) && cached.session.exercises.length
            ? cached.session.exercises
            : this.settings.exercises.slice();
          this.answers = cached.answers && typeof cached.answers === 'object' ? cached.answers : {};
          this.pending = Array.isArray(cached.pending) ? cached.pending : [];
          this.startedAt = Number(cached.startedAt) || Date.now();
          this.itemStates = {};
          Object.keys(this.answers).forEach((key) => this.applyServerResult(this.answers[key]));
          this.applySettings(cached.settings || this.settings);
          this.renderExerciseToggles();
          this.applySettingsToControls();
          this.showActive();
          this.renderActive();
          this.toast(this.t('rub_session_offline', {}, 'أنت غير متصل — تم فتح الجلسة المحفوظة على جهازك'), true);
          return;
        }

        this.showAlert(
          this.t('rub_session_load_error', {}, 'تعذر تحميل جلسة التثبيت. تحقق من الاتصال ثم حدّث الصفحة.'),
          false
        );
        this.renderExerciseToggles();
        this.applySettingsToControls();
        this.renderHome();
      } finally {
        this.loading = false;
        this.applySettingsToControls();
      }
    },

    mergeCachedPending(session) {
      const cached = this.readCache();
      if (!cached || !cached.session || Number(cached.session.id) !== Number(session.id)) return;
      if (Number(cached.startedAt)) this.startedAt = Number(cached.startedAt);
      const pending = Array.isArray(cached.pending) ? cached.pending : [];
      const known = new Set(Object.keys(this.answers));
      pending.forEach((result) => {
        const key = result.exercise + ':' + result.item_id;
        if (known.has(key)) return;
        this.pending.push(result);
        this.answers[key] = result;
        this.applyServerResult(result);
        known.add(key);
      });
      if (this.pending.length) {
        this.writeCache();
        this.scheduleSave();
      }
    },

    /* ------------------------------------------------------------------
     * Setup screen
     * --------------------------------------------------------------- */
    renderHome(forceSetup) {
      const stats = (this.state && this.state.stats) || {};
      const due = Number(stats.due_count) || 0;
      const weakCount = Array.isArray(stats.weak_verses) ? stats.weak_verses.length : 0;
      if (this.els.dueBadge) {
        const label = due > 0
          ? this.t('rub_session_due_count', { count: due }, 'آية مستحقة')
          : this.t('rub_session_due_none', {}, 'لا مستحق');
        this.els.dueBadge.innerHTML = '<strong>' + this.esc(due > 0 ? String(due) : '✓') + '</strong>' +
          '<small>' + this.esc(label) + '</small>';
        this.els.dueBadge.title = this.t('rub_session_due_title', { count: weakCount }, 'آيات تحتاج مراجعة: {count}');
      }

      const hasActive = !!(this.session && this.session.status === 'IN_PROGRESS') ||
        !!(this.state && this.state.active_session && this.state.active_session.status === 'IN_PROGRESS');
      if (this.els.resume) {
        this.els.resume.classList.toggle('hidden', !hasActive);
        if (hasActive) {
          const s = this.session || this.state.active_session;
          const done = Number(s.answered_items) || this.answeredRequiredCount();
          const total = Number(s.total_items) || this.requiredTotal();
          this.els.resume.textContent = this.t('rub_session_resume_progress', { done: done, total: total }, 'متابعة الجلسة ({done}/{total})');
        }
      }

      if (this.els.weak) {
        const hasWeak = this.hasWeak();
        this.els.weak.classList.toggle('hidden', !hasWeak);
        this.els.weak.disabled = !!this.schemaMissing || !!this.loading;
      }

      if (this.els.last) {
        const last = this.state && this.state.last_session;
        const mastery = stats.mastery && typeof stats.mastery === 'object' ? stats.mastery : null;
        const masteryStatus = mastery ? String(mastery.status || '') : '';
        const showMastery = mastery && masteryStatus !== 'NOT_STARTED';
        if ((last && last.status === 'COMPLETED') || showMastery) {
          const accuracy = last && last.status === 'COMPLETED' ? Number(last.accuracy) || 0 : 0;
          const when = last ? this.formatDate(last.completed_at || last.updated_at || '') : '';
          const duration = last ? this.formatDuration(last.duration_seconds || 0) : '';
          const labels = {
            MASTERED: this.t('rub_mastery_mastered', {}, 'متقن تراكمياً'),
            DEVELOPING: this.t('rub_mastery_developing', {}, 'قيد التثبيت'),
            NEEDS_REVIEW: this.t('rub_mastery_needs_review', {}, 'يحتاج إعادة'),
          };
          const masteryLine = showMastery
            ? '<div class="rub-session-last-grid">' +
              '<span>' + this.esc(this.t('rub_session_mastery_status', { status: labels[masteryStatus] || masteryStatus }, 'الإتقان التراكمي: {status}')) + '</span>' +
              '<span>' + this.esc(this.t('rub_mastery_sessions_progress', {
                done: Number(mastery.qualified_sessions) || 0,
                required: Number(mastery.required_sessions) || 3,
              }, 'الجلسات المؤهلة: {done}/{required}')) + '</span>' +
              (mastery.next_review_at
                ? '<span>' + this.esc(this.t('rub_mastery_next_review', { date: mastery.next_review_at }, 'المراجعة الدورية: {date}')) + '</span>'
                : '') +
              '</div>'
            : '';
          this.els.last.classList.remove('hidden');
          this.els.last.innerHTML =
            (last && last.status === 'COMPLETED'
              ? '<div><strong>' + this.esc(this.t('rub_session_last_title', {}, 'آخر جلسة مكتملة')) + '</strong></div>' +
                '<div class="rub-session-last-grid">' +
                '<span>' + this.esc(this.t('rub_session_last_when', { date: when }, 'التاريخ: {date}')) + '</span>' +
                '<span>' + this.esc(this.t('rub_session_last_accuracy', { percent: accuracy }, 'الدقة: {percent}%')) + '</span>' +
                '<span>' + this.esc(this.t('rub_session_last_time', { time: duration }, 'الوقت: {time}')) + '</span>' +
                '<span>' + this.esc(this.t('rub_session_last_attempt', { n: last.attempt_no || 1 }, 'المحاولة: {n}')) + '</span>' +
                '</div>'
              : '') + masteryLine;
        } else {
          this.els.last.classList.add('hidden');
          this.els.last.innerHTML = '';
        }
      }

      this.applySettingsToControls();
      if (!forceSetup && this.session && this.session.status === 'IN_PROGRESS') {
        this.showActive();
      } else {
        this.showSetup();
      }
    },

    showSetup() {
      if (this.els.setup) this.els.setup.classList.remove('hidden');
      if (this.els.active) this.els.active.classList.add('hidden');
      if (this.els.summary) this.els.summary.classList.add('hidden');
      this.setHeroStep(1);
      this.syncHeroProgress();
    },

    hasWeak() {
      const stats = (this.state && this.state.stats) || {};
      return !!stats.has_weak ||
        (Array.isArray(stats.weak_verses) && stats.weak_verses.length > 0) ||
        (Array.isArray(stats.weak_words) && stats.weak_words.length > 0);
    },

    /* ------------------------------------------------------------------
     * Start / resume
     * --------------------------------------------------------------- */
    async start(opts) {
      if (this.loading) return;
      if (this.schemaMissing) {
        this.showAlert(this.t('rub_session_schema_missing', {}, 'جداول جلسة التثبيت غير مثبتة بعد. شغّل migrate.php ثم أعد تحميل الصفحة.'), false);
        return;
      }
      const options = opts || {};
      if (options.focus) this.settings.focus = options.focus === 'WEAK' ? 'WEAK' : 'ALL';
      if (options.allow_outside_rub != null) this.settings.allow_outside_rub = !!options.allow_outside_rub;
      if (!this.settings.exercises.length) {
        this.toast(this.t('rub_session_choose_exercise', {}, 'اختر تمريناً واحداً على الأقل'), true);
        return;
      }

      this.loading = true;
      this.showAlert('');
      this.applySettingsToControls();
      try {
        const data = await API.call('tasks/rub_session.php', {
          method: 'POST',
          redirectOn401: true,
          body: {
            action: 'start',
            task_id: this.taskId(),
            difficulty: this.settings.difficulty,
            exercises: this.settings.exercises,
            sample_size: this.settings.sample_size,
            allow_outside_rub: this.settings.allow_outside_rub,
            focus: this.settings.focus,
            force: options.force ? 1 : 0,
            resume: options.resume ? 1 : 0,
          },
        });
        if (data && data.session) {
          if (data.settings) this.applySettings(data.settings);
          this.beginSession(data.session, data.settings || this.settings);
          if (data.focus_fallback) {
            this.toast(this.t('rub_session_weak_fallback', {}, 'لا توجد آيات ضعيفة كافية بعد — بدأت الجلسة بكل آيات الربع'), true);
          }
        }
      } catch (err) {
        if (err && err.status === 401) return;
        const payload = err && err.data ? err.data : null;
        if (payload && payload.code === 'schema_missing') {
          this.schemaMissing = true;
          this.showAlert(payload.error || this.t('rub_session_schema_missing', {}, 'جداول جلسة التثبيت غير مثبتة بعد. شغّل migrate.php.'), false);
        } else if (payload && payload.code === 'empty_plan') {
          this.showAlert(this.t('rub_session_empty_plan', {}, 'تعذر توليد تمارين لهذا الربع بهذه الإعدادات. جرّب تمريناً آخر أو مستوى مختلفاً.'), false);
        } else {
          this.toast((err && err.message) || this.t('rub_session_start_error', {}, 'تعذر بدء الجلسة. حاول مرة أخرى.'), true);
        }
      } finally {
        this.loading = false;
        this.applySettingsToControls();
        this.renderHome();
      }
    },

    resume() {
      if (this.session && this.session.status === 'IN_PROGRESS') {
        this.showActive();
        this.renderActive();
        return;
      }
      if (this.state && this.state.active_session && this.state.active_session.status === 'IN_PROGRESS') {
        this.beginSession(this.state.active_session, this.state.settings || this.settings);
        return;
      }
      this.start({ resume: true, force: false });
    },

    beginSession(session, settings) {
      if (!session || !session.id || session.status !== 'IN_PROGRESS') return;
      this.session = session;
      this.plan = session.plan || {};
      const keys = Array.isArray(session.exercises) && session.exercises.length
        ? session.exercises
        : this.settings.exercises.slice();
      this.exercises = keys.filter((key) => KNOWN_EXERCISES.includes(key));
      if (!this.exercises.length) this.exercises = ALL_EXERCISES.slice();
      this.applySettings(settings || {
        difficulty: session.difficulty,
        exercises: this.exercises,
        sample_size: session.sample_size,
        allow_outside_rub: session.allow_outside_rub,
      });
      this.answers = {};
      this.itemStates = {};
      this.pending = [];
      (Array.isArray(session.results) ? session.results : []).forEach((result) => this.applyServerResult(result));
      this.startedAt = Date.now() - Math.max(0, Number(session.duration_seconds) || 0) * 1000;

      const first = this.firstUnansweredPosition();
      this.exerciseIndex = first.exerciseIndex;
      this.itemIndex = first.itemIndex;
      if (this.state) {
        this.state.active_session = session;
        this.state.settings = this.settings;
      }
      this.writeCache();
      this.showActive();
      this.renderActive();
    },

    showActive() {
      if (this.els.setup) this.els.setup.classList.add('hidden');
      if (this.els.summary) this.els.summary.classList.add('hidden');
      if (this.els.active) this.els.active.classList.remove('hidden');
      this.setHeroStep(1);
    },

    /* ------------------------------------------------------------------
     * Plan helpers
     * --------------------------------------------------------------- */
    stageFor(exercise) {
      return this.plan && this.plan.exercises ? this.plan.exercises[exercise] || null : null;
    },

    requiredItems() {
      const out = [];
      this.exercises.forEach((exercise) => {
        const stage = this.stageFor(exercise);
        if (!stage || !stage.available) return;
        (Array.isArray(stage.items) ? stage.items : []).forEach((item) => {
          if (!item || !item.item_id || item.boundary_skip) return;
          out.push({
            exercise,
            item_id: String(item.item_id),
            key: exercise + ':' + item.item_id,
          });
        });
      });
      return out;
    },

    requiredTotal() {
      return this.requiredItems().length;
    },

    answeredRequiredCount() {
      return this.requiredItems().filter((item) => !!this.answers[item.key]).length;
    },

    allRequiredAnswered() {
      const required = this.requiredItems();
      // A session whose only remaining card is an informational boundary skip
      // (for example, a one-verse rub' with outside verses disabled) must still
      // be finishable.
      return required.length === 0 || required.every((item) => !!this.answers[item.key]);
    },

    firstUnansweredPosition() {
      for (let ei = 0; ei < this.exercises.length; ei++) {
        const exercise = this.exercises[ei];
        const stage = this.stageFor(exercise);
        if (!stage || !stage.available) continue;
        const items = Array.isArray(stage.items) ? stage.items : [];
        for (let ii = 0; ii < items.length; ii++) {
          const item = items[ii];
          if (!item || !item.item_id || item.boundary_skip) continue;
          if (!this.answers[exercise + ':' + item.item_id]) {
            return { exerciseIndex: ei, itemIndex: ii };
          }
        }
      }
      return { exerciseIndex: 0, itemIndex: 0 };
    },

    currentContext() {
      const exercise = this.exercises[this.exerciseIndex];
      const stage = exercise ? this.stageFor(exercise) : null;
      const items = stage && Array.isArray(stage.items) ? stage.items : [];
      const item = items[this.itemIndex] || null;
      if (!exercise || !stage || !item) return null;
      const key = exercise + ':' + item.item_id;
      return {
        exercise,
        stage,
        item,
        key,
        state: this.stateFor(key, exercise, item),
      };
    },

    stateFor(key, exercise, item) {
      if (this.itemStates[key]) return this.itemStates[key];
      const state = {
        checked: false,
        checkedCorrect: null,
        recorded: false,
        resultCorrect: null,
        practiceRetry: false,
        skipped: false,
        attempts: 0,
        startedAt: Date.now(),
        placed: [],
        wrong: 0,
        wrongWords: [],
        reveal: false,
        values: {},
        activeBlank: null,
        selected: null,
        stage: 0,
        value: '',
        selectedIndex: null,
        selfReport: null,
        npState: 'idle',
        npStarting: false,
        npRecorder: null,
        npStream: null,
        npChunks: [],
        npUrl: '',
        npDiscard: false,
        continuationLength: item && item.default_length != null ? item.default_length : null,
        audioState: 'idle',
        audioStarting: false,
        audioRecorder: null,
        audioStream: null,
        audioChunks: [],
        audioUrl: '',
        audioDiscard: false,
      };
      if (exercise === 'MISSING_WORDS') state.values = {};
      this.itemStates[key] = state;
      return state;
    },

    applyServerResult(result) {
      if (!result || !result.exercise || !result.item_id) return;
      const key = result.exercise + ':' + result.item_id;
      this.answers[key] = result;
      const state = this.stateFor(key, result.exercise, result.item_id);
      state.recorded = true;
      state.resultCorrect = !!result.is_correct;
      state.checked = true;
      state.checkedCorrect = !!result.is_correct;
      state.attempts = Number(result.attempts) || 1;
      state.skipped = String(result.status || 'ANSWERED') !== 'ANSWERED';
      state.unknown = false;
      const details = result.details && typeof result.details === 'object' ? result.details : {};
      if (details.selected != null) state.selected = String(details.selected);
      if (details.selected_index != null) state.selectedIndex = Number(details.selected_index);
      if (details.self_report != null) state.selfReport = String(details.self_report);
      if (details.stage != null) state.stage = clamp(Number(details.stage) || 0, 0, 5);
      if (details.continuation_length != null) state.continuationLength = details.continuation_length;
      if (Array.isArray(details.wrong_words)) state.wrongWords = uniqueInts(details.wrong_words);
    },

    /* ------------------------------------------------------------------
     * Active session rendering
     * --------------------------------------------------------------- */
    ctx() {
      return {
        t: (key, params, fallback) => this.t(key, params, fallback),
        esc: (value) => this.esc(value),
        refLabel: (surah, ayah) => this.refLabel(surah, ayah),
        rubLabel: this.page && this.page.rub
          ? this.t('rub_label', { num: this.page.rub.id }, 'الربع ' + this.page.rub.id)
          : '',
        advanced: String(this.session && this.session.difficulty ? this.session.difficulty : '').toUpperCase() === 'ADVANCED',
        lang: this.isEnglish() ? 'en' : 'ar',
      };
    },

    renderActive() {
      if (!this.session || !this.els.active) return;
      const total = this.requiredTotal();
      const done = this.answeredRequiredCount();
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const attempt = Number(this.session.attempt_no) || 1;
      const rubLabel = this.page && this.page.rub
        ? this.t('rub_label', { num: this.page.rub.id }, 'الربع ' + this.page.rub.id)
        : '';
      const difficulty = this.t('rub_diff_' + String(this.session.difficulty || '').toLowerCase(), {},
        String(this.session.difficulty || ''));

      if (this.els.title) {
        this.els.title.textContent = (rubLabel ? rubLabel + ' · ' : '') +
          this.t('rub_session_attempt', { n: attempt }, 'محاولة ' + attempt);
      }
      if (this.els.sub) {
        this.els.sub.textContent = difficulty + ' · ' +
          this.t('rub_session_items_count', { count: total }, total + ' تمرين') + ' · ' +
          this.t('rub_session_first_attempt_note', {}, 'تُسجّل نتيجة المحاولة الأولى');
      }
      if (this.els.percent) this.els.percent.textContent = percent + '%';
      if (this.els.count) this.els.count.textContent = done + ' / ' + total;
      if (this.els.bar) this.els.bar.style.width = percent + '%';
      const progress = this.els.bar && this.els.bar.parentElement;
      if (progress) progress.setAttribute('aria-valuenow', String(percent));

      this.renderSteps();
      this.renderStage();
      this.updateFooter();
      this.syncHeroProgress();
    },

    renderSteps() {
      if (!this.els.steps) return;
      this.els.steps.innerHTML = this.exercises.map((exercise, index) => {
        const stage = this.stageFor(exercise);
        const available = !!(stage && stage.available);
        const items = available && Array.isArray(stage.items) ? stage.items : [];
        const required = items.filter((item) => item && item.item_id && !item.boundary_skip);
        const answered = required.filter((item) => !!this.answers[exercise + ':' + item.item_id]).length;
        const correct = required.filter((item) => {
          const result = this.answers[exercise + ':' + item.item_id];
          return result && result.status === 'ANSWERED' && result.is_correct;
        }).length;
        const isDone = available && required.length > 0 && answered >= required.length;
        const isActive = index === this.exerciseIndex;
        const meta = META_BY_KEY[exercise] || { title: exercise };
        let cls = 'rub-session-step';
        if (isActive) cls += ' is-active';
        if (isDone) cls += ' is-done';
        if (!available) cls += ' is-unavailable';
        const count = !available
          ? this.t('rub_session_unavailable', {}, 'غير متاح')
          : this.t('rub_session_step_count', { done: answered, total: required.length }, answered + ' / ' + required.length);
        const correctText = isDone
          ? ' · ' + this.t('rub_session_step_correct', { count: correct }, correct + ' صحيحة')
          : '';
        return '<li class="' + cls + '" data-step-index="' + index + '" role="button" tabindex="' +
          (available ? '0' : '-1') + '">' +
          '<div class="rub-session-step-top"><span class="rub-session-step-no">' + (isDone ? '✓' : String(index + 1)) + '</span>' +
          '<span class="rub-session-step-name">' + this.esc(this.t(meta.titleKey || '', {}, meta.title)) + '</span></div>' +
          '<small>' + this.esc(count + correctText) + '</small></li>';
      }).join('');

      this.els.steps.querySelectorAll('[data-step-index]').forEach((step) => {
        step.addEventListener('click', () => this.jumpToExercise(Number(step.dataset.stepIndex)));
        step.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.jumpToExercise(Number(step.dataset.stepIndex));
          }
        });
      });
    },

    renderStage() {
      if (!this.els.stage) return;
      if (this.finishing) {
        this.els.stage.innerHTML = '<div class="rub-ex-empty"><div class="rub-ex-empty-icon" aria-hidden="true">…</div>' +
          '<h3>' + this.esc(this.t('rub_session_finishing', {}, 'جارٍ إنهاء الجلسة وحفظ النتائج')) + '</h3>' +
          '<p>' + this.esc(this.t('rub_session_finishing_sub', {}, 'لحظات قليلة…')) + '</p></div>';
        return;
      }
      const context = this.currentContext();
      if (!context) {
        this.els.stage.innerHTML = '<div class="rub-ex-empty"><div class="rub-ex-empty-icon" aria-hidden="true">۞</div>' +
          '<h3>' + this.esc(this.t('rub_session_no_item', {}, 'لا يوجد تمرين في هذا الموضع')) + '</h3>' +
          '<p>' + this.esc(this.t('rub_session_no_item_sub', {}, 'انتقل إلى التمرين التالي أو أنهِ الجلسة.')) + '</p></div>';
        return;
      }

      if (!context.stage.available) {
        this.els.stage.innerHTML = RubExercises.renderUnavailable(
          context.exercise,
          context.stage,
          this.ctx(),
          { onEnableOutside: '1' }
        );
        return;
      }

      this.els.stage.innerHTML = RubExercises.render(context.exercise, context.item, context.state, this.ctx());
    },

    updateFooter() {
      const context = this.currentContext();
      const allDone = this.allRequiredAnswered();
      const unavailable = !context || !context.stage || !context.stage.available;
      const item = context ? context.item : null;
      const state = context ? context.state : null;
      const isBoundary = !!(item && item.boundary_skip);
      const isProgressive = !!(context && context.exercise === 'PROGRESSIVE_HIDE');
      const recorded = !!(state && state.recorded && !state.practiceRetry);

      if (this.els.prev) {
        this.els.prev.disabled = this.finishing || (this.exerciseIndex === 0 && this.itemIndex === 0);
      }
      if (this.els.check) {
        const show = !this.finishing && !allDone && !unavailable && !isBoundary && !isProgressive && !recorded;
        this.els.check.classList.toggle('hidden', !show);
        this.els.check.disabled = !show;
        this.els.check.textContent = this.t('rub_session_check', {}, 'تحقق');
      }
      if (this.els.skip) {
        const show = !this.finishing && !allDone && !unavailable && !isBoundary && !recorded;
        this.els.skip.classList.toggle('hidden', !show);
        this.els.skip.disabled = !show;
      }
      if (this.els.next) {
        this.els.next.classList.remove('hidden');
        const canAdvance = allDone || unavailable || isBoundary || isProgressive
          ? (allDone || unavailable || isBoundary || (state && state.recorded))
          : recorded;
        this.els.next.disabled = this.finishing || !canAdvance;
        this.els.next.textContent = allDone
          ? this.t('rub_session_finish', {}, 'إنهاء الجلسة')
          : this.t('rub_session_next', {}, 'التالي');
      }
      if (this.els.pause) this.els.pause.disabled = this.finishing;
    },

    jumpToExercise(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.exercises.length) return;
      const exercise = this.exercises[index];
      const stage = this.stageFor(exercise);
      if (!stage || !stage.available) return;
      const items = Array.isArray(stage.items) ? stage.items : [];
      let target = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.item_id || item.boundary_skip) continue;
        if (!this.answers[exercise + ':' + item.item_id]) {
          target = i;
          break;
        }
      }
      this.exerciseIndex = index;
      this.itemIndex = target;
      this.renderActive();
    },

    /* ------------------------------------------------------------------
     * Answer recording
     * --------------------------------------------------------------- */
    record(exercise, item, state, correct, opts) {
      const options = opts || {};
      if (!item || !item.item_id) return;
      const key = exercise + ':' + item.item_id;

      if (state.recorded) {
        if (!state.practiceRetry) return;
        state.checked = true;
        state.checkedCorrect = !!correct;
        state.skipped = false;
        this.renderActive();
        return;
      }

      const status = options.status || 'ANSWERED';
      const attempts = Math.max(1, Number(options.attempts) || Number(state.attempts) + 1 || 1);
      state.attempts = attempts;
      state.recorded = true;
      state.resultCorrect = !!correct;
      state.checked = true;
      state.checkedCorrect = !!correct;
      state.skipped = status !== 'ANSWERED';
      state.wrongWords = uniqueInts(options.wrong_words || state.wrongWords);

      const duration = Math.max(0, Math.round((Date.now() - (Number(state.startedAt) || Date.now())) / 1000));
      const result = {
        exercise,
        item_id: String(item.item_id),
        verse_key: String(item.verse_key || ''),
        status,
        is_correct: status === 'ANSWERED' && correct ? 1 : 0,
        attempts,
        duration_seconds: clamp(duration, 0, 3600),
        hint_used: options.hint_used ? 1 : 0,
        outside_rub: item.outside_rub ? 1 : 0,
        wrong_words: uniqueInts(options.wrong_words || []),
        details: Object.assign({
          wrong_words: uniqueInts(options.wrong_words || []),
          selected: options.selected != null ? String(options.selected) : (state.selected != null ? String(state.selected) : null),
          mode: item.mode || null,
          stage: Number(state.stage) || 0,
        }, options.details && typeof options.details === 'object' ? options.details : {}),
      };

      this.answers[key] = result;
      this.pending.push(result);
      this.writeCache();
      this.scheduleSave();
      this.playFeedback(correct && status === 'ANSWERED');
      this.renderActive();
    },

    playFeedback(good) {
      if (!window.AudioEngine) return;
      try {
        if (good && typeof AudioEngine.playSuccess === 'function') AudioEngine.playSuccess();
        else if (!good && typeof AudioEngine.playUndo === 'function') AudioEngine.playUndo();
      } catch (e) {}
    },

    scheduleSave() {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.savePending().catch(() => {});
      }, SAVE_DELAY);
    },

    async savePending() {
      if (this.saving || !this.session || !this.pending.length) return;
      if (this.session.status !== 'IN_PROGRESS') return;
      this.saving = true;
      const batch = this.pending.splice(0);
      try {
        const data = await API.call('tasks/rub_session.php', {
          method: 'POST',
          redirectOn401: true,
          body: {
            action: 'save',
            session_id: this.session.id,
            results: batch,
          },
        });
        if (data && data.session) this.session = data.session;
        this.offline = false;
        this.writeCache();
      } catch (err) {
        this.pending = batch.concat(this.pending);
        this.writeCache();
        const payload = err && err.data ? err.data : null;
        if (err && err.status === 409) {
          // The session is closed; these results can never be attached to it.
          this.pending = [];
          this.writeCache();
          this.toast(this.t('rub_session_closed', {}, 'انتهت هذه الجلسة. سيتم تحديث الصفحة.'), true);
          await this.loadState();
        } else if (payload && payload.code === 'schema_missing') {
          this.schemaMissing = true;
          this.showAlert(payload.error || this.t('rub_session_schema_missing', {}, 'جداول جلسة التثبيت غير مثبتة بعد.'), false);
        } else {
          this.offline = true;
          this.toast(this.t('rub_session_save_offline', {}, 'تم حفظ إجاباتك على الجهاز — ستُزامن عند عودة الاتصال'), true);
        }
      } finally {
        this.saving = false;
      }
    },

    async flush() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      // If a save is already in flight, wait for it to settle before trying
      // again. Otherwise finish() could report a false offline failure.
      if (this.saving) {
        await new Promise((resolve) => {
          const started = Date.now();
          const tick = () => {
            if (!this.saving || Date.now() - started > 5000) {
              resolve();
            } else {
              setTimeout(tick, 50);
            }
          };
          tick();
        });
      }
      await this.savePending();
      return this.pending.length === 0;
    },

    onBeforeUnload() {
      this.writeCache();
      if (!this.session || this.session.status !== 'IN_PROGRESS' || !this.pending.length) return;
      try {
        const blob = new Blob([JSON.stringify({
          action: 'save',
          session_id: this.session.id,
          results: this.pending,
        })], { type: 'application/json' });
        navigator.sendBeacon('../api/tasks/rub_session.php', blob);
      } catch (e) {}
    },

    async onOnline() {
      this.offline = false;
      if (this.session && this.session.status === 'IN_PROGRESS') {
        await this.savePending();
        this.writeCache();
      } else {
        await this.loadState();
      }
    },

    /* ------------------------------------------------------------------
     * Navigation
     * --------------------------------------------------------------- */
    check() {
      const context = this.currentContext();
      if (!context) return;
      if (!context.stage.available) {
        this.next();
        return;
      }
      const { exercise, item, state } = context;
      if (item.boundary_skip) {
        this.recordBoundary(context);
        this.next();
        return;
      }
      if (exercise === 'PROGRESSIVE_HIDE') {
        this.toast(this.t('rub_ph_choose_rating', {}, 'اختر «أتقنتها» أو «أحتاج مراجعة» بعد التسميع'), true);
        return;
      }
      if (exercise === 'NO_PREVIEW') {
        this.toast(this.t('rub_np_choose_rating', {}, 'سجّل تسميعك ثم اختر «أتقنتها» أو «أحتاج مراجعة»'), true);
        return;
      }
      if (state.recorded && !state.practiceRetry) return;

      if (exercise === 'WORD_ORDER') {
        this.checkWordOrder(context);
      } else if (exercise === 'MISSING_WORDS') {
        this.checkMissingWords(context);
      } else if (exercise === 'CONTINUE_AYAH') {
        this.checkContinueAyah(context);
      } else if (exercise === 'MUTASHABIHAT') {
        this.checkMutashabihat(context);
      } else if (exercise === 'INTERRUPT') {
        this.checkInterrupt(context);
      } else if (exercise === 'RANDOM_START') {
        this.checkRandomStart(context);
      } else if (exercise === 'CONNECTION') {
        this.checkConnection(context);
      } else if (exercise === 'REVERSE') {
        this.checkReverse(context);
      } else if (exercise === 'ERROR_DETECT') {
        this.checkErrorDetect(context);
      }
    },

    next() {
      if (this.finishing) return;
      const context = this.currentContext();
      if (context) {
        if (context.item && context.item.boundary_skip && !context.state.recorded) {
          this.recordBoundary(context);
        } else if (!this.allRequiredAnswered() && context.stage && context.stage.available &&
          context.state && !context.state.recorded && context.exercise !== 'PROGRESSIVE_HIDE') {
          this.toast(this.t('rub_session_answer_first', {}, 'أجب أو تخطَّ التمرين أولاً'), true);
          return;
        } else if (!this.allRequiredAnswered() && context.exercise === 'PROGRESSIVE_HIDE' &&
          context.state && !context.state.recorded) {
          this.toast(this.t('rub_ph_choose_rating', {}, 'اختر «أتقنتها» أو «أحتاج مراجعة» بعد التسميع'), true);
          return;
        }
      }

      if (this.allRequiredAnswered()) {
        this.finish();
        return;
      }

      this.move(1);
    },

    prev() {
      this.move(-1);
    },

    move(direction) {
      // Release the microphone if the user leaves a no-preview item while
      // recording, so the browser indicator does not stay on.
      const active = this.currentContext();
      if (active && active.state && active.state.npRecorder &&
          active.state.npRecorder.state === 'recording') {
        active.state.npDiscard = true;
        try { active.state.npRecorder.stop(); } catch (err) {}
      }
      if (active && active.state && active.state.audioRecorder &&
          active.state.audioRecorder.state === 'recording') {
        active.state.audioDiscard = true;
        try { active.state.audioRecorder.stop(); } catch (err) {}
      }
      let ei = this.exerciseIndex;
      let ii = this.itemIndex + direction;
      if (ii < 0) {
        ei--;
        while (ei >= 0) {
          const stage = this.stageFor(this.exercises[ei]);
          const items = stage && Array.isArray(stage.items) ? stage.items : [];
          if (items.length) {
            ii = items.length - 1;
            break;
          }
          ei--;
        }
      } else {
        const stage = this.stageFor(this.exercises[ei]);
        const items = stage && Array.isArray(stage.items) ? stage.items : [];
        if (ii >= items.length) {
          ei++;
          ii = 0;
          while (ei < this.exercises.length) {
            const nextStage = this.stageFor(this.exercises[ei]);
            const nextItems = nextStage && Array.isArray(nextStage.items) ? nextStage.items : [];
            if (nextItems.length) break;
            ei++;
          }
        }
      }
      if (ei < 0) {
        ei = 0;
        ii = 0;
      }
      if (ei >= this.exercises.length) {
        if (this.allRequiredAnswered()) this.finish();
        return;
      }
      this.exerciseIndex = ei;
      this.itemIndex = Math.max(0, ii);
      this.renderActive();
    },

    skip() {
      const context = this.currentContext();
      if (!context) return;
      if (context.item && context.item.boundary_skip) {
        this.recordBoundary(context);
        this.next();
        return;
      }
      if (context.state.recorded && !context.state.practiceRetry) return;
      this.record(context.exercise, context.item, context.state, false, {
        status: 'SKIPPED',
        attempts: 1,
        wrong_words: [],
      });
      this.next();
    },

    recordBoundary(context) {
      if (!context || !context.item) return;
      if (context.state.recorded) return;
      this.record(context.exercise, context.item, context.state, false, {
        status: 'BOUNDARY_SKIPPED',
        attempts: 1,
        wrong_words: [],
      });
    },

    /* ------------------------------------------------------------------
     * Exercise checks
     * --------------------------------------------------------------- */
    checkWordOrder(context) {
      const words = Array.isArray(context.item.words) ? context.item.words : [];
      const state = context.state;
      if (state.placed.length !== words.length) {
        this.toast(this.t('rub_wo_incomplete', {}, 'أكمل ترتيب كل الكلمات أولاً'), true);
        return;
      }
      const correct = !state.reveal && Number(state.wrong) === 0;
      this.record(context.exercise, context.item, state, correct, {
        attempts: state.wrong + 1,
        wrong_words: correct ? [] : state.wrongWords,
        hint_used: state.reveal,
      });
    },

    checkMissingWords(context) {
      const item = context.item;
      const state = context.state;
      const hidden = Array.isArray(item.hidden) ? item.hidden.map(Number) : [];
      const wrongWords = [];
      hidden.forEach((index) => {
        const expected = item.words && item.words[index] ? item.words[index].text : '';
        const actual = state.values[index] != null ? state.values[index] : '';
        if (RubExercises.normalizeArabic(actual) !== RubExercises.normalizeArabic(expected)) {
          wrongWords.push(index);
        }
      });
      state.attempts = (Number(state.attempts) || 0) + 1;
      this.record(context.exercise, item, state, wrongWords.length === 0, {
        attempts: state.attempts,
        wrong_words: wrongWords,
        hint_used: state.reveal,
      });
    },

    checkContinueAyah(context) {
      const item = context.item;
      const state = context.state;
      if (item.mode === 'mcq') {
        if (state.selected == null) {
          this.toast(this.t('rub_ca_choose', {}, 'اختر آية واحدة أولاً'), true);
          return;
        }
        const correct = String(state.selected) === String(item.correct_id);
        this.record(context.exercise, item, state, correct, {
          attempts: 1,
          wrong_words: [],
          selected: state.selected,
        });
        return;
      }
      if (item.mode === 'arrange') {
        const words = Array.isArray(item.words) ? item.words : [];
        if (state.placed.length !== words.length) {
          this.toast(this.t('rub_wo_incomplete', {}, 'أكمل ترتيب كل الكلمات أولاً'), true);
          return;
        }
        const correct = !state.reveal && Number(state.wrong) === 0;
        this.record(context.exercise, item, state, correct, {
          attempts: state.wrong + 1,
          // The arranged words belong to the *next* ayah, while verse_key is
          // the current rub' verse. Sending those indices would record misses
          // against the wrong words, so keep word-miss tracking to the
          // exercises that arrange the verse itself.
          wrong_words: [],
          hint_used: state.reveal,
        });
      }
    },

    checkMutashabihat(context) {
      const state = context.state;
      if (state.selected == null) {
        this.toast(this.t('rub_mt_choose', {}, 'اختر إحدى الآيتين أولاً'), true);
        return;
      }
      const correct = String(state.selected) === String(context.item.correct_id);
      this.record(context.exercise, context.item, state, correct, {
        attempts: 1,
        wrong_words: [],
        selected: state.selected,
      });
    },

    randomStartPassage(item, state) {
      const passages = item && item.passages && typeof item.passages === 'object' ? item.passages : {};
      const key = state && state.continuationLength != null
        ? String(state.continuationLength)
        : String(item && item.default_length != null ? item.default_length : 'all');
      if (passages[key]) return passages[key];
      const keys = Object.keys(passages);
      return keys.length ? passages[keys[0]] : null;
    },

    /** Accept the required opening words, or a longer correct continuation. */
    typedMatchesOpening(value, expected) {
      const answer = RubExercises.normalizeArabic(value);
      const wanted = RubExercises.normalizeArabic(expected);
      if (!answer || !wanted) return false;
      return answer === wanted || answer.indexOf(wanted + ' ') === 0;
    },

    checkInterrupt(context) {
      const item = context.item;
      const state = context.state;
      if (!String(state.value || '').trim()) {
        this.toast(this.t('rub_int_empty', {}, 'اكتب تكملة الآية أولاً'), true);
        return;
      }
      const correct = this.typedMatchesOpening(state.value, item.expected_text);
      this.record(context.exercise, item, state, correct, {
        attempts: 1,
        wrong_words: [],
        hint_used: state.reveal,
        details: {
          stop_index: Number(item.stop_index) || 0,
          stop_position: item.stop_position || 'middle',
          start_ref: item.start_ref || '',
          expected: item.expected_text || '',
          remaining_text: item.continuation_text || '',
          answer: String(state.value || ''),
          recorded: state.audioState === 'recorded',
        },
      });
    },

    checkRandomStart(context) {
      const item = context.item;
      const state = context.state;
      if (!String(state.value || '').trim()) {
        this.toast(this.t('rub_rs_empty', {}, 'اكتب أول كلمات الآية أولاً'), true);
        return;
      }
      const correct = this.typedMatchesOpening(state.value, item.expected_text);
      const passage = this.randomStartPassage(item, state);
      this.record(context.exercise, item, state, correct, {
        attempts: 1,
        wrong_words: [],
        hint_used: state.reveal,
        details: {
          start_ref: item.start_ref || item.prompt_ref || '',
          start_index: Number(item.start_index) || 0,
          continuation_length: state.continuationLength != null ? state.continuationLength : (item.default_length || 2),
          passage_refs: passage && Array.isArray(passage.refs) ? passage.refs : [],
          passage_range: passage ? passage.range || '' : '',
          expected: item.expected_text || '',
          answer: String(state.value || ''),
          recorded: state.audioState === 'recorded',
        },
      });
    },

    checkConnection(context) {
      const state = context.state;
      if (state.selected == null) {
        this.toast(this.t('rub_cn_choose', {}, 'اختر الإجابة أولاً'), true);
        return;
      }
      const item = context.item;
      const similar = String(item.kind || '') === 'similar';
      const options = Array.isArray(item.options) ? item.options : [];
      const selectedOption = options.find((option) =>
        String(option && option.id != null ? option.id : '') === String(state.selected)) || null;
      const correct = similar
        ? !!(selectedOption && selectedOption.correct)
        : String(state.selected) === String(item.correct_id);
      this.record(context.exercise, item, state, correct, {
        attempts: 1,
        wrong_words: [],
        selected: state.selected,
        details: {
          kind: similar ? 'similar' : 'transition',
          mode: item.mode || '',
          correct_text: similar
            ? (item.prompt_full || '')
            : (item.correct_text || item.text || ''),
          target_ref: item.target_ref || item.next_ref || '',
          twin_ref: item.twin_ref || '',
          diff_count: Number(item.diff_count) || 0,
        },
      });
    },

    checkReverse(context) {
      const state = context.state;
      if (state.selected == null) {
        this.toast(this.t('rub_rv_choose', {}, 'اختر الآية السابقة أولاً'), true);
        return;
      }
      const correct = String(state.selected) === String(context.item.correct_id);
      this.record(context.exercise, context.item, state, correct, {
        attempts: 1,
        wrong_words: [],
        selected: state.selected,
      });
    },

    checkErrorDetect(context) {
      const item = context.item;
      const state = context.state;
      if (state.selectedIndex == null) {
        this.toast(this.t('rub_ed_choose', {}, 'اضغط الكلمة التي ترى أنها خاطئة'), true);
        return;
      }
      const errors = (Array.isArray(item.error_indices) ? item.error_indices : []).map(Number);
      const correct = errors.includes(Number(state.selectedIndex));
      this.record(context.exercise, item, state, correct, {
        attempts: 1,
        wrong_words: correct ? [] : errors,
        selected: String(state.selectedIndex),
        details: {
          selected_index: Number(state.selectedIndex),
          error_indices: errors,
          error_type: item.error_type || '',
        },
      });
    },

    /* ------------------------------------------------------------------
     * Stage interactions
     * --------------------------------------------------------------- */
    onStageClick(event) {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const context = this.currentContext();
      if (!context) return;
      const state = context.state;
      const locked = state.recorded && !state.practiceRetry;

      const retry = target.closest('[data-rub-retry]');
      if (retry) {
        event.preventDefault();
        this.retry(context);
        return;
      }

      const enableOutside = target.closest('[data-rub-enable-outside]');
      if (enableOutside) {
        event.preventDefault();
        this.enableOutsideTwins();
        return;
      }

      const finish = target.closest('[data-session-finish]');
      if (finish) {
        event.preventDefault();
        this.finish();
        return;
      }

      if (context.exercise === 'WORD_ORDER') {
        if (locked) return;
        const token = target.closest('[data-wo-token]');
        if (token) {
          event.preventDefault();
          this.placeWordOrderToken(context, token.dataset.woToken);
          return;
        }
        const placed = target.closest('[data-wo-placed]');
        if (placed) {
          event.preventDefault();
          state.placed = state.placed.slice(0, Number(placed.dataset.woPlaced) || 0);
          this.renderStage();
          return;
        }
        if (target.closest('[data-wo-undo]')) {
          event.preventDefault();
          state.placed = state.placed.slice(0, -1);
          this.renderStage();
          return;
        }
        if (target.closest('[data-wo-reset]')) {
          event.preventDefault();
          state.placed = [];
          state.wrong = 0;
          state.wrongWords = [];
          state.reveal = false;
          this.renderStage();
          return;
        }
        if (target.closest('[data-wo-reveal]')) {
          event.preventDefault();
          state.reveal = true;
          this.record(context.exercise, context.item, state, false, {
            attempts: state.wrong + 1,
            wrong_words: state.wrongWords,
            hint_used: true,
          });
          return;
        }
        return;
      }

      if (context.exercise === 'MISSING_WORDS') {
        if (locked) return;
        const bank = target.closest('[data-mw-bank]');
        if (bank) {
          event.preventDefault();
          this.fillMissingWord(context, bank.dataset.mwBank);
          return;
        }
        const clear = target.closest('[data-mw-clear]');
        if (clear) {
          event.preventDefault();
          this.clearMissingWord(context, Number(clear.dataset.mwClear));
          return;
        }
        if (target.closest('[data-mw-reset]')) {
          event.preventDefault();
          state.values = {};
          state.reveal = false;
          state.checked = false;
          this.renderStage();
          return;
        }
        if (target.closest('[data-mw-reveal]')) {
          event.preventDefault();
          this.revealMissingWords(context);
          return;
        }
        return;
      }

      if (context.exercise === 'CONTINUE_AYAH') {
        if (locked) return;
        if (target.closest('[data-ca-boundary]')) {
          event.preventDefault();
          this.recordBoundary(context);
          this.next();
          return;
        }
        const option = target.closest('[data-ca-option]');
        if (option) {
          event.preventDefault();
          state.selected = option.dataset.caOption;
          this.renderStage();
          return;
        }
        const token = target.closest('[data-ca-token]');
        if (token) {
          event.preventDefault();
          this.placeContinueToken(context, token.dataset.caToken);
          return;
        }
        const placed = target.closest('[data-ca-placed]');
        if (placed) {
          event.preventDefault();
          state.placed = state.placed.slice(0, Number(placed.dataset.caPlaced) || 0);
          this.renderStage();
          return;
        }
        if (target.closest('[data-ca-undo]')) {
          event.preventDefault();
          state.placed = state.placed.slice(0, -1);
          this.renderStage();
          return;
        }
        if (target.closest('[data-ca-reset]')) {
          event.preventDefault();
          state.placed = [];
          state.wrong = 0;
          state.wrongWords = [];
          state.reveal = false;
          this.renderStage();
          return;
        }
        if (target.closest('[data-ca-reveal]')) {
          event.preventDefault();
          state.reveal = true;
          this.record(context.exercise, context.item, state, false, {
            attempts: state.wrong + 1,
            wrong_words: state.wrongWords,
            hint_used: true,
          });
          return;
        }
        return;
      }

      if (context.exercise === 'MUTASHABIHAT') {
        if (locked) return;
        const option = target.closest('[data-mt-option]');
        if (option) {
          event.preventDefault();
          state.selected = option.dataset.mtOption;
          this.renderStage();
        }
        return;
      }

      if (context.exercise === 'PROGRESSIVE_HIDE') {
        if (locked) return;
        if (target.closest('[data-ph-more]')) {
          event.preventDefault();
          state.stage = clamp((Number(state.stage) || 0) + 1, 0, 5);
          this.renderStage();
          return;
        }
        if (target.closest('[data-ph-reveal]')) {
          event.preventDefault();
          state.reveal = !state.reveal;
          this.renderStage();
          return;
        }
        if (target.closest('[data-ph-reset]')) {
          event.preventDefault();
          state.stage = 0;
          state.reveal = false;
          state.checked = false;
          this.renderStage();
          return;
        }
        const report = target.closest('[data-ph-report]');
        if (report) {
          event.preventDefault();
          const good = report.dataset.phReport === 'good';
          this.record(context.exercise, context.item, state, good, {
            attempts: 1,
            wrong_words: [],
            hint_used: state.reveal,
          });
        }
        return;
      }

      if (context.exercise === 'INTERRUPT') {
        if (target.closest('[data-audio-play]')) {
          event.preventDefault();
          this.playAudioRecording(context);
          return;
        }
        if (locked) return;
        if (target.closest('[data-audio-record]')) {
          event.preventDefault();
          this.startAudioRecording(context);
          return;
        }
        if (target.closest('[data-audio-stop]')) {
          event.preventDefault();
          this.stopAudioRecording(context);
          return;
        }
        if (target.closest('[data-int-reveal]')) {
          event.preventDefault();
          state.reveal = true;
          this.record(context.exercise, context.item, state, false, {
            attempts: 1,
            wrong_words: [],
            hint_used: true,
            details: {
              stop_index: Number(context.item.stop_index) || 0,
              stop_position: context.item.stop_position || 'middle',
              expected: context.item.expected_text || '',
              recorded: state.audioState === 'recorded',
            },
          });
        }
        return;
      }

      if (context.exercise === 'RANDOM_START') {
        if (target.closest('[data-audio-play]')) {
          event.preventDefault();
          this.playAudioRecording(context);
          return;
        }
        if (locked) return;
        const lengthButton = target.closest('[data-rs-length]');
        if (lengthButton) {
          event.preventDefault();
          const raw = lengthButton.dataset.rsLength;
          state.continuationLength = raw === 'all' ? 'all' : Number(raw);
          this.renderStage();
          return;
        }
        if (target.closest('[data-audio-record]')) {
          event.preventDefault();
          this.startAudioRecording(context);
          return;
        }
        if (target.closest('[data-audio-stop]')) {
          event.preventDefault();
          this.stopAudioRecording(context);
          return;
        }
        if (target.closest('[data-rs-reveal]')) {
          event.preventDefault();
          state.reveal = true;
          const passage = this.randomStartPassage(context.item, state);
          this.record(context.exercise, context.item, state, false, {
            attempts: 1,
            wrong_words: [],
            hint_used: true,
            details: {
              start_ref: context.item.start_ref || '',
              continuation_length: state.continuationLength != null
                ? state.continuationLength : context.item.default_length,
              passage_refs: passage && Array.isArray(passage.refs) ? passage.refs : [],
              expected: context.item.expected_text || '',
              recorded: state.audioState === 'recorded',
            },
          });
        }
        return;
      }

      if (context.exercise === 'CONNECTION' || context.exercise === 'REVERSE') {
        if (locked) return;
        const prefix = context.exercise === 'CONNECTION' ? 'data-cn-option' : 'data-rv-option';
        const option = target.closest('[' + prefix + ']');
        if (option) {
          event.preventDefault();
          state.selected = context.exercise === 'CONNECTION'
            ? option.dataset.cnOption
            : option.dataset.rvOption;
          this.renderStage();
        }
        return;
      }

      if (context.exercise === 'ERROR_DETECT') {
        if (locked) return;
        const word = target.closest('[data-ed-word]');
        if (word) {
          event.preventDefault();
          state.selectedIndex = Number(word.dataset.edWord);
          this.renderStage();
          return;
        }
        if (target.closest('[data-ed-reveal]')) {
          event.preventDefault();
          state.reveal = true;
          const errors = (Array.isArray(context.item.error_indices) ? context.item.error_indices : []).map(Number);
          this.record(context.exercise, context.item, state, false, {
            attempts: 1,
            wrong_words: errors,
            hint_used: true,
            details: {
              selected_index: state.selectedIndex,
              error_indices: errors,
              error_type: context.item.error_type || '',
            },
          });
        }
        return;
      }

      if (context.exercise === 'NO_PREVIEW') {
        if (locked) return;
        if (target.closest('[data-np-record]')) {
          event.preventDefault();
          this.startNoPreviewRecording(context);
          return;
        }
        if (target.closest('[data-np-stop]')) {
          event.preventDefault();
          this.stopNoPreviewRecording(context);
          return;
        }
        if (target.closest('[data-np-play]')) {
          event.preventDefault();
          this.playNoPreviewRecording(context);
          return;
        }
        if (target.closest('[data-np-reveal]')) {
          event.preventDefault();
          state.reveal = !state.reveal;
          this.renderStage();
          return;
        }
        const report = target.closest('[data-np-report]');
        if (report) {
          event.preventDefault();
          const good = report.dataset.npReport === 'good';
          state.selfReport = good ? 'good' : 'review';
          this.record(context.exercise, context.item, state, good, {
            attempts: 1,
            wrong_words: [],
            hint_used: state.reveal,
            details: {
              self_report: state.selfReport,
              verified: false,
              recorded: state.npState === 'recorded',
              recording: 'manual',
            },
          });
        }
      }
    },

    startNoPreviewRecording(context) {
      const state = context.state;
      if (state.npState === 'recording' || state.npStarting) return;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || !window.MediaRecorder) {
        this.toast(this.t('rub_np_unsupported', {}, 'المتصفح لا يدعم التسجيل الصوتي. يمكنك التسميع ثم التقييم الذاتي.'), true);
        return;
      }
      state.npStarting = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        state.npStarting = false;
        const current = this.currentContext();
        if (!current || current.state !== state) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (state.npUrl && String(state.npUrl).startsWith('blob:')) {
          try { URL.revokeObjectURL(state.npUrl); } catch (err) {}
          state.npUrl = '';
        }
        state.npDiscard = false;
        const recorder = new MediaRecorder(stream);
        state.npChunks = [];
        state.npRecorder = recorder;
        state.npStream = stream;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) state.npChunks.push(event.data);
        };
        recorder.onstop = () => {
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch (err) {}
          state.npRecorder = null;
          state.npStream = null;
          if (state.npDiscard) {
            state.npDiscard = false;
            state.npState = 'idle';
            return;
          }
          const blob = new Blob(state.npChunks || [], { type: recorder.mimeType || 'audio/webm' });
          if (state.npUrl && String(state.npUrl).startsWith('blob:')) {
            try { URL.revokeObjectURL(state.npUrl); } catch (err) {}
          }
          state.npUrl = URL.createObjectURL(blob);
          state.npState = 'recorded';
          state.npRecorder = null;
          state.npStream = null;
          this.renderStage();
          const audio = this.els.stage ? this.els.stage.querySelector('[data-np-audio]') : null;
          if (audio) {
            audio.src = state.npUrl;
            audio.hidden = false;
          }
        };
        recorder.start();
        state.npState = 'recording';
        this.renderStage();
      }).catch(() => {
        state.npStarting = false;
        state.npState = 'idle';
        this.toast(this.t('rub_np_mic_denied', {}, 'تعذر الوصول إلى الميكروفون. اسمح بالتسجيل أو استخدم التقييم الذاتي.'), true);
        this.renderStage();
      });
    },

    stopNoPreviewRecording(context) {
      const state = context.state;
      if (state.npRecorder && state.npRecorder.state === 'recording') {
        state.npRecorder.stop();
      }
    },

    playNoPreviewRecording(context) {
      const state = context.state;
      if (!state.npUrl) return;
      const audio = this.els.stage ? this.els.stage.querySelector('[data-np-audio]') : null;
      if (!audio) return;
      audio.src = state.npUrl;
      audio.hidden = false;
      const played = audio.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    },

    /* Optional audio capture for random-start/interruption. The recording is
       local-only; it is never uploaded and never claimed as automatic proof. */
    startAudioRecording(context) {
      const state = context.state;
      if (state.audioState === 'recording' || state.audioStarting) return;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || !window.MediaRecorder) {
        this.toast(this.t('rub_np_unsupported', {}, 'المتصفح لا يدعم التسجيل الصوتي. يمكنك التسميع ثم المتابعة.'), true);
        return;
      }
      state.audioStarting = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        state.audioStarting = false;
        const current = this.currentContext();
        if (!current || current.state !== state) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (state.audioUrl && String(state.audioUrl).startsWith('blob:')) {
          try { URL.revokeObjectURL(state.audioUrl); } catch (err) {}
          state.audioUrl = '';
        }
        state.audioDiscard = false;
        const recorder = new MediaRecorder(stream);
        state.audioChunks = [];
        state.audioRecorder = recorder;
        state.audioStream = stream;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) state.audioChunks.push(event.data);
        };
        recorder.onstop = () => {
          try { stream.getTracks().forEach((track) => track.stop()); } catch (err) {}
          state.audioRecorder = null;
          state.audioStream = null;
          if (state.audioDiscard) {
            state.audioDiscard = false;
            state.audioState = 'idle';
            return;
          }
          const blob = new Blob(state.audioChunks || [], { type: recorder.mimeType || 'audio/webm' });
          if (state.audioUrl && String(state.audioUrl).startsWith('blob:')) {
            try { URL.revokeObjectURL(state.audioUrl); } catch (err) {}
          }
          state.audioUrl = URL.createObjectURL(blob);
          state.audioState = 'recorded';
          state.audioChunks = [];
          if (this.els.stage) {
            const audio = this.els.stage.querySelector('[data-audio]');
            if (audio) {
              audio.src = state.audioUrl;
              audio.hidden = false;
            }
          }
          this.renderStage();
        };
        recorder.start();
        state.audioState = 'recording';
        this.renderStage();
      }).catch(() => {
        state.audioStarting = false;
        state.audioState = 'idle';
        this.toast(this.t('rub_np_mic_denied', {}, 'تعذر الوصول إلى الميكروفون. اسمح بالتسجيل أو تابع بدون تسجيل.'), true);
        this.renderStage();
      });
    },

    stopAudioRecording(context) {
      const state = context.state;
      if (state.audioRecorder && state.audioRecorder.state === 'recording') {
        state.audioRecorder.stop();
      }
    },

    playAudioRecording(context) {
      const state = context.state;
      if (!state.audioUrl) return;
      const audio = this.els.stage ? this.els.stage.querySelector('[data-audio]') : null;
      if (!audio) return;
      audio.src = state.audioUrl;
      audio.hidden = false;
      const played = audio.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    },

    onStageInput(event) {
      const target = event.target;
      if (!target || !target.matches) return;
      const context = this.currentContext();
      if (!context || (context.state.recorded && !context.state.practiceRetry)) return;
      if (target.matches('[data-mw-index]')) {
        const index = Number(target.dataset.mwIndex);
        if (!Number.isInteger(index)) return;
        context.state.values[index] = target.value;
        context.state.activeBlank = index;
        this.writeCache();
        return;
      }
      if (target.matches('[data-int-input]') || target.matches('[data-rs-input]')) {
        context.state.value = target.value;
        this.writeCache();
      }
    },

    onStageFocus(event) {
      const target = event.target;
      if (!target || !target.matches || !target.matches('[data-mw-index]')) return;
      const context = this.currentContext();
      if (!context) return;
      context.state.activeBlank = Number(target.dataset.mwIndex);
    },

    onStageKeydown(event) {
      const target = event.target;
      if (!target || !target.matches) return;
      if (target.matches('[data-int-input]') || target.matches('[data-rs-input]')) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.check();
        return;
      }
      if (!target.matches('[data-mw-index]')) return;
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const context = this.currentContext();
      if (!context) return;
      const hidden = Array.isArray(context.item.hidden) ? context.item.hidden.map(Number) : [];
      const empty = hidden.find((index) => !String(context.state.values[index] || '').trim());
      if (empty != null) {
        const input = this.els.stage.querySelector('[data-mw-index="' + empty + '"]');
        if (input) input.focus();
        return;
      }
      this.check();
    },

    placeWordOrderToken(context, tokenId) {
      const state = context.state;
      const words = Array.isArray(context.item.words) ? context.item.words : [];
      const decoys = Array.isArray(context.item.decoys) ? context.item.decoys : [];
      const expected = state.placed.length;
      if (new Set(state.placed).has(tokenId)) return;

      const tokens = [];
      words.forEach((word, index) => {
        tokens.push({
          id: 'w' + index,
          text: RubExercises.wordText(word),
          wordIndex: index,
          decoy: false,
        });
      });
      decoys.forEach((word, index) => {
        tokens.push({
          id: 'd' + index,
          text: RubExercises.wordText(word),
          wordIndex: -1,
          decoy: true,
        });
      });

      const matched = RubExercises.tokenMatchesPosition(tokens, tokenId, expected);
      if (matched) {
        state.placed.push(tokenId);
        this.playFeedback(true);
        this.writeCache();
        this.renderActive();
        return;
      }

      state.wrong = (Number(state.wrong) || 0) + 1;
      if (expected < words.length) {
        state.wrongWords = uniqueInts(state.wrongWords.concat([expected]));
      }
      this.playFeedback(false);
      const button = this.els.stage.querySelector('[data-wo-token="' + tokenId + '"]');
      if (button) {
        button.classList.add('is-wrong');
        setTimeout(() => button.classList.remove('is-wrong'), 400);
      }
    },

    placeContinueToken(context, tokenId) {
      const match = /^c(\d+)$/.exec(String(tokenId || ''));
      if (!match) return;
      const state = context.state;
      const words = Array.isArray(context.item.words) ? context.item.words : [];
      const index = Number(match[1]);
      const expected = state.placed.length;
      if (new Set(state.placed).has(tokenId)) return;

      // Each token is a specific word occurrence. A repeated word at another
      // original position must not satisfy this slot.
      const matched = index === expected;
      if (matched) {
        state.placed.push(tokenId);
        this.playFeedback(true);
        this.writeCache();
        this.renderActive();
        return;
      }
      state.wrong = (Number(state.wrong) || 0) + 1;
      if (expected < words.length) {
        state.wrongWords = uniqueInts(state.wrongWords.concat([expected]));
      }
      this.playFeedback(false);
      const button = this.els.stage.querySelector('[data-ca-token="' + tokenId + '"]');
      if (button) {
        button.classList.add('is-wrong');
        setTimeout(() => button.classList.remove('is-wrong'), 400);
      }
    },

    fillMissingWord(context, word) {
      const state = context.state;
      const hidden = Array.isArray(context.item.hidden) ? context.item.hidden.map(Number) : [];
      let target = Number(state.activeBlank);
      if (!Number.isInteger(target) || !hidden.includes(target)) {
        target = hidden.find((index) => !String(state.values[index] || '').trim());
      }
      if (target == null) target = hidden[0];
      if (target == null) return;
      state.values[target] = String(word == null ? '' : word);
      state.activeBlank = target;
      const input = this.els.stage.querySelector('[data-mw-index="' + target + '"]');
      if (input) {
        input.value = state.values[target];
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      this.writeCache();
    },

    clearMissingWord(context, index) {
      if (!Number.isInteger(index)) return;
      context.state.values[index] = '';
      const input = this.els.stage.querySelector('[data-mw-index="' + index + '"]');
      if (input) {
        input.value = '';
        input.focus();
      }
      this.writeCache();
    },

    revealMissingWords(context) {
      const state = context.state;
      const hidden = Array.isArray(context.item.hidden) ? context.item.hidden.map(Number) : [];
      hidden.forEach((index) => {
        const word = context.item.words && context.item.words[index] ? context.item.words[index].text : '';
        state.values[index] = word;
      });
      state.reveal = true;
      this.record(context.exercise, context.item, state, false, {
        attempts: (Number(state.attempts) || 0) + 1,
        wrong_words: hidden,
        hint_used: true,
      });
    },

    retry(context) {
      const state = context.state;
      state.practiceRetry = true;
      state.checked = false;
      state.checkedCorrect = null;
      state.placed = [];
      state.wrong = 0;
      state.wrongWords = [];
      state.reveal = false;
      state.values = {};
      state.activeBlank = null;
      state.selected = null;
      state.stage = 0;
      state.value = '';
      state.selectedIndex = null;
      state.selfReport = null;
      state.npState = 'idle';
      state.npStarting = false;
      if (state.npRecorder && state.npRecorder.state === 'recording') {
        state.npDiscard = true;
        try { state.npRecorder.stop(); } catch (err) {}
      }
      if (state.npStream) {
        try { state.npStream.getTracks().forEach((track) => track.stop()); } catch (err) {}
      }
      state.npRecorder = null;
      state.npStream = null;
      if (state.npUrl) {
        try { URL.revokeObjectURL(state.npUrl); } catch (err) {}
      }
      state.npUrl = '';
      state.npChunks = [];
      state.audioState = 'idle';
      state.audioStarting = false;
      if (state.audioRecorder && state.audioRecorder.state === 'recording') {
        state.audioDiscard = true;
        try { state.audioRecorder.stop(); } catch (err) {}
      }
      if (state.audioStream) {
        try { state.audioStream.getTracks().forEach((track) => track.stop()); } catch (err) {}
      }
      state.audioRecorder = null;
      state.audioStream = null;
      if (state.audioUrl) {
        try { URL.revokeObjectURL(state.audioUrl); } catch (err) {}
      }
      state.audioUrl = '';
      state.audioChunks = [];
      state.audioDiscard = false;
      state.skipped = false;
      this.renderActive();
    },

    enableOutsideTwins() {
      const message = this.t('rub_mt_enable_outside_confirm', {},
        'سيتم بدء جلسة جديدة مع السماح بالمتشابهات من خارج الربع. هل تريد المتابعة؟');
      if (typeof window.confirm === 'function' && !window.confirm(message)) return;
      this.settings.allow_outside_rub = true;
      if (this.els.outside) this.els.outside.checked = true;
      this.start({ force: true, allow_outside_rub: true });
    },

    /* ------------------------------------------------------------------
     * Pause / finish / summary
     * --------------------------------------------------------------- */
    async pause() {
      const saved = await this.flush();
      this.writeCache();
      if (this.state) this.state.active_session = this.session;
      this.renderHome(true);
      this.toast(saved
        ? this.t('rub_session_paused', {}, 'تم حفظ الجلسة — يمكنك متابعتها لاحقاً')
        : this.t('rub_session_paused_offline', {}, 'تم حفظ الجلسة على جهازك — ستُزامن عند عودة الاتصال'), !saved);
    },

    async finish() {
      if (this.finishing) return;
      if (!this.session || this.session.status !== 'IN_PROGRESS') return;
      if (!this.allRequiredAnswered()) {
        const first = this.firstUnansweredPosition();
        this.exerciseIndex = first.exerciseIndex;
        this.itemIndex = first.itemIndex;
        this.renderActive();
        const remaining = this.requiredTotal() - this.answeredRequiredCount();
        this.toast(this.t('rub_session_remaining', { count: remaining }, 'بقي {count} تمرين لإكمال الجلسة'), true);
        return;
      }

      const active = this.currentContext();
      if (active && active.state && active.state.audioRecorder &&
          active.state.audioRecorder.state === 'recording') {
        active.state.audioDiscard = true;
        try { active.state.audioRecorder.stop(); } catch (err) {}
      }

      this.finishing = true;
      this.renderActive();
      const flushed = await this.flush();
      if (!flushed) {
        this.finishing = false;
        this.renderActive();
        this.toast(this.t('rub_session_finish_offline', {}, 'تعذر حفظ كل الإجابات بعد. تحقق من الاتصال ثم أعد المحاولة.'), true);
        return;
      }

      try {
        const data = await API.call('tasks/rub_session.php', {
          method: 'POST',
          redirectOn401: true,
          body: {
            action: 'finish',
            session_id: this.session.id,
            duration_seconds: Math.max(0, Math.round((Date.now() - (Number(this.startedAt) || Date.now())) / 1000)),
          },
        });
        if (data && data.session) {
          const localResults = Object.keys(this.answers).map((key) => this.answers[key]);
          if ((!Array.isArray(data.session.results) || !data.session.results.length) && localResults.length) {
            data.session.results = localResults;
          }
          if (data.mastery && !data.session.mastery) data.session.mastery = data.mastery;
          this.session = data.session;
          if (data.state) this.state = data.state;
          if (this.state) this.state.active_session = null;
          this.pending = [];
          this.answers = {};
          this.itemStates = {};
          this.clearCache();
          this.showSummary(data.session, data.state || this.state);
          const masteryResult = data.rub_mastery || (data.session && data.session.rub_mastery);
          if (masteryResult && masteryResult.mastered &&
              window.AudioEngine && typeof AudioEngine.playCelebration === 'function') {
            try { AudioEngine.playCelebration(); } catch (e) {}
          }
        }
      } catch (err) {
        if (err && err.status === 401) return;
        const payload = err && err.data ? err.data : null;
        if (payload && payload.code === 'items_remaining') {
          const first = this.firstUnansweredPosition();
          this.exerciseIndex = first.exerciseIndex;
          this.itemIndex = first.itemIndex;
          this.toast(this.t('rub_session_remaining', { count: payload.remaining || 0 }, 'بقي {count} تمرين لإكمال الجلسة'), true);
        } else if (err && err.status === 409) {
          this.toast(this.t('rub_session_closed', {}, 'انتهت هذه الجلسة. سيتم تحديث الصفحة.'), true);
          await this.loadState();
        } else {
          this.toast((err && err.message) || this.t('rub_session_finish_error', {}, 'تعذر إنهاء الجلسة. حاول مرة أخرى.'), true);
        }
      } finally {
        this.finishing = false;
        if (this.session && this.session.status === 'IN_PROGRESS') this.renderActive();
      }
    },

    showSummary(session, state) {
      this.lastSummary = { session, state };
      if (this.els.setup) this.els.setup.classList.add('hidden');
      if (this.els.active) this.els.active.classList.add('hidden');
      if (this.els.summary) this.els.summary.classList.remove('hidden');
      this.setHeroStep(2);
      this.setRing(100);
      this.renderSummary(session, state);
    },

    summaryResults(session) {
      if (session && Array.isArray(session.results) && session.results.length) return session.results;
      return Object.keys(this.answers).map((key) => this.answers[key]);
    },

    renderSummary(session, state) {
      if (!this.els.summary || !session) return;
      const results = this.summaryResults(session);
      const answered = results.filter((result) => result && result.status === 'ANSWERED');
      const correct = answered.filter((result) => !!result.is_correct).length;
      const wrong = answered.length - correct;
      const skipped = results.filter((result) => result && result.status === 'SKIPPED').length;
      const accuracy = answered.length ? Math.round((correct / answered.length) * 100) : 0;
      const duration = Number(session.duration_seconds) ||
        results.reduce((sum, result) => sum + (Number(result.duration_seconds) || 0), 0);
      const plan = session.plan || this.plan || {};
      const exerciseKeys = Array.isArray(session.exercises) && session.exercises.length
        ? session.exercises
        : this.exercises;
      const stats = (state && state.stats) || {};
      const task = (state && state.task) || {};

      const perExercise = exerciseKeys.map((exercise) => {
        const stage = plan && plan.exercises ? plan.exercises[exercise] : null;
        const items = stage && Array.isArray(stage.items) ? stage.items : [];
        const total = items.filter((item) => item && item.item_id && !item.boundary_skip).length;
        const exResults = results.filter((result) => result && result.exercise === exercise && result.status === 'ANSWERED');
        const exCorrect = exResults.filter((result) => !!result.is_correct).length;
        const exWrong = exResults.length - exCorrect;
        const exSkipped = results.filter((result) => result && result.exercise === exercise && result.status === 'SKIPPED').length;
        const exAccuracy = exResults.length ? Math.round((exCorrect / exResults.length) * 100) : 0;
        const exDuration = exResults.reduce((sum, result) => sum + (Number(result.duration_seconds) || 0), 0);
        const meta = META_BY_KEY[exercise] || { title: exercise };
        return {
          exercise,
          title: this.t(meta.titleKey || '', {}, meta.title),
          total,
          answered: exResults.length,
          correct: exCorrect,
          wrong: exWrong,
          skipped: exSkipped,
          accuracy: exAccuracy,
          duration: exDuration,
        };
      });

      const weakVerses = Array.isArray(stats.weak_verses) ? stats.weak_verses.slice(0, 12) : [];
      const weakWords = Array.isArray(stats.weak_words) ? stats.weak_words.slice(0, 12) : [];
      const history = Array.isArray(state && state.history) ? state.history.slice(0, 6) : [];

      const needsReviewRows = perExercise.filter((row) =>
        row.skipped > 0 || (row.answered > 0 && row.accuracy < 70) || row.answered === 0
      );
      const mastery = session.mastery && typeof session.mastery === 'object'
        ? session.mastery
        : {
          mastered: accuracy >= 70 && skipped === 0 && needsReviewRows.length === 0,
          status: accuracy >= 70 && needsReviewRows.length === 0 ? 'MASTERED' : (accuracy >= 50 ? 'DEVELOPING' : 'NEEDS_REVIEW'),
          recommendations: [],
        };
      const masteryLabels = {
        MASTERED: this.t('rub_session_status_mastered', {}, 'أداء متميز'),
        DEVELOPING: this.t('rub_session_status_developing', {}, 'أداء متوسط'),
        NEEDS_REVIEW: this.t('rub_session_status_needs_review', {}, 'يحتاج إعادة'),
      };
      const masteryStatus = String(mastery.status || (mastery.mastered ? 'MASTERED' : 'DEVELOPING'));
      const masteryRecommendation = (code) => {
        const text = String(code || '');
        const split = text.indexOf(':');
        const key = split === -1 ? text : text.slice(0, split);
        const count = split === -1 ? 0 : Number(text.slice(split + 1)) || 0;
        switch (key) {
          case 'accuracy_low':
            return this.t('rub_mastery_rec_accuracy', {},
              'أعد الجلسة وركّز على الآيات التي أخطأت فيها قبل الانتقال إلى ربع جديد.');
          case 'weak_transitions':
            return this.t('rub_mastery_rec_transitions', { count },
              'راجع الربط بين الآيات: توجد {count} وصلة انتقالية تحتاج تثبيتاً.');
          case 'similar_wrong':
            return this.t('rub_mastery_rec_similar', { count },
              'خصص جلسة للمتشابهات: {count} موضعاً لم تتميز فيه بين الآيات المتشابهة.');
          case 'interrupt_wrong':
            return this.t('rub_mastery_rec_interrupt', { count },
              'تدرّب على التوقف المفاجئ: {count} موضعاً لم تستحضر تكملته.');
          case 'skipped':
            return this.t('rub_mastery_rec_skipped', {},
              'لا تتجاوز التمارين غير المتقنة؛ أعدها في جلسة قريبة.');
          case 'mastered':
            return this.t('rub_mastery_rec_mastered', {},
              'أداء هذه الجلسة قوي. واصل التحديات الثلاثة في جلسات متعددة لبناء الإتقان التراكمي قبل الانتقال.');
          default:
            return '';
        }
      };
      const codedRecommendations = Array.isArray(mastery.recommendation_codes)
        ? mastery.recommendation_codes.map(masteryRecommendation).filter(Boolean)
        : [];
      const recommendationList = codedRecommendations.length
        ? codedRecommendations
        : (Array.isArray(mastery.recommendations) && mastery.recommendations.length
          ? mastery.recommendations
          : (needsReviewRows.length
            ? [this.t('rub_mastery_repeat_note', {}, 'أعد التمارين التي لم تصل إلى 70% قبل اعتبار الربع متقناً.')]
            : [this.t('rub_mastery_ok_note', {}, 'النتيجة مبنية على الأداء الفعلي، وليست مجرد إكمال التمارين.')]));
      const strongVerseKeys = (Array.isArray(mastery.strong_verses) ? mastery.strong_verses : [])
        .map((key) => String(key || '')).filter(Boolean);
      const weakVerseKeys = (Array.isArray(mastery.weak_verses) ? mastery.weak_verses : [])
        .map((key) => {
          if (key && typeof key === 'object') return String(key.verse_key || '');
          return String(key || '');
        }).filter(Boolean);
      const confusionRows = Array.isArray(mastery.repeated_confusions) && mastery.repeated_confusions.length
        ? mastery.repeated_confusions.slice(0, 8)
        : weakWords.slice(0, 8).map((row) => ({
          word_text: row.word_text || '',
          count: row.miss_count || row.wrong_count || 0,
          verse_key: row.verse_key || '',
          word_index: row.word_index != null ? row.word_index : -1,
        }));
      const needsReviewTitles = (Array.isArray(mastery.needs_review_exercises)
        ? mastery.needs_review_exercises
        : needsReviewRows.map((row) => row.exercise))
        .map((key) => {
          const meta = META_BY_KEY[key];
          return meta ? this.t(meta.titleKey || '', {}, meta.title) : key;
        })
        .filter((value, index, list) => list.indexOf(value) === index);
      const masteryHtml = '<div class="rub-mastery-card is-' + this.esc(masteryStatus.toLowerCase()) + '">' +
        '<div class="rub-mastery-head"><div><span class="rub-eyebrow">' +
        this.esc(this.t('rub_mastery_session_title', {}, 'تقييم أداء هذه الجلسة')) + '</span><h3>' +
        this.esc(masteryLabels[masteryStatus] || masteryStatus) + '</h3></div>' +
        '<strong class="rub-mastery-badge">' + this.esc((mastery.mastered ? '✓ ' : '') + (masteryLabels[masteryStatus] || masteryStatus)) + '</strong></div>' +
        '<p class="rub-mastery-note">' + this.esc(this.t('rub_mastery_completion_note', {},
          'إكمال التمارين وحده لا يعني الإتقان. هذا التقييم يعتمد على الدقة والتخطي والأخطاء المتكررة.')) + '</p>' +
        '<div class="rub-mastery-grid">' +
        '<div><strong>' + this.esc(String(mastery.accuracy != null ? mastery.accuracy : accuracy)) + '%</strong><span>' +
        this.esc(this.t('rub_mastery_accuracy', {}, 'الدقة')) + '</span></div>' +
        '<div><strong>' + this.esc(String(mastery.skipped != null ? mastery.skipped : skipped)) + '</strong><span>' +
        this.esc(this.t('rub_mastery_skipped', {}, 'متخطاة')) + '</span></div>' +
        '<div><strong>' + this.esc(String(needsReviewTitles.length)) + '</strong><span>' +
        this.esc(this.t('rub_mastery_exercises_need_review', {}, 'تمارين تحتاج إعادة')) + '</span></div>' +
        '<div><strong>' + this.esc(String(Array.isArray(mastery.weak_transitions) ? mastery.weak_transitions.length : 0)) + '</strong><span>' +
        this.esc(this.t('rub_mastery_weak_transitions', {}, 'روابط انتقالية ضعيفة')) + '</span></div>' +
        '</div>' +
        (needsReviewTitles.length
          ? '<div class="rub-mastery-chips">' + needsReviewTitles.map((title) =>
            '<span class="rub-summary-chip is-bad">' + this.esc(title) + '</span>').join('') + '</div>'
          : '') +
        (strongVerseKeys.length
          ? '<div class="rub-mastery-section"><h4>' + this.esc(this.t('rub_mastery_strong_verses', {}, 'آيات أُتقنت')) +
            '</h4><div class="rub-mastery-chips">' + strongVerseKeys.map((key) =>
              '<span class="rub-summary-chip is-good">' + this.esc(this.refFromKey(key)) + '</span>').join('') + '</div></div>'
          : '') +
        (weakVerseKeys.length
          ? '<div class="rub-mastery-section"><h4>' + this.esc(this.t('rub_mastery_weak_verses', {}, 'آيات تحتاج مراجعة')) +
            '</h4><div class="rub-mastery-chips">' + weakVerseKeys.map((key) =>
              '<span class="rub-summary-chip is-bad">' + this.esc(this.refFromKey(key)) + '</span>').join('') + '</div></div>'
          : '') +
        (confusionRows.length
          ? '<div class="rub-mastery-section"><h4>' + this.esc(this.t('rub_mastery_confusions', {}, 'كلمات تكرر الخطأ فيها')) +
            '</h4><div class="rub-mastery-chips">' + confusionRows.map((row) =>
              '<span class="rub-summary-chip is-bad"><span dir="rtl" lang="ar">' +
              this.esc(row.word_text || this.refFromKey(row.verse_key || '') + ' · ' + (Number(row.word_index) + 1)) +
              '</span><small>×' + this.esc(String(row.count || 0)) + '</small></span>').join('') + '</div></div>'
          : '') +
        '<ul class="rub-mastery-recommendations">' + recommendationList.map((line) =>
          '<li>' + this.esc(String(line)) + '</li>').join('') + '</ul></div>';

      const rubMastery = session.rub_mastery && typeof session.rub_mastery === 'object'
        ? session.rub_mastery
        : ((stats.mastery && typeof stats.mastery === 'object') ? stats.mastery : null);
      const cumulativeStatus = rubMastery ? String(rubMastery.status || 'NOT_STARTED') : 'NOT_STARTED';
      const cumulativeLabels = {
        MASTERED: this.t('rub_mastery_mastered', {}, 'متقن تراكمياً'),
        DEVELOPING: this.t('rub_mastery_developing', {}, 'قيد التثبيت'),
        NEEDS_REVIEW: this.t('rub_mastery_needs_review', {}, 'يحتاج إعادة'),
        NOT_STARTED: this.t('rub_mastery_not_started', {}, 'لم تبدأ بعد'),
      };
      const advancedKeys = ['RANDOM_START', 'INTERRUPT', 'CONNECTION'];
      const challengeRows = advancedKeys.map((key) => {
        const meta = META_BY_KEY[key] || { title: key };
        const row = rubMastery && rubMastery.challenge_accuracy ? rubMastery.challenge_accuracy[key] : null;
        const passed = row && Number(row.answered) > 0 && Number(row.accuracy) >= 80;
        return '<span class="rub-summary-chip ' + (passed ? 'is-good' : 'is-bad') + '">' +
          this.esc(this.t(meta.titleKey || '', {}, meta.title)) +
          '<small>' + this.esc(row ? (Number(row.accuracy) || 0) + '%' : '—') + '</small></span>';
      }).join('');
      const cumulativeHtml = rubMastery
        ? '<div class="rub-mastery-card is-cumulative is-' + this.esc(cumulativeStatus.toLowerCase()) + '">' +
          '<div class="rub-mastery-head"><div><span class="rub-eyebrow">' +
          this.esc(this.t('rub_mastery_cumulative_title', {}, 'الإتقان التراكمي للربع')) + '</span><h3>' +
          this.esc(cumulativeLabels[cumulativeStatus] || cumulativeStatus) + '</h3></div>' +
          '<strong class="rub-mastery-badge">' +
          this.esc(cumulativeLabels[cumulativeStatus] || cumulativeStatus) + '</strong></div>' +
          '<p class="rub-mastery-note">' + this.esc(this.t('rub_mastery_requires_advanced', {},
            'يشترط اجتياز التحديات الثلاثة في جلسات متعددة، وليس إكمال التمارين وحده.')) + '</p>' +
          '<div class="rub-mastery-grid">' +
          '<div><strong>' + this.esc(String(rubMastery.qualified_sessions || 0)) + '/' +
          this.esc(String(rubMastery.required_sessions || 3)) + '</strong><span>' +
          this.esc(this.t('rub_mastery_sessions_label', {}, 'الجلسات المؤهلة')) + '</span></div>' +
          '<div><strong>' + this.esc(String(rubMastery.distinct_days || 0)) + '/' +
          this.esc(String(rubMastery.required_days || 2)) + '</strong><span>' +
          this.esc(this.t('rub_mastery_days_label', {}, 'أيام مستقلة')) + '</span></div>' +
          '<div><strong>' + this.esc(String(rubMastery.challenges_complete ? 3 : 0)) + '/3</strong><span>' +
          this.esc(this.t('rub_mastery_challenges_progress', {}, 'التحديات المتقدمة')) + '</span></div>' +
          '<div><strong dir="ltr">' + this.esc(rubMastery.next_review_at || '—') + '</strong><span>' +
          this.esc(rubMastery.review_due
            ? this.t('rub_mastery_review_due', {}, 'حان وقت المراجعة الدورية')
            : this.t('rub_mastery_next_review_short', {}, 'المراجعة الدورية')) + '</span></div>' +
          '</div>' +
          '<div class="rub-mastery-chips">' + challengeRows + '</div>' +
          '</div>'
        : '';

      const exerciseRows = perExercise.map((row) => {
        const resultText = row.answered + row.wrong + row.skipped > 0
          ? this.t('rub_summary_result_count', { correct: row.correct, wrong: row.wrong, skipped: row.skipped },
            row.correct + ' صحيحة · ' + row.wrong + ' خاطئة · ' + row.skipped + ' متخطاة')
          : this.t('rub_summary_not_attempted', {}, 'لم يُجرَّب');
        return '<tr><td>' + this.esc(row.title) + '</td>' +
          '<td>' + this.esc(resultText) + '</td>' +
          '<td class="' + (row.accuracy >= 70 ? 'is-good' : (row.answered ? 'is-bad' : '')) + '">' +
          (row.answered ? row.accuracy + '%' : '—') + '</td>' +
          '<td dir="ltr">' + this.esc(this.formatDuration(row.duration)) + '</td></tr>';
      }).join('');

      const weakVerseHtml = weakVerses.length
        ? weakVerses.map((row) => {
          const label = this.refFromKey(row.verse_key || '');
          return '<span class="rub-summary-chip is-bad">' + this.esc(label) +
            '<small>×' + this.esc(String(row.wrong_count || 0)) + '</small></span>';
        }).join('')
        : '<span class="rub-summary-chip is-good">' + this.esc(this.t('rub_summary_no_weak_verses', {}, 'لا توجد آيات ضعيفة مسجلة')) + '</span>';

      const weakWordHtml = weakWords.length
        ? weakWords.map((row) => {
          return '<span class="rub-summary-chip is-bad" dir="rtl" lang="ar">' + this.esc(row.word_text || '') +
            '<small>×' + this.esc(String(row.miss_count || 0)) + '</small></span>';
        }).join('')
        : '<span class="rub-summary-chip is-good">' + this.esc(this.t('rub_summary_no_weak_words', {}, 'لا توجد كلمات ضعيفة مسجلة')) + '</span>';

      const historyHtml = history.length
        ? history.map((row) => {
          return '<div class="rub-summary-history-row">' +
            '<strong>' + this.esc(this.formatDate(row.completed_at || row.updated_at || '')) + '</strong>' +
            '<span>' + this.esc(this.t('rub_summary_history_accuracy', { percent: row.accuracy || 0 }, 'الدقة {percent}%')) + '</span>' +
            '<span>' + this.esc(this.t('rub_summary_history_time', { time: this.formatDuration(row.duration_seconds || 0) }, 'الوقت {time}')) + '</span>' +
            '<span>' + this.esc(this.t('rub_summary_history_attempt', { n: row.attempt_no || 1 }, 'محاولة {n}')) + '</span>' +
            '</div>';
        }).join('')
        : '<p class="rub-session-last">' + this.esc(this.t('rub_summary_no_history', {}, 'لا توجد جلسات سابقة لهذا الربع.')) + '</p>';

      const taskDone = task.is_completed
        ? '<div class="rub-ex-feedback is-correct"><strong>' + this.esc(this.t('rub_summary_task_done', {}, 'تم تسجيل إتمام مهمة تثبيت الربع لليوم')) + '</strong></div>'
        : '';

      this.els.summary.innerHTML =
        '<div class="rub-summary-hero"><div>' +
        '<div class="rub-eyebrow">' + this.esc(this.t('rub_session_eyebrow', {}, 'جلسة تثبيت الربع')) + '</div>' +
        '<h2>' + this.esc(this.t('rub_summary_title', {}, 'تمت جلسة التثبيت')) + '</h2>' +
        '<p>' + this.esc(this.t('rub_summary_sub', { n: session.attempt_no || 1 }, 'محاولة {n} · راجع أخطاءك ثم كرّر ما يحتاج تثبيتاً.')) + '</p>' +
        '</div><div class="rub-summary-score"><strong>' + accuracy + '%</strong><span>' +
        this.esc(this.t('rub_summary_accuracy', {}, 'دقة المحاولة الأولى')) + '</span></div></div>' +
        taskDone +
        masteryHtml +
        cumulativeHtml +
        '<div class="rub-summary-grid">' +
        '<div class="rub-summary-stat is-good"><strong>' + correct + '</strong><span>' + this.esc(this.t('rub_summary_correct', {}, 'إجابة صحيحة')) + '</span></div>' +
        '<div class="rub-summary-stat is-bad"><strong>' + wrong + '</strong><span>' + this.esc(this.t('rub_summary_wrong', {}, 'إجابة خاطئة')) + '</span></div>' +
        '<div class="rub-summary-stat"><strong>' + skipped + '</strong><span>' + this.esc(this.t('rub_summary_skipped', {}, 'متخطاة')) + '</span></div>' +
        '<div class="rub-summary-stat"><strong dir="ltr">' + this.esc(this.formatDuration(duration)) + '</strong><span>' + this.esc(this.t('rub_summary_time', {}, 'وقت الجلسة')) + '</span></div>' +
        '<div class="rub-summary-stat"><strong>' + answered.length + '</strong><span>' + this.esc(this.t('rub_summary_answered', {}, 'تمرين مُجاب')) + '</span></div>' +
        '</div>' +
        '<div class="rub-summary-section"><h3>' + this.esc(this.t('rub_summary_by_exercise', {}, 'النتيجة حسب التمرين')) + '</h3>' +
        '<table class="rub-summary-table"><thead><tr>' +
        '<th>' + this.esc(this.t('rub_summary_exercise', {}, 'التمرين')) + '</th>' +
        '<th>' + this.esc(this.t('rub_summary_result', {}, 'النتيجة')) + '</th>' +
        '<th>' + this.esc(this.t('rub_summary_accuracy_short', {}, 'الدقة')) + '</th>' +
        '<th>' + this.esc(this.t('rub_summary_time_short', {}, 'الوقت')) + '</th>' +
        '</tr></thead><tbody>' + exerciseRows + '</tbody></table></div>' +
        '<div class="rub-summary-section"><h3>' + this.esc(this.t('rub_summary_weak_verses', {}, 'آيات تحتاج مراجعة')) + '</h3>' +
        '<div class="rub-summary-chips">' + weakVerseHtml + '</div></div>' +
        '<div class="rub-summary-section"><h3>' + this.esc(this.t('rub_summary_weak_words', {}, 'كلمات تحتاج مراجعة')) + '</h3>' +
        '<div class="rub-summary-chips">' + weakWordHtml + '</div></div>' +
        '<div class="rub-summary-section"><h3>' + this.esc(this.t('rub_summary_history', {}, 'سجل الجلسات')) + '</h3>' +
        '<div class="rub-summary-history">' + historyHtml + '</div></div>' +
        '<div class="rub-summary-actions">' +
        '<button type="button" class="btn btn-primary" data-summary-action="repeat-weak"' +
        (this.hasWeak() ? '' : ' disabled') + '>' + this.esc(this.t('rub_summary_repeat_weak', {}, 'أعد التمارين الضعيفة')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-summary-action="new-session">' + this.esc(this.t('rub_summary_new_session', {}, 'جلسة جديدة')) + '</button>' +
        '<button type="button" class="btn btn-ghost" data-summary-action="practice">' + this.esc(this.t('rub_summary_practice', {}, 'الترتيب الحر')) + '</button>' +
        '<a href="dashboard.html" class="btn btn-ghost">' + this.esc(this.t('back_to_home', {}, 'العودة للرئيسية')) + '</a>' +
        '</div>';
    },

    onSummaryClick(event) {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const button = target.closest('[data-summary-action]');
      if (!button) return;
      event.preventDefault();
      const action = button.dataset.summaryAction;
      if (action === 'repeat-weak') {
        if (!this.hasWeak()) {
          this.toast(this.t('rub_session_no_weak', {}, 'لا توجد آيات أو كلمات ضعيفة مسجلة بعد'), true);
          return;
        }
        this.start({ focus: 'WEAK', force: true });
      } else if (action === 'new-session') {
        this.start({ focus: 'ALL', force: true });
      } else if (action === 'practice') {
        this.switchTab('practice');
      }
    },

    formatDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const minutes = Math.floor(total / 60);
      const rest = total % 60;
      return minutes + ':' + String(rest).padStart(2, '0');
    },

    formatDate(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const date = new Date(raw.replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) return raw;
      try {
        return date.toLocaleDateString(this.isEnglish() ? 'en' : 'ar', {
          month: 'short',
          day: 'numeric',
        });
      } catch (e) {
        return raw.slice(0, 10);
      }
    },

    /* ------------------------------------------------------------------
     * Tabs
     * --------------------------------------------------------------- */
    restoreTab() {
      let tab = 'session';
      try {
        tab = localStorage.getItem(TAB_KEY) || 'session';
      } catch (e) {}
      this.switchTab(tab);
    },

    switchTab(tab) {
      const next = tab === 'practice' ? 'practice' : 'session';
      const activeContext = this.currentContext();
      if (next === 'practice' && activeContext && activeContext.state &&
          activeContext.state.audioRecorder &&
          activeContext.state.audioRecorder.state === 'recording') {
        activeContext.state.audioDiscard = true;
        try { activeContext.state.audioRecorder.stop(); } catch (err) {}
      }
      this.activeTab = next;
      document.querySelectorAll('[data-rub-tab]').forEach((button) => {
        const active = button.dataset.rubTab === next;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (this.els.sessionPanel) this.els.sessionPanel.classList.toggle('hidden', next !== 'session');
      if (this.els.practicePanel) this.els.practicePanel.classList.toggle('hidden', next !== 'practice');
      if (this.els.dock) {
        const showDock = next === 'practice' && !!(this.page && this.page.rub && this.page.verses && this.page.verses.length);
        this.els.dock.classList.toggle('hidden', !showDock);
      }
      try { localStorage.setItem(TAB_KEY, next); } catch (e) {}
      if (next === 'practice') {
        this.setHeroStep(3);
        if (this.page && typeof this.page.updateProgress === 'function') this.page.updateProgress();
      } else {
        this.setHeroStep(1);
        this.syncHeroProgress();
      }
    },
  };

  window.RubSession = RubSession;
})();
