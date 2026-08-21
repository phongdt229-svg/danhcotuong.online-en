/*
 * history.js — Lịch sử biến động điểm: nạp vào, đặt cược, thắng cược, hoàn cược.
 * Đọc từ sổ cái point_ledger nên mỗi dòng đều có số dư ngay sau giao dịch.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { kind: '', nextBefore: null, hasMore: false, loading: false };

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const signed = (n) => (Number(n) > 0 ? '+' : '') + fmt(n);

  // Biểu tượng & màu cho từng loại biến động.
  const KIND_STYLE = {
    topup: ['💳', 'up'],
    stake_win: ['🏆', 'up'],
    stake_refund: ['↩️', 'up'],
    house_fee: ['🏦', 'up'],
    stake_hold: ['🎲', 'down'],
    adjust: ['⚙️', ''],
  };

  function row(e) {
    const [icon, dir] = KIND_STYLE[e.kind] || ['•', ''];
    const when = new Date(e.created_at).toLocaleString('en-US');
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="ledger-when">' + when + '</td>' +
      '<td><span class="ledger-icon">' + icon + '</span>' + escapeHtml(e.label) +
      (e.note ? '<span class="ledger-note">' + escapeHtml(e.note) + '</span>' : '') + '</td>' +
      '<td class="ledger-delta ' + dir + '">' + signed(e.delta) + '</td>' +
      '<td class="ledger-balance">' + fmt(e.balance_after) + '</td>';
    return tr;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function paintSummary(balance, s) {
    $('balance').textContent = fmt(balance);
    $('sum-topup').textContent = fmt(s.toppedUp);
    $('sum-staked').textContent = fmt(s.staked);
    $('sum-won').textContent = fmt(s.won + s.refunded);
    const net = $('sum-net');
    net.textContent = signed(s.netFromGames);
    net.className = 'num ' + (s.netFromGames > 0 ? 'up' : s.netFromGames < 0 ? 'down' : '');
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    const body = $('ledger-body');
    if (reset) { state.nextBefore = null; body.innerHTML = ''; }
    $('btn-more').disabled = true;

    try {
      const data = await window.API.pointsLedger({
        limit: 25,
        before: reset ? null : state.nextBefore,
        kind: state.kind || null,
      });
      if (reset) paintSummary(data.balance, data.summary);

      if (!data.entries.length && reset) {
        body.innerHTML =
          '<tr><td colspan="4" class="text-muted">No point activity yet. ' +
          '<a href="topup.html">Buy points</a> to get started.</td></tr>';
      } else {
        data.entries.forEach((e) => body.appendChild(row(e)));
      }
      state.hasMore = data.hasMore;
      state.nextBefore = data.nextBefore;
      $('btn-more').style.display = data.hasMore ? '' : 'none';
    } catch (err) {
      if (reset) body.innerHTML = '<tr><td colspan="4" class="text-muted">Could not load your history.</td></tr>';
    } finally {
      state.loading = false;
      $('btn-more').disabled = false;
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
        state.kind = b.dataset.kind || '';
        load(true);
      });
    });
    $('btn-more').addEventListener('click', () => load(false));

    load(true);
  });
})();
