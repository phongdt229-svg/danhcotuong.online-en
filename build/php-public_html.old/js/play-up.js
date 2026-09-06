/*
 * play-up.js — Cờ ÚP với máy (client-side).
 * Ý tưởng tái dùng xiangqi.js: ô cờ mang "chữ" = KIỂU DI CHUYỂN hiện tại
 *   - quân úp: chữ = vai trò ô gốc (Xe/Mã/…)
 *   - quân đã lật / Tướng: chữ = quân thật
 * Lớp state.meta lưu quân THẬT ẩn + đã lật chưa. Đi nước đầu -> lật.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', P: 'Soldier' };
  const sq = (x, y) => String.fromCharCode(65 + x) + (10 - y);
  const status = (m) => { const e = $('status-msg'); if (e) e.textContent = m; };

  const Sound = (() => {
    let ctx = null;
    function tone(f, d, t, g) { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t || 'sine'; o.frequency.value = f; gn.gain.value = g || 0.05; o.connect(gn); gn.connect(ctx.destination); const n = ctx.currentTime; o.start(n); gn.gain.exponentialRampToValueAtTime(0.0001, n + d); o.stop(n + d); } catch (e) {} }
    return {
      move: () => tone(420, 0.08, 'triangle', 0.05),
      flip: () => { tone(600, 0.07, 'sine', 0.06); setTimeout(() => tone(880, 0.09, 'sine', 0.05), 60); },
      capture: () => { tone(220, 0.12, 'square', 0.06); },
      check: () => tone(880, 0.18, 'sawtooth', 0.05),
      end: () => { tone(523, 0.18, 'triangle', 0.07); setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 180); },
    };
  })();

  const state = {
    game: null, board: null, worker: null, meta: null,
    difficulty: 'medium', over: false, thinking: false,
    capturedByRed: [], capturedByBlack: [], history: [], positions: [], startTs: null,
  };

  // Khoá thế cờ (để chống lặp + phát hiện hoà do lặp)
  function boardKey() {
    let s = '';
    const b = state.game.board;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) s += b[y][x] || '.';
    return s;
  }
  function repeatCount() {
    const k = state.positions[state.positions.length - 1];
    let c = 0;
    for (const p of state.positions) if (p === k) c++;
    return c;
  }

  /* ---------- Thiết lập cờ úp ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildMeta() {
    const meta = Array.from({ length: 10 }, () => Array(9).fill(null));
    const g = state.game;
    const TYPES = ['R', 'R', 'H', 'H', 'E', 'E', 'A', 'A', 'C', 'C', 'P', 'P', 'P', 'P', 'P']; // 15 quân (trừ Tướng)
    [X.RED, X.BLACK].forEach((color) => {
      const squares = [];
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 9; x++) {
          const p = g.board[y][x];
          if (p && X.colorOf(p) === color) {
            if (X.typeOf(p) === 'K') meta[y][x] = { trueType: 'K', revealed: true };
            else squares.push({ x, y });
          }
        }
      const shuf = shuffle(TYPES.slice());
      squares.forEach((s, i) => { meta[s.y][s.x] = { trueType: shuf[i], revealed: false }; });
    });
    return meta;
  }
  function isCovered(x, y) { const m = state.meta && state.meta[y][x]; return !!(m && !m.revealed); }

  // Tự che quân úp sau mỗi lần bàn cờ vẽ lại — KHÔNG phụ thuộc board.js/board.css
  // (dùng style inline nên chạy được kể cả khi board.js/board.css là bản cũ).
  function maskCovered() {
    const layer = state.board && state.board.layer;
    if (!layer || !layer.querySelectorAll) return;
    const els = layer.querySelectorAll('.bpiece');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const x = Math.round((parseFloat(el.style.left) / 100) * 8);
      const y = Math.round((parseFloat(el.style.top) / 100) * 9);
      if (x >= 0 && x < 9 && y >= 0 && y < 10 && isCovered(x, y)) {
        el.classList.add('covered');
        el.textContent = '?';
        el.style.background = 'radial-gradient(circle at 32% 30%, #8a949f, #4a5560 72%)';
        el.style.color = 'rgba(255,255,255,0.8)';
      }
    }
  }

  /* ---------- Bắt đầu ván ---------- */
  function startGame(diff) {
    state.difficulty = diff;
    state.over = false; state.thinking = false;
    state.capturedByRed = []; state.capturedByBlack = []; state.history = [];
    state.startTs = Date.now();
    state.game = new X.Game(); // chữ ô = vai trò gốc (đúng sơ đồ ban đầu)
    state.meta = buildMeta();
    state.positions = [boardKey()];

    if (!state.board) {
      state.board = new window.Board($('board'), { humanColor: X.RED, onMove: onHumanMove, coveredFn: isCovered });
      // Bọc render: mọi lần vẽ (kể cả khi board.js tự vẽ lúc chọn quân) đều che quân úp.
      const _render = state.board.render.bind(state.board);
      state.board.render = function (g) { _render(g); maskCovered(); };
    }
    state.board.clearSelection();
    state.board.setLastMove(null);
    state.board.hintMove = null;
    state.board.setInteractive(true);
    state.board.render(state.game);

    if (!state.worker) { state.worker = new Worker('js/engine/ai.worker.js?v=11'); state.worker.onmessage = onAiReply; }

    renderCaptured(); renderHistory(); updateBars();
    status('Your turn (Red). Face-down pieces move by their square — they flip once moved!');
    const ov = $('setup-overlay'); if (ov) ov.classList.add('hidden');
  }

  /* ---------- Áp dụng nước đi (kèm lật) ---------- */
  function applyMove(from, to) {
    const meta = state.meta;
    const fromMeta = meta[from.y][from.x];
    const wasCovered = fromMeta && !fromMeta.revealed;
    const capturedMeta = meta[to.y][to.x]; // quân bị ăn (nếu có)
    const rec = state.game.move(from, to);
    if (!rec) return null;

    meta[to.y][to.x] = fromMeta || { trueType: X.typeOf(rec.piece), revealed: true };
    meta[from.y][from.x] = null;
    let flipped = false;
    if (wasCovered) {
      meta[to.y][to.x].revealed = true;
      const isRed = X.colorOf(state.game.board[to.y][to.x]) === X.RED;
      const tt = fromMeta.trueType;
      state.game.board[to.y][to.x] = isRed ? tt : tt.toLowerCase(); // đổi chữ ô -> quân thật
      flipped = true;
    }
    afterMove(rec, capturedMeta, flipped);
    return rec;
  }

  function afterMove(rec, capturedMeta, flipped) {
    if (rec.captured) {
      const capColor = X.colorOf(rec.captured);
      const capType = capturedMeta ? capturedMeta.trueType : X.typeOf(rec.captured); // lộ quân thật khi bị ăn
      const capLetter = capColor === X.RED ? capType : capType.toLowerCase();
      if (capColor === X.BLACK) state.capturedByRed.push(capLetter);
      else state.capturedByBlack.push(capLetter);
    }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.clearSelection();
    state.board.render(state.game);

    const destLetter = state.game.board[rec.to.y][rec.to.x]; // sau khi lật = quân hiển thị
    state.history.push({ piece: destLetter, from: rec.from, to: rec.to, flipped: flipped });
    state.positions.push(boardKey());
    renderCaptured(); renderHistory(); updateBars();

    const st = state.game.status();
    if (st.over) {
      const winner = st.loser === X.RED ? X.BLACK : X.RED;
      Sound.end();
      endGame(winner, st.reason === 'checkmate' ? 'Checkmate' : 'Stalemate');
      return;
    }
    // Hoà do lặp lại thế cờ 3 lần (tránh treo ván)
    if (repeatCount() >= 3) {
      Sound.end();
      endDraw('Threefold repetition');
      return;
    }
    if (st.check) { Sound.check(); status((st.check === X.RED ? 'Red' : 'Black') + ' is in check!'); }
    else if (flipped) Sound.flip();
    else if (rec.captured) Sound.capture();
    else Sound.move();
  }

  /* ---------- Lượt người & máy ---------- */
  function onHumanMove(from, to) {
    if (state.over || state.thinking) return;
    if (state.game.turn !== X.RED) return;
    const rec = applyMove(from, to);
    if (!rec) return;
    if (state.over) return;
    triggerAi();
  }

  function triggerAi() {
    state.thinking = true;
    state.board.setInteractive(false);
    status('The computer is thinking…');
    const snapshot = state.game.board.map((r) => r.slice());
    setTimeout(() => {
      if (state.over) return;
      state.worker.postMessage({ board: snapshot, difficulty: state.difficulty, color: 'b', recent: state.positions.slice(-12) });
    }, 130);
  }

  function onAiReply(e) {
    state.thinking = false;
    if (state.over) return;
    const mv = e.data.move;
    if (!mv) { endGame(X.RED, 'Checkmate'); return; }
    applyMove(mv.from, mv.to);
    if (!state.over) {
      state.board.setInteractive(true);
      if (!state.game.status().check) status('Your turn (Red)');
    }
  }

  /* ---------- Kết thúc ---------- */
  function endGame(winnerColor, reason) {
    if (state.over) return;
    state.over = true; state.thinking = false;
    state.board.setInteractive(false);
    const humanWon = winnerColor === X.RED;
    const title = humanWon ? 'You WIN! 🎉' : 'You LOSE';
    status(title + ' — ' + reason);
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    $('result-modal').classList.remove('hidden');
    saveResult(humanWon ? 'win' : 'loss');
  }

  function endDraw(reason) {
    if (state.over) return;
    state.over = true; state.thinking = false;
    state.board.setInteractive(false);
    status('Draw 🤝 — ' + reason);
    $('result-title').textContent = 'Draw 🤝';
    $('result-reason').textContent = reason;
    $('result-modal').classList.remove('hidden');
    saveResult('draw');
  }

  async function saveResult(result) {
    if (!window.API) return;
    try {
      const me = await window.API.me();
      if (!me || !me.user) return;
      await window.API.saveGame({
        opponent_type: 'coup-' + state.difficulty,
        result,
        moves_count: state.history.length,
        duration_sec: Math.round((Date.now() - state.startTs) / 1000),
        pgn: JSON.stringify(state.history.map((h) => ({ from: h.from, to: h.to }))),
      });
    } catch (e) {}
  }

  /* ---------- Render phụ ---------- */
  function updateBars() {
    $('bar-red').classList.toggle('active', state.game && state.game.turn === X.RED && !state.over);
    $('bar-black').classList.toggle('active', state.game && state.game.turn === X.BLACK && !state.over);
  }
  function renderHistory() {
    const list = $('move-list'); if (!list) return;
    list.innerHTML = '';
    const h = state.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div'); row.className = 'move-row';
      const num = document.createElement('span'); num.className = 'move-no'; num.textContent = i / 2 + 1 + '.';
      row.appendChild(num); row.appendChild(moveSpan(h[i])); if (h[i + 1]) row.appendChild(moveSpan(h[i + 1]));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function moveSpan(rec) {
    const s = document.createElement('span');
    const isRed = X.colorOf(rec.piece) === X.RED;
    s.className = 'move-cell ' + (isRed ? 'mv-red' : 'mv-black');
    s.textContent = (rec.flipped ? '🎴' : '') + NAME[X.typeOf(rec.piece)] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y);
    return s;
  }
  function renderCaptured() {
    const r = $('captured-red'), b = $('captured-black');
    if (r) r.innerHTML = state.capturedByRed.map(chip).join('');
    if (b) b.innerHTML = state.capturedByBlack.map(chip).join('');
  }
  function chip(p) { const c = X.colorOf(p); return '<span class="cap-chip ' + (c === X.RED ? 'red' : 'black') + '">' + GLYPH[c][X.typeOf(p)] + '</span>'; }

  /* ---------- UI ---------- */
  function init() {
    const startBtn = $('btn-start');
    if (startBtn) startBtn.addEventListener('click', () => {
      const d = document.querySelector('input[name="difficulty"]:checked');
      startGame(d ? d.value : 'medium');
    });
    const closeSetup = $('btn-close-setup');
    if (closeSetup) closeSetup.addEventListener('click', () => { const ov = $('setup-overlay'); if (ov) ov.classList.add('hidden'); });
    const newBtn = $('btn-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      const modal = $('result-modal'); if (modal) modal.classList.add('hidden');
      const ov = $('setup-overlay'); if (ov) ov.classList.remove('hidden');
    });
    const againBtn = $('btn-again');
    if (againBtn) againBtn.addEventListener('click', () => {
      const modal = $('result-modal'); if (modal) modal.classList.add('hidden');
      startGame(state.difficulty);
    });
    const resignBtn = $('btn-resign');
    if (resignBtn) resignBtn.addEventListener('click', () => { if (!state.over && state.game) endGame(X.BLACK, 'You resigned'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
