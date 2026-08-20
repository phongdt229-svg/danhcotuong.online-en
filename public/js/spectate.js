/*
 * spectate.js — Xem trực tiếp một trận đang đánh (spectate.html?code=ABCD).
 * Kết nối WebSocket, nhận trạng thái ván + từng nước đi và dựng lại bằng engine xiangqi.js.
 * Chỉ xem, không tương tác.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const NAME = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  let ws = null;
  let game = null;
  let board = null;
  let over = false;

  function status(m) { const el = $('status-msg'); if (el) el.textContent = m; }
  function sq(x, y) { return String.fromCharCode(65 + x) + (10 - y); }

  function renderAll(lastMove) {
    if (!board) board = new window.Board($('board'), { humanColor: null });
    board.setInteractive(false);
    board.setLastMove(lastMove || null);
    board.clearSelection();
    board.render(game);
    renderMoveList();
    updateTurnBars();
  }

  function updateTurnBars() {
    $('bar-red').classList.toggle('active', !over && game && game.turn === 'r');
    $('bar-black').classList.toggle('active', !over && game && game.turn === 'b');
  }

  function renderMoveList() {
    const list = $('move-list');
    if (!list || !game) return;
    list.innerHTML = '';
    const h = game.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-no';
      num.textContent = i / 2 + 1 + '.';
      row.appendChild(num);
      row.appendChild(cell(h[i]));
      if (h[i + 1]) row.appendChild(cell(h[i + 1]));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function cell(rec) {
    const s = document.createElement('span');
    s.className = 'move-cell ' + (X.colorOf(rec.piece) === X.RED ? 'mv-red' : 'mv-black');
    s.textContent = NAME[X.typeOf(rec.piece)] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y);
    return s;
  }

  function applyMove(m) {
    if (!game) return;
    const rec = game.move(m.from, m.to);
    if (!rec) return;
    renderAll({ from: rec.from, to: rec.to });
    const st = game.status();
    if (st.over) {
      over = true;
      updateTurnBars();
      status('Ván kết thúc: ' + (st.reason === 'checkmate' ? 'Chiếu hết.' : 'Hết nước đi.'));
    } else if (st.check) {
      status((game.turn === 'r' ? 'Đỏ' : 'Đen') + ' đang bị chiếu!');
    } else {
      status('Đang xem: tới lượt ' + (game.turn === 'r' ? 'Đỏ' : 'Đen') + '.');
    }
  }

  function handle(msg) {
    switch (msg.type) {
      case 'spectate-start': {
        over = false;
        $('name-red').textContent = (msg.red || 'Đỏ') + ' (Đỏ)';
        $('name-black').textContent = (msg.black || 'Đen') + ' (Đen)';
        game = new X.Game();
        const ms = msg.moves || [];
        for (const m of ms) { if (!game.move(m.from, m.to)) break; }
        const last = ms.length ? ms[ms.length - 1] : null;
        renderAll(last);
        status('Đang xem trực tiếp — tới lượt ' + (game.turn === 'r' ? 'Đỏ' : 'Đen') + '.');
        break;
      }
      case 'move':
        applyMove(msg);
        break;
      case 'spectate-end':
        over = true;
        updateTurnBars();
        $('live-dot').style.display = 'none';
        status('🏁 ' + (msg.text || 'Trận đã kết thúc.'));
        break;
      case 'error':
        status('⚠ ' + (msg.message || 'Không xem được trận này.'));
        $('live-dot').style.display = 'none';
        break;
    }
  }

  function init() {
    const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase().trim();
    if (!code) { status('Thiếu mã trận đấu.'); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', name: 'Khán giả' }));
      ws.send(JSON.stringify({ type: 'spectate', code }));
      status('Đang vào xem trận ' + code + '…');
    };
    ws.onclose = () => { $('live-dot').style.display = 'none'; if (!over) status('Mất kết nối máy chủ.'); };
    ws.onerror = () => status('Lỗi kết nối máy chủ.');
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
