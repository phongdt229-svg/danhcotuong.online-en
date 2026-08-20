/*
 * replay.js — Xem lại một ván đấu đã lưu (replay.html?id=N).
 * Tải ván qua API, phát lại các nước trên engine xiangqi.js + board.js.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const NAME = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  let moves = [];
  let idx = 0;
  let board = null;
  let game = null;
  let playTimer = null;

  function sq(x, y) { return String.fromCharCode(65 + x) + (10 - y); }

  function buildAt(k) {
    game = new X.Game();
    for (let i = 0; i < k; i++) {
      const m = moves[i];
      if (!m || !game.move(m.from, m.to)) break;
    }
  }

  function render() {
    buildAt(idx);
    if (!board) board = new window.Board($('board'), { humanColor: null });
    board.setInteractive(false);
    const last = idx > 0 ? moves[idx - 1] : null;
    board.setLastMove(last ? { from: last.from, to: last.to } : null);
    board.clearSelection();
    board.render(game);
    $('move-info').textContent = idx + ' / ' + moves.length;
    $('btn-first').disabled = $('btn-prev').disabled = idx === 0;
    $('btn-last').disabled = $('btn-next').disabled = idx === moves.length;
    renderMoveList();
  }

  function renderMoveList() {
    const list = $('move-list');
    if (!list) return;
    list.innerHTML = '';
    // dựng lại từng nước để biết quân & ô (phục vụ nhãn)
    const g = new X.Game();
    for (let i = 0; i < moves.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-no';
      num.textContent = i / 2 + 1 + '.';
      row.appendChild(num);
      row.appendChild(cell(g, moves[i], i));
      if (moves[i + 1]) row.appendChild(cell(g, moves[i + 1], i + 1));
      list.appendChild(row);
    }
  }

  function cell(g, m, i) {
    const s = document.createElement('span');
    const piece = g.board[m.from.y][m.from.x];
    const isRed = X.colorOf(piece) === X.RED;
    s.className = 'move-cell ' + (isRed ? 'mv-red' : 'mv-black');
    if (i === idx - 1) s.style.outline = '2px solid var(--c-accent)';
    s.style.cursor = 'pointer';
    s.textContent = (NAME[X.typeOf(piece)] || '?') + ' ' + sq(m.from.x, m.from.y) + '→' + sq(m.to.x, m.to.y);
    s.addEventListener('click', () => { stopPlay(); go(i + 1); });
    g.move(m.from, m.to); // tiến trạng thái cho nhãn nước kế
    return s;
  }

  function go(k) { idx = Math.max(0, Math.min(moves.length, k)); render(); }

  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (idx >= moves.length) idx = 0;
    $('btn-play').textContent = '⏸';
    playTimer = setInterval(() => {
      if (idx >= moves.length) { stopPlay(); return; }
      go(idx + 1);
    }, 900);
  }
  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    $('btn-play').textContent = '▶';
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const info = $('game-info');
    if (!id) { info.textContent = 'Thiếu mã ván đấu.'; return; }
    let g;
    try {
      const res = await window.API.gameDetail(id);
      g = res && res.game;
    } catch (e) {
      info.innerHTML = 'Không tải được ván đấu. <a href="login.html">Đăng nhập</a> rồi thử lại.';
      return;
    }
    if (!g) { info.textContent = 'Không tìm thấy ván đấu.'; return; }

    try { moves = JSON.parse(g.pgn || '[]'); } catch (e) { moves = []; }
    const resultText = { win: 'Thắng', loss: 'Thua', draw: 'Hòa' }[g.result] || g.result;
    const dt = new Date(g.created_at).toLocaleString('vi-VN');
    info.innerHTML =
      '<div><b>Đối thủ:</b> ' + g.opponent_type + '</div>' +
      '<div><b>Kết quả:</b> ' + resultText + '</div>' +
      '<div><b>Số nước:</b> ' + g.moves_count + '</div>' +
      '<div><b>Thời gian:</b> ' + dt + '</div>';
    $('info-red').textContent = 'Đỏ';
    $('info-black').textContent = 'Đen';

    if (!moves.length) {
      info.innerHTML += '<div class="text-muted" style="margin-top:8px">Ván này chưa lưu nước đi để xem lại.</div>';
    }

    $('btn-first').addEventListener('click', () => { stopPlay(); go(0); });
    $('btn-prev').addEventListener('click', () => { stopPlay(); go(idx - 1); });
    $('btn-next').addEventListener('click', () => { stopPlay(); go(idx + 1); });
    $('btn-last').addEventListener('click', () => { stopPlay(); go(moves.length); });
    $('btn-play').addEventListener('click', togglePlay);

    idx = 0;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
