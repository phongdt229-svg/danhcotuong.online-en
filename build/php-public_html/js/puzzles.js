/*
 * puzzles.js — Cờ thế: nạp puzzles.json, cho người chơi tìm nước hay nhất.
 * Dùng lại xiangqi.js + board.js. Không cần đăng nhập.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const NAME = { K: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', P: 'Soldier' };
  const sq = (x, y) => String.fromCharCode(65 + x) + (10 - y);
  const status = (m) => { const e = $('status-msg'); if (e) e.textContent = m; };

  const state = {
    list: [], order: [], idx: 0, solved: 0, done: false,
    game: null, board: null, cur: null, attempts: 0, revealed: false,
  };

  function boardFromStr(s) {
    const b = [];
    let i = 0;
    for (let y = 0; y < 10; y++) {
      const row = [];
      for (let x = 0; x < 9; x++) { const c = s[i++]; row.push(c === '.' ? null : c); }
      b.push(row);
    }
    return b;
  }

  function sameMove(a, b) {
    return a.from.x === b.from.x && a.from.y === b.from.y && a.to.x === b.to.x && a.to.y === b.to.y;
  }

  function showProgress() {
    $('progress').textContent = 'Puzzle ' + (state.idx + 1) + '/' + state.order.length + ' · Solved: ' + state.solved;
  }

  function loadPuzzle() {
    const p = state.list[state.order[state.idx]];
    state.cur = p;
    state.attempts = 0;
    state.revealed = false;
    state.game = new X.Game(boardFromStr(p.b), p.turn);
    const humanColor = p.turn;
    if (!state.board) {
      state.board = new window.Board($('board'), { humanColor: humanColor, onMove: onTry });
    } else {
      state.board.opts.humanColor = humanColor;
    }
    // lật bàn để bên cần đi ở phía dưới
    const flip = p.turn === 'b';
    $('board').classList.toggle('flip', flip);
    const col = document.querySelector('.board-col');
    if (col) col.classList.toggle('flip', flip);

    state.board.hintMove = null;
    state.board.clearSelection();
    state.board.setLastMove(null);
    state.board.setInteractive(true);
    state.board.render(state.game);

    const sideVN = p.turn === 'r' ? 'Red' : 'Black';
    $('side-label').textContent = sideVN + ' to move';
    $('turn-label').textContent = sideVN + ' to move — find the best move!';
    $('bar-bottom').querySelector('.dot').className = 'dot ' + (p.turn === 'r' ? 'red' : 'black');
    status(p.score > 100000 ? '♟ There is a hidden CHECKMATE in this position!' : '♟ Find the move that wins material or the game!');
    $('btn-next').textContent = state.idx + 1 >= state.order.length ? 'Done' : 'Next puzzle →';
    showProgress();
  }

  function onTry(from, to) {
    if (state.revealed) return;
    const p = state.cur;
    const chosen = { from: from, to: to };
    if (sameMove(chosen, p.sol)) {
      // Đúng!
      state.game.move(from, to);
      state.board.setLastMove({ from: from, to: to });
      state.board.clearSelection();
      state.board.setInteractive(false);
      state.board.render(state.game);
      state.solved++;
      showProgress();
      status('✅ Correct! ' + NAME[typeAt(p)] + ' ' + sq(from.x, from.y) + '→' + sq(to.x, to.y) + '. Press "Next puzzle".');
    } else {
      state.attempts++;
      state.board.clearSelection();
      state.board.render(state.game);
      let msg = '❌ Not quite — try again!';
      if (state.attempts >= 3) msg += ' (Press 💡 Hint if you are stuck)';
      status(msg);
    }
  }

  function typeAt(p) {
    const pc = boardFromStr(p.b)[p.sol.from.y][p.sol.from.x];
    return X.typeOf(pc);
  }

  function showHint() {
    if (!state.cur || state.revealed) return;
    // Gợi ý: chỉ đánh dấu quân cần đi.
    if (state.board.setHint) state.board.setHint({ from: state.cur.sol.from, to: state.cur.sol.from });
    status('💡 The piece to move is on ' + sq(state.cur.sol.from.x, state.cur.sol.from.y) + '.');
  }

  function showSolution() {
    if (!state.cur) return;
    const p = state.cur;
    state.revealed = true;
    if (state.board.setHint) state.board.setHint({ from: p.sol.from, to: p.sol.to });
    state.board.setInteractive(false);
    status('👁 Solution: ' + NAME[typeAt(p)] + ' ' + sq(p.sol.from.x, p.sol.from.y) + '→' + sq(p.sol.to.x, p.sol.to.y));
  }

  function retry() {
    if (!state.cur) return;
    loadPuzzle();
  }

  function next() {
    if (state.idx + 1 >= state.order.length) {
      status('🎉 All done! You solved ' + state.solved + '/' + state.order.length + ' puzzles.');
      return;
    }
    state.idx++;
    loadPuzzle();
  }

  function shuffle(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  async function init() {
    $('btn-hint').addEventListener('click', showHint);
    $('btn-solution').addEventListener('click', showSolution);
    $('btn-retry').addEventListener('click', retry);
    $('btn-next').addEventListener('click', next);
    try {
      const res = await fetch('puzzles.json?v=7');
      state.list = await res.json();
    } catch (e) {
      state.list = [];
    }
    if (!state.list.length) {
      status('No puzzles available.');
      return;
    }
    state.order = shuffle(state.list.length);
    state.idx = 0;
    loadPuzzle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
