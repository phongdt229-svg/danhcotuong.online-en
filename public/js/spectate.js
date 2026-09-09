/*
 * spectate.js — Xem trận trực tiếp (bản PHP, polling). Chỉ xem, không tương tác.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const NAME = { K: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', P: 'Soldier' };
  const POLL_MS = 1500;

  let code = null, game = null, board = null, applied = 0, started = false, over = false, timer = null;

  const status = (m) => { const e = $('status-msg'); if (e) e.textContent = m; };
  const sq = (x, y) => String.fromCharCode(65 + x) + (10 - y);

  function ensureBoard() {
    if (!board) board = new window.Board($('board'), { humanColor: null });
    board.setInteractive(false);
  }
  function renderMoveList() {
    const list = $('move-list'); if (!list || !game) return;
    list.innerHTML = '';
    const h = game.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div'); row.className = 'move-row';
      const num = document.createElement('span'); num.className = 'move-no'; num.textContent = i / 2 + 1 + '.';
      row.appendChild(num); row.appendChild(cell(h[i])); if (h[i + 1]) row.appendChild(cell(h[i + 1]));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function cell(rec) { const s = document.createElement('span'); s.className = 'move-cell ' + (X.colorOf(rec.piece) === X.RED ? 'mv-red' : 'mv-black'); s.textContent = NAME[X.typeOf(rec.piece)] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y); return s; }

  function applyMoves(moves) {
    let last = null;
    for (const m of moves) { const rec = game.move(m.from, m.to); if (rec) { last = rec; applied++; } }
    if (last) {
      board.setLastMove({ from: last.from, to: last.to });
      board.render(game);
      renderMoveList();
      $('bar-red').classList.toggle('active', !over && game.turn === 'r');
      $('bar-black').classList.toggle('active', !over && game.turn === 'b');
    }
  }

  async function poll() {
    if (!code) return;
    let s;
    try { s = await window.API.matchState(code, '', applied); } catch (e) { return; }
    if (!s || s.error) { status('This game cannot be watched (it may have ended).'); $('live-dot').style.display = 'none'; stop(); return; }
    if (!started) {
      started = true;
      $('name-red').textContent = (s.red || 'Red') + ' (Red)';
      $('name-black').textContent = (s.black || 'Black') + ' (Black)';
      game = new X.Game(); ensureBoard(); board.render(game);
    }
    if (s.moves && s.moves.length) applyMoves(s.moves);
    const st = game.status();
    if (s.status === 'ended' || st.over) {
      over = true;
      $('live-dot').style.display = 'none';
      status('🏁 ' + (s.result || (st.reason === 'checkmate' ? 'Checkmate.' : 'Game over.')));
      $('bar-red').classList.remove('active'); $('bar-black').classList.remove('active');
      stop();
    } else {
      status('Watching live — ' + (game.turn === 'r' ? 'Red' : 'Black') + ' to move.');
    }
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  function init() {
    code = (new URLSearchParams(location.search).get('code') || '').toUpperCase().trim();
    if (!code) { status('Missing game code.'); return; }
    poll();
    timer = setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
