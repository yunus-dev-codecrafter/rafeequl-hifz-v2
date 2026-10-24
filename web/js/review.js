'use strict';

/* ==========================================================================
   Rafeequl Hifz — Review hub
   One calm place for the four revision stations. Keeps the mobile nav at
   5 tabs without losing any destination.
   ========================================================================== */

const ReviewHub = {
  items: [
    {
      type: 'TIKRAR_AMS',
      url: 'tikrar.html',
      cls: 'task-amber',
      fill: 'fill-amber',
      icon: '🔁',
      titleKey: 'task_tikrar_title',
      subKey: 'task_tikrar_sub',
      title: 'تكرار حفظ الأمس',
      sub: 'كرّر صفحة الأمس ١٠ مرات قبل الربط',
    },
    {
      type: 'RABT',
      url: 'rabt.html',
      cls: 'task-blue',
      fill: 'fill-blue',
      icon: '🔗',
      titleKey: 'task_rabt_title',
      subKey: 'task_rabt_sub',
      title: 'الربط',
      sub: 'اربط الصفحات المحفوظة في نافذة متصلة',
    },
    {
      type: 'RUB_TAMKIN',
      url: 'rub.html',
      cls: 'task-teal',
      fill: 'fill-teal',
      icon: '۞',
      titleKey: 'task_rub_title',
      subKey: 'task_rub_sub',
      title: 'تثبيت الربع',
      sub: 'ربع واحد من محفوظك، كل موقف ٣ مرات',
    },
    {
      type: 'MURAJAAH',
      url: 'murajaah.html',
      cls: 'task-purple',
      fill: 'fill-purple',
      icon: '🔄',
      titleKey: 'task_murajaah_title',
      subKey: 'task_murajaah_sub',
      title: 'المراجعة',
      sub: 'ختمة دورية مقسمة على أيام خطتك',
    },
  ],

  t(key, fallback) {
    return window.I18N ? I18N.t(key) : fallback;
  },

  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  pageRange(task) {
    if (window.I18N) {
      return task.start_page === task.end_page
        ? I18N.t('single_page_format', { page: task.start_page })
        : I18N.t('multi_page_format', { start: task.start_page, end: task.end_page });
    }
    return task.start_page === task.end_page
      ? 'صفحة ' + task.start_page
      : 'صفحات ' + task.start_page + ' – ' + task.end_page;
  },

  async init() {
    try {
      await loadSharedData();
      this.render();
    } catch (err) {
      if (err && err.status === 401) return;
      const box = document.getElementById('review-content');
      if (box) {
        box.innerHTML = `<div class="task-page-head"><h2>${this.esc(err.message || 'تعذر التحميل')}</h2></div>`;
      }
    }

    if (window.I18N && !window._reviewLangBound) {
      I18N.onChange(() => this.render());
      window._reviewLangBound = true;
    }
  },

  render() {
    const dateEl = document.getElementById('review-date');
    if (dateEl) dateEl.textContent = sharedState.date || '';

    const box = document.getElementById('review-content');
    if (!box) return;

    const activeItems = this.items.filter((item) =>
      sharedState.tasks.some((t) => t.task_type === item.type)
    );
    const done = activeItems.filter((item) => {
      const task = sharedState.tasks.find((t) => t.task_type === item.type);
      return task && task.is_completed;
    }).length;
    const total = activeItems.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    const summary = `
      <div class="review-summary">
        <div class="review-summary-text">
          <strong>${done} / ${total}</strong>
          <span>${this.esc(this.t('review_hub_done', 'مهام مراجعة مكتملة اليوم'))}</span>
        </div>
        <div class="progress-bar review-summary-bar">
          <div class="progress-fill fill-teal" style="width:${percent}%"></div>
        </div>
      </div>`;

    box.innerHTML = summary + `<div class="review-grid">${this.items.map((item) => this.card(item)).join('')}</div>`;
  },

  card(item) {
    const task = sharedState.tasks.find((t) => t.task_type === item.type);
    const title = this.esc(this.t(item.titleKey, item.title));
    const sub = this.esc(this.t(item.subKey, item.sub));
    const arrow = this.esc(this.t('task_open_arrow', 'فتح الصفحة ←'));

    if (!task) {
      const reason = item.type === 'RUB_TAMKIN'
        ? this.t('review_rub_inactive', 'يثبت الربع بعد تراكم صفحات محفوظة')
        : this.t('task_status_inactive_today', 'غير مفعّل اليوم');

      return `
        <div class="task-card ${item.cls} is-disabled review-card">
          <div class="task-top">
            <div class="task-title-wrap">
              <span class="review-icon" aria-hidden="true">${item.icon}</span>
              <h3>${title}</h3>
            </div>
          </div>
          <p class="task-sub">${sub}</p>
          <div class="task-range">
            <span>${this.esc(reason)}</span>
            <span class="task-status">${this.esc(this.t('task_status_inactive', 'غير مفعّل'))}</span>
          </div>
        </div>`;
    }

    let range = '';
    let status = '';
    let progress = '';
    let flag = '';

    if (task.carried_over) {
      flag = `<span class="task-flag">${this.esc(this.t('task_flag_carried', 'محولة من أمس'))}</span>`;
    }

    if (item.type === 'RUB_TAMKIN') {
      const label = this.t('rub_quarter_label', 'الربع') + ' ' + task.rub_id;
      const from = formatAyahRefLabel(task.start_ref);
      const to = formatAyahRefLabel(task.end_ref);
      range = this.esc(label + ' · ' + from + ' — ' + to);

      const total = task.segments_total || task.total_pages || 1;
      const count = task.is_completed ? total : (task.completed_count || 0);
      const percent = task.progress_percent || 0;

      const stationPill = window.I18N
        ? I18N.t('rub_station_pill', { count, total })
        : (count + ' / ' + total + ' موقف');

      status = task.is_completed
        ? `<span class="task-status done">${this.esc(this.t('task_status_done_today', '✓ مكتمل اليوم'))}</span>`
        : `<span class="task-status">${this.esc(stationPill)}</span>`;

      progress = this.progressHtml(
        this.t('rub_progress_title', 'المواقف المثبتة'),
        count + ' / ' + total + ' (' + percent + '%)',
        percent,
        item.fill
      );
    } else if (item.type === 'TIKRAR_AMS') {
      const reps = task.repetition_count || 0;
      const target = task.target_repetitions || 10;
      const percent = task.progress_percent || 0;
      range = this.pageRange(task);

      status = task.is_completed
        ? `<span class="task-status done">${this.esc(this.t('task_status_done_today', '✓ مكتمل اليوم'))}</span>`
        : `<span class="task-status">${this.esc(reps + ' / ' + target + ' ' + this.t('repetition_unit', 'تكرار'))}</span>`;

      progress = this.progressHtml(
        this.t('task_progress_title', 'التقدم'),
        reps + ' / ' + target + ' (' + percent + '%)',
        percent,
        item.fill
      );
    } else {
      const total = task.total_pages || 1;
      const count = task.completed_count || (task.is_completed ? total : 0);
      const percent = task.progress_percent || (task.is_completed ? 100 : 0);
      range = this.pageRange(task);

      status = task.is_completed
        ? `<span class="task-status done">${this.esc(this.t('task_status_done_today', '✓ مكتمل اليوم'))}</span>`
        : `<span class="task-status">${this.esc(count + ' / ' + total + ' ' + this.t('pages_unit', 'صفحات'))}</span>`;

      progress = this.progressHtml(
        this.t('task_progress_title', 'التقدم'),
        count + ' / ' + total + ' (' + percent + '%)',
        percent,
        item.fill
      );
    }

    return `
      <a href="${item.url}" class="task-card ${item.cls} review-card ${task.is_completed ? 'is-completed' : ''}">
        <div class="task-top">
          <div class="task-title-wrap">
            <span class="review-icon" aria-hidden="true">${item.icon}</span>
            <h3>${title}</h3>
          </div>
          ${flag}
        </div>
        <p class="task-sub">${sub}</p>
        <div class="task-range">
          <span>${range}</span>
          ${status}
        </div>
        ${progress}
        <span class="task-arrow">${arrow}</span>
      </a>`;
  },

  progressHtml(label, value, percent, fillClass) {
    return `
      <div class="progress-wrap">
        <div class="progress-header">
          <span>${this.esc(label)}</span>
          <span>${this.esc(value)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${Math.min(100, percent)}%"></div></div>
      </div>`;
  },
};

window.ReviewHub = ReviewHub;

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('review-content')) {
    ReviewHub.init();
  }
});
