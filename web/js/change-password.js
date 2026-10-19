'use strict';

/* ==========================================================================
   Rafeequl Hifz (رفيق الحفظ) — forced / voluntary password change
   ========================================================================== */

(function () {
  const el = (id) => document.getElementById(id);
  const form = el('cp-form');
  if (!form) return;

  const errorBox = el('cp-error');
  const submitBtn = el('cp-submit');

  const t = (key, fallback) => (window.I18N ? I18N.t(key) : fallback);

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg || '';
    errorBox.classList.toggle('hidden', !msg);
  }

  let currentUser = null;

  // Who am I? (side-effect free endpoint)
  API.call('auth/me.php', { method: 'GET' })
    .then((res) => {
      currentUser = res && res.user ? res.user : null;
      if (!currentUser) {
        location.href = 'index.html';
      }
    })
    .catch(() => {
      location.href = 'index.html';
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');

    const current = el('cp-current').value;
    const next = el('cp-new').value;
    const confirm = el('cp-confirm').value;

    if (next.length < 8) {
      showError(t('cp_err_short', 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'));
      return;
    }
    if (next !== confirm) {
      showError(t('cp_err_mismatch', 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    if (next === current) {
      showError(t('cp_err_same', 'اختر كلمة مرور مختلفة عن الحالية.'));
      return;
    }

    submitBtn.disabled = true;
    try {
      await API.call('auth/change_password.php', {
        method: 'POST',
        body: { current_password: current, new_password: next },
        redirectOn401: true,
      });

      if (window.showToast) {
        showToast(t('cp_success', 'تم تغيير كلمة المرور بنجاح ✓'));
      }

      const isAdmin = currentUser && (currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN');
      setTimeout(() => {
        location.href = isAdmin ? 'admin.html' : 'dashboard.html';
      }, 400);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
    }
  });
})();
