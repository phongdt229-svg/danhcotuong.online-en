/*
 * withdraw.js — Trang rút điểm về PayPal.
 * Điểm bị giữ ngay khi gửi yêu cầu; admin duyệt tay rồi chuyển tiền.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { rules: null, balance: 0 };

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const usd = (n) => '$' + Number(n || 0).toFixed(2);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setMsg(text, kind) {
    const box = $('wd-msg');
    box.textContent = text || '';
    box.className = 'wd-msg' + (kind ? ' ' + kind : '');
    box.style.display = text ? '' : 'none';
  }

  // Hiện số tiền tương ứng ngay khi gõ số điểm.
  function paintPreview() {
    const pts = Math.floor(Number($('wd-points').value) || 0);
    const el = $('wd-preview');
    if (!state.rules || pts <= 0) { el.textContent = ''; return; }
    el.textContent = fmt(pts) + ' points → ' + usd(pts / state.rules.pointsPerUsd) + ' (before PayPal fees)';
  }

  function paintRules() {
    const r = state.rules;
    $('balance').textContent = fmt(state.balance);
    $('wd-rule').textContent =
      'Rate: ' + r.pointsPerUsd + ' points = $1. Minimum ' + fmt(r.minPoints) +
      ' points (' + usd(r.minUsd) + ') per request. PayPal transfer fees are deducted from the amount you receive.';

    const input = $('wd-points');
    input.min = String(r.minPoints);
    input.max = String(state.balance);
    if (!input.value) input.value = String(Math.max(r.minPoints, 0));

    const canWithdraw = r.enabled && state.balance >= r.minPoints;
    $('wd-submit').disabled = !canWithdraw;

    const warn = $('wd-warning');
    if (!r.enabled) {
      warn.style.display = '';
      warn.textContent = 'Withdrawals are temporarily unavailable.';
    } else if (state.balance < r.minPoints) {
      warn.style.display = '';
      warn.textContent = 'You have ' + fmt(state.balance) + ' points. You need at least ' +
        fmt(r.minPoints) + ' to request a withdrawal.';
    } else {
      warn.style.display = 'none';
    }
    paintPreview();
  }

  const STATUS = {
    pending: ['pending', 'Awaiting review'],
    paid: ['paid', 'Paid'],
    rejected: ['rejected', 'Rejected'],
    cancelled: ['cancelled', 'Cancelled'],
  };

  function renderList(rows) {
    const body = $('wd-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-muted">No withdrawal requests yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((w) => {
        const s = STATUS[w.status] || ['pending', w.status];
        const when = new Date(w.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-US');
        const note = w.adminNote ? '<div class="wd-note">' + esc(w.adminNote) + '</div>' : '';
        const cancel = w.status === 'pending'
          ? '<button class="btn btn-ghost wd-cancel" data-id="' + w.id + '" style="padding:4px 12px">Cancel</button>'
          : '';
        return '<tr><td>' + when + '</td><td>' + fmt(w.points) + '</td><td>' + usd(w.amountUsd) +
          '</td><td><span class="wd-badge ' + s[0] + '">' + s[1] + '</span>' + note +
          '</td><td>' + cancel + '</td></tr>';
      })
      .join('');

    body.querySelectorAll('.wd-cancel').forEach((b) => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await window.API.wdCancel(Number(b.dataset.id));
          state.balance = r.balance;
          setMsg('Withdrawal cancelled — your points were returned.', 'ok');
          await load();
        } catch (e) {
          setMsg(e.message || 'Could not cancel that request.', 'err');
          b.disabled = false;
        }
      });
    });
  }

  async function load() {
    try {
      const d = await window.API.wdMine();
      state.rules = { enabled: d.enabled, minPoints: d.minPoints, pointsPerUsd: d.pointsPerUsd, minUsd: d.minUsd };
      state.balance = d.balance;
      paintRules();
      renderList(d.withdrawals || []);
    } catch (e) {
      $('wd-body').innerHTML = '<tr><td colspan="5" class="text-muted">Could not load your withdrawals.</td></tr>';
    }
  }

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    const points = Math.floor(Number($('wd-points').value) || 0);
    const email = $('wd-email').value.trim();
    const btn = $('wd-submit');
    btn.disabled = true;
    try {
      const r = await window.API.wdRequest(points, email);
      state.balance = r.balance;
      setMsg('Request submitted: ' + fmt(r.points) + ' points → ' + usd(r.amountUsd) +
             '. Your points are on hold until an admin reviews it.', 'ok');
      $('wd-points').value = '';
      await load();
    } catch (err) {
      setMsg(err.message || 'Could not submit your withdrawal.', 'err');
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    let me = null;
    try { me = await window.API.me(); } catch (e) {}
    if (!me || !me.user) { $('guard').style.display = ''; return; }
    $('content').style.display = '';

    // Gợi ý sẵn email tài khoản cho tiện (người dùng sửa được).
    $('wd-email').value = me.user.email || '';

    $('wd-form').addEventListener('submit', submit);
    $('wd-points').addEventListener('input', paintPreview);
    const max = $('wd-max');
    if (max) max.addEventListener('click', () => { $('wd-points').value = String(state.balance); paintPreview(); });

    await load();
  });
})();
