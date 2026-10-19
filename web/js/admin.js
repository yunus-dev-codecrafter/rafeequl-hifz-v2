'use strict';

/* ==========================================================================
   Rafeequl Hifz (رفيق الحفظ) — Administration console
   - Owner-only overview (KPIs), user directory and full account drill-down
   - Activate / suspend / disable accounts, change roles
   - Server is the authority; this file only renders and requests
   ========================================================================== */

(function () {
  const el = (id) => document.getElementById(id);

  /* ---------------- Local i18n (admin-only labels) ---------------- */

  const DICT = {
    ar: {
      admin_badge: 'الإدارة',
      admin_learner_view: 'لوحة المتعلم',
      admin_logout: 'خروج',
      admin_title: 'لوحة الإدارة',
      admin_refresh: '↻ تحديث',
      admin_users_title: 'المستخدمون',
      admin_search_ph: 'ابحث بالاسم أو البريد…',
      admin_search: 'بحث',
      admin_all_status: 'كل الحالات',
      admin_status_active: 'نشط',
      admin_status_suspended: 'موقوف',
      admin_status_disabled: 'معطّل',
      admin_role_learner: 'المتعلمون',
      admin_role_all: 'الجميع',
      admin_role_admin: 'مشرفون',
      admin_role_super: 'المشرف العام',
      admin_show: 'إظهار',
      admin_hide: 'إخفاء',
      admin_audit_title: 'سجل إجراءات الإدارة',

      th_user: 'المستخدم',
      th_status: 'الحالة',
      th_page: 'الصفحة',
      th_mistakes: 'أخطاء نشطة',
      th_due: 'مستحقة',
      th_days30: 'أيام النشاط (30)',
      th_last_seen: 'آخر ظهور',
      th_actions: 'إجراء',

      kpi_users: 'المستخدمون',
      kpi_new7: 'جديد هذا الأسبوع: {n}',
      kpi_dau: 'نشط اليوم',
      kpi_wau_mau: 'أسبوعي {w} · شهري {m}',
      kpi_active_now: 'خلال الساعة',
      kpi_login_now: 'متصل الآن',
      kpi_pages: 'صفحات محفوظة',
      kpi_learners: 'عبر {n} متعلم',
      kpi_mistakes: 'أخطاء نشطة',
      kpi_due: 'مستحقة الآن: {n}',
      kpi_reviews: 'مراجعات',
      kpi_all_time: 'منذ البداية',

      open: 'فتح',
      no_users: 'لا يوجد مستخدمون مطابقون.',
      page_info: 'صفحة {page} من {pages} · {total} مستخدم',
      never: 'لم يدخل بعد',
      just_now: 'الآن',
      mins_ago: 'قبل {n} دقيقة',
      hours_ago: 'قبل {n} ساعة',
      days_ago: 'قبل {n} يوم',

      status_active: 'نشط',
      status_suspended: 'موقوف',
      status_disabled: 'معطّل',
      role_user: 'متعلم',
      role_admin: 'مشرف',
      role_super_admin: 'مشرف عام',

      must_change: 'يجب تغيير كلمة المرور',
      you: 'أنت',
      page: 'الصفحة',
      active_mistakes: 'أخطاء نشطة',
      due_now: 'مستحقة',
      graduated: 'متخرجة',
      reviews: 'مراجعات',
      task_days: 'أيام مهام',
      usage: 'الاستخدام',
      last_seen: 'آخر ظهور',
      last_login: 'آخر دخول',
      logins: 'مرات الدخول',
      streak: 'سلسلة الأيام',
      active_days_30: 'نشط {n} يوماً من آخر 30',
      hits_30: '{n} زيارة',
      mistakes: 'الأخطاء',
      by_type: 'حسب النوع',
      weak_surahs: 'أكثر السور خطأً',
      recent_activity: 'آخر نشاط',
      recent_tasks: 'آخر المهام',
      account: 'الحساب',
      created: 'أُنشئ',
      user_type: 'نوع الحساب',
      murajaah_target: 'هدف المراجعة',
      murajaah_days_n: 'أيام المراجعة',
      change_status: 'تغيير الحالة',
      change_role: 'تغيير الدور',
      reason_ph: 'سبب الإيقاف (اختياري)',
      apply: 'تطبيق',
      action_note: 'الإيقاف يمنع الدخول فوراً حتى لو كان المستخدم متصلاً.',
      cannot_self: 'لا يمكنك تعديل حسابك من هنا.',
      read_only: 'عرض فقط — تغيير الحالات متاح للمشرف العام.',
      confirm_status: 'تغيير الحالة إلى «{status}»؟',
      confirm_role: 'تغيير الدور إلى «{role}»؟',
      saved: 'تم الحفظ ✓',
      none: 'لا يوجد.',
      hello: 'مرحباً، {name}',

      action_SET_STATUS: 'تغيير حالة',
      action_SET_ROLE: 'تغيير دور',

      event_LOGGED: 'تسجيل خطأ',
      event_AGAIN: 'أخطأ',
      event_HARD: 'صعب',
      event_GOOD: 'جيد',
      event_EASY: 'سهل',
      event_MASTERED: 'تمكين',
      event_REACTIVATED: 'إعادة تنشيط',
      event_EDITED: 'تعديل',
      event_DELETED: 'حذف',
      event_UNDONE: 'تراجع',

      task_HIFZ_JADID: 'حفظ جديد',
      task_TIKRAR_AMS: 'تكرار الأمس',
      task_RABT: 'ربط',
      task_MURAJAAH: 'مراجعة',
    },
    en: {
      admin_badge: 'Admin',
      admin_learner_view: 'Learner view',
      admin_logout: 'Log out',
      admin_title: 'Administration',
      admin_refresh: '↻ Refresh',
      admin_users_title: 'Users',
      admin_search_ph: 'Search by name or email…',
      admin_search: 'Search',
      admin_all_status: 'All statuses',
      admin_status_active: 'Active',
      admin_status_suspended: 'Suspended',
      admin_status_disabled: 'Disabled',
      admin_role_learner: 'Learners',
      admin_role_all: 'Everyone',
      admin_role_admin: 'Admins',
      admin_role_super: 'Super admin',
      admin_show: 'Show',
      admin_hide: 'Hide',
      admin_audit_title: 'Admin action log',

      th_user: 'User',
      th_status: 'Status',
      th_page: 'Page',
      th_mistakes: 'Active mistakes',
      th_due: 'Due',
      th_days30: 'Active days (30)',
      th_last_seen: 'Last seen',
      th_actions: 'Action',

      kpi_users: 'Users',
      kpi_new7: 'New this week: {n}',
      kpi_dau: 'Active today',
      kpi_wau_mau: 'Weekly {w} · Monthly {m}',
      kpi_active_now: 'Last hour',
      kpi_login_now: 'online now',
      kpi_pages: 'Pages memorized',
      kpi_learners: 'across {n} learners',
      kpi_mistakes: 'Active mistakes',
      kpi_due: 'Due now: {n}',
      kpi_reviews: 'Reviews',
      kpi_all_time: 'all time',

      open: 'Open',
      no_users: 'No matching users.',
      page_info: 'Page {page} of {pages} · {total} users',
      never: 'Never signed in',
      just_now: 'just now',
      mins_ago: '{n} min ago',
      hours_ago: '{n} h ago',
      days_ago: '{n} d ago',

      status_active: 'Active',
      status_suspended: 'Suspended',
      status_disabled: 'Disabled',
      role_user: 'Learner',
      role_admin: 'Admin',
      role_super_admin: 'Super admin',

      must_change: 'Must change password',
      you: 'You',
      page: 'Page',
      active_mistakes: 'Active mistakes',
      due_now: 'Due now',
      graduated: 'Graduated',
      reviews: 'Reviews',
      task_days: 'Task days',
      usage: 'Usage',
      last_seen: 'Last seen',
      last_login: 'Last login',
      logins: 'Logins',
      streak: 'Day streak',
      active_days_30: 'Active {n} of the last 30 days',
      hits_30: '{n} visits',
      mistakes: 'Mistakes',
      by_type: 'By type',
      weak_surahs: 'Weakest surahs',
      recent_activity: 'Recent activity',
      recent_tasks: 'Recent tasks',
      account: 'Account',
      created: 'Created',
      user_type: 'Account type',
      murajaah_target: 'Review target',
      murajaah_days_n: 'Review days',
      change_status: 'Change status',
      change_role: 'Change role',
      reason_ph: 'Reason (optional)',
      apply: 'Apply',
      action_note: 'Suspension blocks access immediately, even mid-session.',
      cannot_self: 'You cannot modify your own account here.',
      read_only: 'Read-only — status changes are reserved for the super admin.',
      confirm_status: 'Change status to “{status}”?',
      confirm_role: 'Change role to “{role}”?',
      saved: 'Saved ✓',
      none: 'None.',
      hello: 'Welcome, {name}',

      action_SET_STATUS: 'Status change',
      action_SET_ROLE: 'Role change',

      event_LOGGED: 'Mistake logged',
      event_AGAIN: 'Again',
      event_HARD: 'Hard',
      event_GOOD: 'Good',
      event_EASY: 'Easy',
      event_MASTERED: 'Mastered',
      event_REACTIVATED: 'Reactivated',
      event_EDITED: 'Edited',
      event_DELETED: 'Deleted',
      event_UNDONE: 'Undone',

      task_HIFZ_JADID: 'New memorization',
      task_TIKRAR_AMS: "Yesterday's repetition",
      task_RABT: 'Rabt',
      task_MURAJAAH: 'Murajaah',
    },
  };

  const lang = () => {
    if (window.I18N && I18N.lang === 'en') return 'en';
    try {
      if (localStorage.getItem('hifz-lang') === 'en') return 'en';
    } catch (e) {
      // ignore
    }
    return 'ar';
  };

  function t(key, params) {
    let s = DICT[lang()][key] ?? DICT.ar[key] ?? key;
    if (params) {
      Object.keys(params).forEach((k) => {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
      });
    }
    return s;
  }

  function applyAdminLabels() {
    document.querySelectorAll('[data-admin-label]').forEach((n) => {
      n.textContent = t(n.dataset.adminLabel);
    });
    document.querySelectorAll('[data-admin-ph]').forEach((n) => {
      n.setAttribute('placeholder', t(n.dataset.adminPh));
    });
  }

  /* ---------------- Helpers ---------------- */

  function h(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, isError) {
    if (window.showToast) {
      window.showToast(msg, !!isError);
    }
  }

  async function api(path, opts) {
    return API.call(path, Object.assign({ redirectOn401: true }, opts || {}));
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString(lang() === 'en' ? 'en-GB' : 'ar-EG', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  function relTime(value) {
    if (!value) return t('never');
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return t('just_now');
    const mins = Math.floor(diff / 60);
    if (mins < 60) return t('mins_ago', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('hours_ago', { n: hrs });
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('days_ago', { n: days });
    return fmtDate(value);
  }

  function roleLabel(role) {
    return t('role_' + String(role || 'USER').toLowerCase());
  }

  function statusPill(status) {
    const s = String(status || 'ACTIVE').toUpperCase();
    const cls = s === 'ACTIVE' ? 'is-active' : (s === 'SUSPENDED' ? 'is-suspended' : 'is-disabled');
    return `<span class="admin-status ${cls}">${h(t('status_' + s.toLowerCase()))}</span>`;
  }

  function mistakeLabel(type) {
    if (window.I18N && I18N.getMistakeLabel) return I18N.getMistakeLabel(type);
    return String(type || '');
  }

  function surahName(n) {
    if (window.I18N && I18N.getSurahName) return I18N.getSurahName(n);
    return (lang() === 'en' ? 'Surah ' : 'سورة ') + n;
  }

  function usageGrid(days) {
    const map = {};
    (days || []).forEach((d) => { map[d.date] = d; });

    const out = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      const hit = map[key];
      out.push(
        `<span class="admin-usage-day ${hit ? 'is-on' : ''}" title="${h(key + (hit ? ' · ' + hit.hits : ''))}"></span>`
      );
    }
    return out.join('');
  }

  /* ---------------- State ---------------- */

  const st = {
    me: null,
    users: [],
    total: 0,
    page: 1,
    pages: 1,
    perPage: 25,
    q: '',
    status: '',
    role: 'USER',
    current: null,
    auditOpen: false,
  };

  /* ---------------- Overview ---------------- */

  async function loadOverview() {
    const res = await api('admin/overview.php');
    const o = res.overview;

    const kpis = [
      { label: t('kpi_users'), value: o.users.total, sub: t('kpi_new7', { n: o.users.new_7d }) },
      { label: t('kpi_dau'), value: o.usage.dau, sub: t('kpi_wau_mau', { w: o.usage.wau, m: o.usage.mau }) },
      { label: t('kpi_active_now'), value: o.usage.active_last_hour, sub: t('kpi_login_now') },
      { label: t('kpi_pages'), value: o.progress.pages_memorized, sub: t('kpi_learners', { n: o.users.total }) },
      { label: t('kpi_mistakes'), value: o.progress.active_mistakes, sub: t('kpi_due', { n: o.progress.due_now }) },
      { label: t('kpi_reviews'), value: o.progress.reviews_all_time, sub: t('kpi_all_time') },
    ];

    el('admin-kpis').innerHTML = kpis.map((k) => `
      <div class="admin-kpi">
        <div class="admin-kpi-value">${h(k.value)}</div>
        <div class="admin-kpi-label">${h(k.label)}</div>
        <div class="admin-kpi-sub">${h(k.sub)}</div>
      </div>`).join('');
  }

  /* ---------------- User directory ---------------- */

  async function loadUsers() {
    const params = new URLSearchParams({
      page: String(st.page),
      per_page: String(st.perPage),
      role: st.role,
      sort: 'last_seen_at',
      dir: 'desc',
    });
    if (st.q) params.set('q', st.q);
    if (st.status) params.set('status', st.status);

    const res = await api('admin/list_users.php?' + params.toString());
    st.users = res.users || [];
    st.total = res.total || 0;
    st.pages = res.pages || 1;
    renderUsers();
    renderPager();
  }

  function renderUsers() {
    const body = el('admin-users-body');
    if (!st.users.length) {
      body.innerHTML = `<tr><td colspan="8" class="admin-empty">${h(t('no_users'))}</td></tr>`;
      return;
    }

    body.innerHTML = st.users.map((u) => `
      <tr>
        <td>
          <button type="button" class="admin-user-btn" data-id="${u.id}">
            <span class="admin-user-name">${h(u.name)}${
              u.role !== 'USER' ? ` <span class="admin-role-tag">${h(roleLabel(u.role))}</span>` : ''
            }</span>
            <span class="admin-user-email">${h(u.email)}</span>
          </button>
        </td>
        <td>${statusPill(u.status)}</td>
        <td>${u.current_hifz_page || '—'}</td>
        <td>${u.active_mistakes}</td>
        <td>${u.due_now}</td>
        <td>${u.active_days_30}</td>
        <td title="${h(fmtDate(u.last_seen_at))}">${h(relTime(u.last_seen_at || u.last_active_at))}</td>
        <td><button type="button" class="btn btn-ghost admin-open" data-id="${u.id}">${h(t('open'))}</button></td>
      </tr>`).join('');

    body.querySelectorAll('.admin-open, .admin-user-btn').forEach((b) => {
      b.addEventListener('click', () => openUser(b.dataset.id));
    });
  }

  function renderPager() {
    const pager = el('admin-pager');
    pager.innerHTML = `
      <button type="button" class="btn btn-ghost" id="pg-prev" ${st.page <= 1 ? 'disabled' : ''}>‹</button>
      <span class="admin-pager-info">${h(t('page_info', { page: st.page, pages: st.pages, total: st.total }))}</span>
      <button type="button" class="btn btn-ghost" id="pg-next" ${st.page >= st.pages ? 'disabled' : ''}>›</button>`;

    el('pg-prev').addEventListener('click', () => {
      if (st.page > 1) { st.page--; loadUsers().catch((e) => toast(e.message, true)); }
    });
    el('pg-next').addEventListener('click', () => {
      if (st.page < st.pages) { st.page++; loadUsers().catch((e) => toast(e.message, true)); }
    });
  }

  /* ---------------- User drill-down ---------------- */

  async function openUser(id) {
    const res = await api('admin/get_user.php?id=' + encodeURIComponent(id));
    st.current = res;
    renderDrawer(res);
    el('admin-drawer-overlay').classList.remove('hidden');
  }

  function closeDrawer() {
    el('admin-drawer-overlay').classList.add('hidden');
  }

  function renderDrawer(data) {
    const p = data.profile;
    const c = data.counts;
    const u = data.usage;

    el('ad-name').textContent = p.name;
    el('ad-email').textContent = p.email;

    const isSuper = st.me && st.me.role === 'SUPER_ADMIN';
    const canAct = isSuper && !p.is_self;

    const statusOptions = ['ACTIVE', 'SUSPENDED', 'DISABLED'].map((s) =>
      `<option value="${s}" ${p.status === s ? 'selected' : ''}>${h(t('status_' + s.toLowerCase()))}</option>`
    ).join('');

    const roleOptions = ['USER', 'ADMIN', 'SUPER_ADMIN'].map((r) =>
      `<option value="${r}" ${p.role === r ? 'selected' : ''}>${h(roleLabel(r))}</option>`
    ).join('');

    const typeDist = (data.analytics.type_distribution || []).map((x) => `
      <div class="admin-legend-row"><span>${h(mistakeLabel(x.type))}</span><b>${x.count}</b></div>`
    ).join('') || `<p class="hint">${h(t('none'))}</p>`;

    const weak = (data.analytics.weak_surahs || []).map((x) => `
      <span class="admin-chip">${h(surahName(x.surah_number))} · ${x.count}</span>`
    ).join('') || `<span class="hint">${h(t('none'))}</span>`;

    const events = (data.analytics.recent_events || []).slice(0, 8).map((e) => `
      <div class="admin-event">
        <span>${h(t('event_' + e.event_type) === 'event_' + e.event_type ? e.event_type : t('event_' + e.event_type))}</span>
        <span class="hint">${h(fmtDate(e.created_at))}</span>
      </div>`).join('') || `<p class="hint">${h(t('none'))}</p>`;

    const tasks = (data.task_logs || []).slice(0, 8).map((x) => `
      <div class="admin-event">
        <span>${h(t('task_' + x.task_type) === 'task_' + x.task_type ? x.task_type : t('task_' + x.task_type))} · ${x.start_page}–${x.end_page}</span>
        <span class="hint">${h(x.task_date)}</span>
      </div>`).join('') || `<p class="hint">${h(t('none'))}</p>`;

    el('ad-body').innerHTML = `
      <div class="admin-profile-chips">
        ${statusPill(p.status)}
        <span class="admin-chip">${h(roleLabel(p.role))}</span>
        ${p.must_change_password ? `<span class="admin-chip is-warn">${h(t('must_change'))}</span>` : ''}
        ${p.is_self ? `<span class="admin-chip">${h(t('you'))}</span>` : ''}
      </div>

      <div class="admin-stat-grid">
        <div class="admin-stat"><b>${p.current_hifz_page}</b><span>${h(t('page'))}</span></div>
        <div class="admin-stat"><b>${c.active_mistakes}</b><span>${h(t('active_mistakes'))}</span></div>
        <div class="admin-stat"><b>${c.due_now}</b><span>${h(t('due_now'))}</span></div>
        <div class="admin-stat"><b>${c.graduated}</b><span>${h(t('graduated'))}</span></div>
        <div class="admin-stat"><b>${c.reviews}</b><span>${h(t('reviews'))}</span></div>
        <div class="admin-stat"><b>${c.task_days}</b><span>${h(t('task_days'))}</span></div>
      </div>

      <h3 class="admin-h3">${h(t('usage'))}</h3>
      <div class="admin-meta-line">
        <span>${h(t('last_seen'))}: ${h(fmtDate(p.last_seen_at))}</span>
        <span>${h(t('last_login'))}: ${h(fmtDate(p.last_login_at))}</span>
        <span>${h(t('logins'))}: ${p.login_count}</span>
        <span>${h(t('streak'))}: ${u.streak}</span>
      </div>
      <div class="admin-usage">${usageGrid(u.days)}</div>
      <p class="hint">${h(t('active_days_30', { n: u.active_days_30 }))} · ${h(t('hits_30', { n: u.total_hits_30 }))}</p>

      <h3 class="admin-h3">${h(t('mistakes'))}</h3>
      <div class="admin-two-col">
        <div><div class="admin-sub">${h(t('by_type'))}</div>${typeDist}</div>
        <div><div class="admin-sub">${h(t('weak_surahs'))}</div><div class="admin-chips">${weak}</div></div>
      </div>

      <h3 class="admin-h3">${h(t('recent_activity'))}</h3>
      <div class="admin-list">${events}</div>

      <h3 class="admin-h3">${h(t('recent_tasks'))}</h3>
      <div class="admin-list">${tasks}</div>

      <h3 class="admin-h3">${h(t('account'))}</h3>
      <div class="admin-meta-line">
        <span>${h(t('created'))}: ${h(fmtDate(p.created_at))}</span>
        <span>${h(t('user_type'))}: ${h(p.user_type)}</span>
        <span>${h(t('murajaah_target'))}: ${p.daily_murajaah_target_pages}</span>
        <span>${h(t('murajaah_days_n'))}: ${p.murajaah_days}</span>
      </div>

      ${canAct ? `
        <div class="admin-action-box">
          <div class="admin-sub">${h(t('change_status'))}</div>
          <div class="admin-inline">
            <select id="ad-status-select" class="admin-input">${statusOptions}</select>
            <input id="ad-reason" class="admin-input" placeholder="${h(t('reason_ph'))}" maxlength="255">
            <button type="button" class="btn btn-primary" id="ad-status-apply">${h(t('apply'))}</button>
          </div>
          <div class="admin-sub" style="margin-top:0.9rem;">${h(t('change_role'))}</div>
          <div class="admin-inline">
            <select id="ad-role-select" class="admin-input">${roleOptions}</select>
            <button type="button" class="btn btn-ghost" id="ad-role-apply">${h(t('apply'))}</button>
          </div>
          <p class="hint">${h(t('action_note'))}</p>
        </div>` : `<p class="hint">${h(p.is_self ? t('cannot_self') : t('read_only'))}</p>`}
    `;

    if (canAct) {
      el('ad-status-apply').addEventListener('click', () => applyStatus(p.id));
      el('ad-role-apply').addEventListener('click', () => applyRole(p.id));
    }
  }

  async function applyStatus(id) {
    const status = el('ad-status-select').value;
    const reason = el('ad-reason').value.trim();
    if (!window.confirm(t('confirm_status', { status: t('status_' + status.toLowerCase()) }))) return;

    try {
      await api('admin/set_status.php', { method: 'POST', body: { user_id: id, status, reason } });
      toast(t('saved'));
      await openUser(id);
      await loadUsers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function applyRole(id) {
    const role = el('ad-role-select').value;
    if (!window.confirm(t('confirm_role', { role: roleLabel(role) }))) return;

    try {
      await api('admin/set_role.php', { method: 'POST', body: { user_id: id, role } });
      toast(t('saved'));
      await openUser(id);
      await loadUsers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ---------------- Audit log ---------------- */

  async function loadAudit() {
    const box = el('admin-audit');
    box.innerHTML = '<p class="hint">…</p>';
    const res = await api('admin/audit_log.php?limit=60');

    if (!res.available || !res.entries.length) {
      box.innerHTML = `<p class="hint">${h(t('none'))}</p>`;
      return;
    }

    box.innerHTML = res.entries.map((x) => {
      const action = t('action_' + x.action) === 'action_' + x.action ? x.action : t('action_' + x.action);
      return `
        <div class="admin-audit-item">
          <div><b>${h(action)}</b> — ${h(x.admin_name || '—')}${x.target_name ? ' → ' + h(x.target_name) : ''}</div>
          <div class="hint">${h(fmtDate(x.created_at))}${x.details ? ' · ' + h(x.details) : ''}</div>
        </div>`;
    }).join('');
  }

  /* ---------------- Wiring ---------------- */

  function wire() {
    el('admin-logout').addEventListener('click', async () => {
      try {
        await api('auth/logout.php', { method: 'POST' });
      } catch (e) {
        // still leave the UI
      }
      localStorage.removeItem('hifz_name');
      location.href = 'index.html';
    });

    el('admin-refresh').addEventListener('click', () => {
      Promise.all([loadOverview(), loadUsers()])
        .then(() => { if (st.auditOpen) return loadAudit(); })
        .catch((e) => toast(e.message, true));
    });

    el('admin-apply').addEventListener('click', () => {
      st.q = el('admin-search').value.trim();
      st.status = el('admin-status-filter').value;
      st.role = el('admin-role-filter').value;
      st.page = 1;
      loadUsers().catch((e) => toast(e.message, true));
    });

    el('admin-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el('admin-apply').click();
      }
    });

    el('admin-audit-toggle').addEventListener('click', () => {
      const box = el('admin-audit');
      if (!box.classList.contains('hidden')) {
        box.classList.add('hidden');
        st.auditOpen = false;
        el('admin-audit-toggle').textContent = t('admin_show');
        return;
      }
      box.classList.remove('hidden');
      st.auditOpen = true;
      el('admin-audit-toggle').textContent = t('admin_hide');
      loadAudit().catch((e) => toast(e.message, true));
    });

    el('ad-close').addEventListener('click', closeDrawer);
    el('admin-drawer-overlay').addEventListener('click', (e) => {
      if (e.target === el('admin-drawer-overlay')) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    if (window.I18N && I18N.onChange) {
      I18N.onChange(() => {
        applyAdminLabels();
        if (st.auditOpen) el('admin-audit-toggle').textContent = t('admin_hide');
        loadOverview().catch(() => {});
        loadUsers().catch(() => {});
        if (st.current) renderDrawer(st.current);
      });
    }
  }

  /* ---------------- Boot ---------------- */

  async function boot() {
    applyAdminLabels();
    wire();

    try {
      const res = await api('auth/me.php');
      st.me = res.user || null;
    } catch (e) {
      location.href = 'index.html';
      return;
    }

    if (!st.me) {
      location.href = 'index.html';
      return;
    }
    if (st.me.must_change_password) {
      location.href = 'change-password.html';
      return;
    }
    if (st.me.role !== 'SUPER_ADMIN' && st.me.role !== 'ADMIN') {
      location.href = 'dashboard.html';
      return;
    }

    el('admin-hello').textContent = t('hello', { name: st.me.name });

    try {
      await Promise.all([loadOverview(), loadUsers()]);
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();