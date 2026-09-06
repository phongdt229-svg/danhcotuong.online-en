/*
 * admin.js — Trang duyệt yêu cầu rút điểm (chỉ tài khoản ADMIN_USER_ID vào được).
 * Server mới là nơi chặn quyền; trang này chỉ ẩn/hiện cho gọn.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { status: 'pending' };

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const usd = (n) => '$' + Number(n || 0).toFixed(2);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setMsg(text, kind) {
    const box = $('adm-msg');
    box.textContent = text || '';
    box.className = 'adm-msg' + (kind ? ' ' + kind : '');
    box.style.display = text ? '' : 'none';
  }

  const STATUS = {
    pending: ['pending', 'Awaiting review'],
    paid: ['paid', 'Paid'],
    rejected: ['rejected', 'Rejected'],
    cancelled: ['cancelled', 'Cancelled'],
  };

  function render(rows) {
    const body = $('adm-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="text-muted">Nothing here.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((w) => {
        const s = STATUS[w.status] || ['pending', w.status];
        const when = new Date(w.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-US');
        const note = w.adminNote ? '<div class="adm-note">note: ' + esc(w.adminNote) + '</div>' : '';
        const ref = w.payoutRef ? '<div class="adm-note">ref: ' + esc(w.payoutRef) + '</div>' : '';
        const actions = w.status === 'pending'
          ? '<button class="btn btn-primary adm-paid" data-id="' + w.id + '" style="padding:5px 12px">Mark paid</button> ' +
            '<button class="btn btn-ghost adm-reject" data-id="' + w.id + '" style="padding:5px 12px">Reject</button>'
          : '';
        return '<tr>' +
          '<td>' + when + '</td>' +
          '<td><b>' + esc(w.username) + '</b><div class="adm-note">balance: ' + fmt(w.userBalance) + ' pts</div></td>' +
          '<td class="adm-email">' + esc(w.paypalEmail) + '</td>' +
          '<td>' + fmt(w.points) + '<div class="adm-note">' + usd(w.amountUsd) + '</div></td>' +
          '<td><span class="adm-badge ' + s[0] + '">' + s[1] + '</span>' + note + ref + '</td>' +
          '<td class="adm-actions">' + actions + '</td></tr>';
      })
      .join('');

    body.querySelectorAll('.adm-paid').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.id);
        const ref = prompt('PayPal transaction ID (optional — helps you reconcile later):', '');
        if (ref === null) return; // bấm Cancel
        if (!confirm('Confirm you have ALREADY sent the money in PayPal.\n\nMarking as paid does NOT transfer anything — it only closes the request and keeps the points deducted.')) return;
        b.disabled = true;
        try {
          await window.API.wdAdminPaid(id, ref, '');
          setMsg('Request #' + id + ' marked as paid.', 'ok');
          load();
        } catch (e) { setMsg(e.message || 'Could not update.', 'err'); b.disabled = false; }
      });
    });

    body.querySelectorAll('.adm-reject').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.id);
        const note = prompt('Reason for rejecting (shown to the user):', '');
        if (note === null) return;
        b.disabled = true;
        try {
          const r = await window.API.wdAdminReject(id, note);
          setMsg('Request #' + id + ' rejected — ' + fmt(r.balance) + ' points returned to the user.', 'ok');
          load();
        } catch (e) { setMsg(e.message || 'Could not update.', 'err'); b.disabled = false; }
      });
    });
  }

  async function load() {
    try {
      const d = await window.API.wdAdminList(state.status);
      $('sum-count').textContent = fmt(d.summary.pendingCount);
      $('sum-points').textContent = fmt(d.summary.pendingPoints);
      $('sum-usd').textContent = usd(d.summary.pendingUsd);
      $('sum-paid').textContent = usd(d.summary.paidUsd);
      render(d.withdrawals || []);
    } catch (e) {
      if (e.status === 403 || e.status === 503) {
        $('content').style.display = 'none';
        $('denied').style.display = '';
        $('denied-msg').textContent = e.message || 'Admin only.';
        return;
      }
      $('adm-body').innerHTML = '<tr><td colspan="6" class="text-muted">Could not load requests.</td></tr>';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    let me = null;
    try { me = await window.API.me(); } catch (e) {}
    if (!me || !me.user) { $('guard').style.display = ''; return; }
    $('content').style.display = '';

    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        state.status = b.dataset.status;
        setMsg('');
        load();
      });
    });

    load();
  });
})();
