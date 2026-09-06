/*
 * play.js — Điều phối ván đấu Người (Đỏ) vs AI (Đen).
 * Phụ thuộc: xiangqi.js, board.js, api.js (đã nạp trước).
 */
(function () {
  'use strict';
  const X = window.Xiangqi;

  const state = {
    game: null,
    board: null,
    worker: null,
    difficulty: 'medium',
    totalSec: 600,
    timeLeft: { r: 600, b: 600 },
    timerId: null,
    capturedByRed: [], // quân Đen bị Đỏ ăn
    capturedByBlack: [],
    over: false,
    thinking: false,
    hinting: false,
    analysis: null,
    startTs: null,
  };

  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', P: 'Soldier' };

  /* ---------------- Âm thanh (Web Audio, không cần file) ---------------- */
  const Sound = (() => {
    let ctx = null;
    function tone(freq, dur, type, gain) {
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.value = gain || 0.06;
        o.connect(g);
        g.connect(ctx.destination);
        const t = ctx.currentTime;
        o.start(t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.stop(t + dur);
      } catch (e) {
        /* bỏ qua nếu trình duyệt chặn */
      }
    }
    return {
      move: () => tone(420, 0.08, 'triangle', 0.05),
      capture: () => {
        tone(220, 0.12, 'square', 0.06);
        setTimeout(() => tone(160, 0.1, 'square', 0.05), 50);
      },
      check: () => tone(880, 0.18, 'sawtooth', 0.05),
      end: () => {
        tone(523, 0.18, 'triangle', 0.07);
        setTimeout(() => tone(659, 0.18, 'triangle', 0.07), 140);
        setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 280);
      },
    };
  })();

  /* ---------------- Tiện ích ---------------- */
  const $ = (id) => document.getElementById(id);

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  }

  function sq(x, y) {
    return String.fromCharCode(65 + x) + (10 - y);
  }

  // Khoá thế cờ (để gửi cho AI tránh lặp nước)
  function boardKey(board) {
    let s = '';
    for (let y = 0; y < X.ROWS; y++) for (let x = 0; x < X.COLS; x++) s += board[y][x] || '.';
    return s;
  }

  /* ---------------- Khởi tạo ván ---------------- */
  function startGame(difficulty, minutes) {
    state.difficulty = difficulty;
    state.totalSec = minutes * 60;
    state.timeLeft = { r: state.totalSec, b: state.totalSec };
    state.capturedByRed = [];
    state.capturedByBlack = [];
    state.over = false;
    state.thinking = false;
    state.hinting = false;
    state.analysis = null;
    state.startTs = Date.now();
    state.game = new X.Game();
    state.positions = [boardKey(state.game.board)];

    if (!state.board) {
      state.board = new window.Board($('board'), {
        humanColor: X.RED,
        onMove: onHumanMove,
      });
    }
    state.board.clearSelection();
    state.board.setLastMove(null);
    state.board.hintMove = null;
    state.board.setInteractive(true);
    state.board.render(state.game);

    if (!state.worker) {
      state.worker = new Worker('js/engine/ai.worker.js?v=11');
      state.worker.onmessage = onAiReply;
    }

    renderHistory();
    renderCaptured();
    updateStatus('Your turn (Red)');
    startTimer();
    const ov = $('setup-overlay');
    if (ov) ov.classList.add('hidden');
  }

  /* ---------------- Đồng hồ ---------------- */
  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      if (state.over) return;
      const side = state.game.turn === X.RED ? 'r' : 'b';
      state.timeLeft[side] -= 1;
      renderTimers();
      if (state.timeLeft[side] <= 0) {
        endGame(side === 'r' ? X.BLACK : X.RED, 'Out of time');
      }
    }, 1000);
  }
  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }
  function renderTimers() {
    $('timer-red').textContent = fmtTime(state.timeLeft.r);
    $('timer-black').textContent = fmtTime(state.timeLeft.b);
    $('timer-red').parentElement.classList.toggle('active', state.game.turn === X.RED && !state.over);
    $('timer-black').parentElement.classList.toggle('active', state.game.turn === X.BLACK && !state.over);
  }

  /* ---------------- Lượt người ---------------- */
  function onHumanMove(from, to) {
    if (state.over || state.thinking) return;
    if (state.game.turn !== X.RED) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    afterMove(rec);
    if (state.over) return;
    // tới lượt AI
    triggerAi();
  }

  function triggerAi() {
    state.thinking = true;
    state.board.setInteractive(false);
    updateStatus('The computer is thinking…');
    // gửi bản sao bàn cờ cho worker
    const snapshot = state.game.board.map((r) => r.slice());
    // Tra "sổ tay tự học" trước (trừ mức Dễ, chỉ ở giai đoạn khai cuộc <30 nước —
    // nơi sổ có dữ liệu). Có nước đã được chứng minh -> đánh luôn.
    if (state.difficulty !== 'easy' && state.game.history.length < 30 && window.API && window.API.bookLookup) {
      window.API.bookLookup(snapshot)
        .then((res) => {
          if (state.over || !state.thinking) return;
          const mv = res && res.move;
          if (mv && isLegalAiMove(mv)) {
            setTimeout(() => { if (!state.over && state.thinking) applyAiMove(mv); }, 250);
          } else {
            askEngine(snapshot);
          }
        })
        .catch(() => askEngine(snapshot));
    } else {
      askEngine(snapshot);
    }
  }

  // Gọi engine (Web Worker) tính nước đi.
  function askEngine(snapshot) {
    setTimeout(() => {
      if (state.over || !state.thinking) return;
      state.worker.postMessage({ board: snapshot, difficulty: state.difficulty, recent: state.positions.slice(-12) });
    }, 120);
  }

  // Kiểm tra nước (từ sổ tay) có hợp lệ ở thế cờ hiện tại không (an toàn).
  function isLegalAiMove(mv) {
    if (!mv || !mv.from || !mv.to) return false;
    return state.game.legalMoves(X.BLACK).some(
      (m) => m.from.x === mv.from.x && m.from.y === mv.from.y && m.to.x === mv.to.x && m.to.y === mv.to.y
    );
  }

  // Áp dụng nước đi của AI (dùng chung cho sổ tay & engine).
  function applyAiMove(mv) {
    state.thinking = false;
    if (state.over) return;
    const rec = state.game.move(mv.from, mv.to);
    if (!rec) {
      state.board.setInteractive(true);
      return;
    }
    afterMove(rec);
    if (!state.over) {
      state.board.setInteractive(true);
      updateStatus('Your turn (Red)');
    }
  }

  function onAiReply(e) {
    // Trả lời cho yêu cầu GỢI Ý (không tự đi)
    if (e.data.tag === 'hint') {
      state.hinting = false;
      const hv = e.data.move;
      if (hv && state.board && state.board.setHint && !state.over) {
        state.board.setHint({ from: hv.from, to: hv.to });
        updateStatus('💡 Hint: ' + NAME[X.typeOf(state.game.board[hv.from.y][hv.from.x])] + ' ' + sq(hv.from.x, hv.from.y) + '→' + sq(hv.to.x, hv.to.y));
      } else {
        updateStatus('No hint available.');
      }
      const hb = $('btn-hint');
      if (hb) hb.disabled = false;
      return;
    }
    const mv = e.data.move;
    state.thinking = false;
    if (state.over) return;
    if (!mv) {
      // AI hết nước -> người thắng
      endGame(X.RED, 'Checkmate');
      return;
    }
    applyAiMove(mv);
  }

  // Gợi ý nước đi cho người (Đỏ) dùng engine ở mức mạnh.
  function requestHint() {
    if (state.over || state.thinking || state.hinting || !state.game) return;
    if (state.game.turn !== X.RED) return;
    state.hinting = true;
    const hb = $('btn-hint');
    if (hb) hb.disabled = true;
    updateStatus('Looking for a hint…');
    const snapshot = state.game.board.map((r) => r.slice());
    state.worker.postMessage({ board: snapshot, difficulty: 'hard', color: 'r', tag: 'hint' });
  }

  /* ---------------- Sau mỗi nước ---------------- */
  function afterMove(rec) {
    if (state.board && state.board.clearHint) state.board.clearHint();
    state.positions.push(boardKey(state.game.board));
    // quân bị ăn
    if (rec.captured) {
      const capColor = X.colorOf(rec.captured);
      if (capColor === X.BLACK) state.capturedByRed.push(rec.captured);
      else state.capturedByBlack.push(rec.captured);
    }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.render(state.game);
    renderCaptured();
    addHistory(rec);

    // âm thanh + trạng thái
    const st = state.game.status();
    if (st.over) {
      Sound.end();
      const winner = st.loser === X.RED ? X.BLACK : X.RED;
      endGame(winner, st.reason === 'checkmate' ? 'Checkmate' : 'Stalemate');
      return;
    }
    // Hoà do lặp lại thế cờ 3 lần
    const curKey = state.positions[state.positions.length - 1];
    let rep = 0;
    for (const k of state.positions) if (k === curKey) rep++;
    if (rep >= 3) {
      Sound.end();
      endDraw('Threefold repetition');
      return;
    }
    if (st.check) {
      Sound.check();
      updateStatus((st.check === X.RED ? 'Red' : 'Black') + ' is in check!');
    } else if (rec.captured) {
      Sound.capture();
    } else {
      Sound.move();
    }
    renderTimers();
  }

  /* ---------------- Kết thúc ---------------- */
  function endGame(winnerColor, reason) {
    if (state.over) return;
    state.over = true;
    state.thinking = false;
    stopTimer();
    state.board.setInteractive(false);
    const humanWon = winnerColor === X.RED;
    const result = humanWon ? 'You WIN! 🎉' : 'You LOSE';
    updateStatus(result + ' — ' + reason);
    showResultModal(result, reason);
    saveResult(humanWon ? 'win' : 'loss');
    learnBook(winnerColor === X.BLACK); // AI (Đen) thắng -> gia cố; thua -> giảm trọng số
  }

  function endDraw(reason) {
    if (state.over) return;
    state.over = true;
    state.thinking = false;
    stopTimer();
    state.board.setInteractive(false);
    updateStatus('Draw 🤝 — ' + reason);
    showResultModal('Draw 🤝', reason);
    saveResult('draw');
  }

  // Gửi ván đã kết thúc cho "sổ tay tự học" (AI cầm Đen). Học từ mọi mức trừ Dễ.
  function learnBook(blackWon) {
    if (state.difficulty === 'easy') return;
    if (!window.API || !window.API.bookLearn) return;
    const moves = state.game.history.map((h) => ({ from: h.from, to: h.to }));
    if (moves.length < 4) return;
    window.API.bookLearn(moves, blackWon).catch(() => {});
  }

  function showResultModal(title, reason) {
    const modal = $('result-modal');
    if (!modal) return;
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    modal.classList.remove('hidden');
  }

  async function saveResult(result) {
    // chỉ lưu nếu đã đăng nhập
    if (!window.API) return;
    try {
      const me = await window.API.me();
      if (!me || !me.user) return;
      const duration = Math.round((Date.now() - state.startTs) / 1000);
      await window.API.saveGame({
        opponent_type: 'ai-' + state.difficulty,
        result,
        moves_count: state.game.history.length,
        duration_sec: duration,
        pgn: JSON.stringify(state.game.history.map((h) => ({ from: h.from, to: h.to }))),
      });
    } catch (e) {
      /* không chặn người chơi nếu lưu lỗi */
    }
  }

  /* ---------------- Lịch sử & quân bị ăn ---------------- */
  function addHistory(rec) {
    renderHistory();
  }
  function renderHistory() {
    const list = $('move-list');
    if (!list) return;
    list.innerHTML = '';
    const h = state.game.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-no';
      num.textContent = i / 2 + 1 + '.';
      row.appendChild(num);
      row.appendChild(moveSpan(h[i], i));
      if (h[i + 1]) row.appendChild(moveSpan(h[i + 1], i + 1));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function moveSpan(rec, idx) {
    const s = document.createElement('span');
    s.className = 'move-cell ' + (X.colorOf(rec.piece) === X.RED ? 'mv-red' : 'mv-black');
    const t = X.typeOf(rec.piece);
    let label = NAME[t] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y);
    if (state.analysis && state.analysis[idx] === 'blunder') {
      s.classList.add('mv-blunder');
      label = '❌ ' + label;
      s.title = 'Blunder: material lost after this move';
    } else if (state.analysis && state.analysis[idx] === 'good') {
      s.classList.add('mv-good');
      label = '⭐ ' + label;
      s.title = 'Good move: wins material or position';
    }
    s.textContent = label;
    return s;
  }

  // Lượng giá vật chất thuần (theo góc nhìn Đỏ) để phát hiện nước mất quân.
  const MAT_VAL = { K: 0, R: 1200, C: 600, H: 550, E: 220, A: 220, P: 120 };
  function materialRed(board) {
    let s = 0;
    for (let y = 0; y < X.ROWS; y++)
      for (let x = 0; x < X.COLS; x++) {
        const p = board[y][x];
        if (p) s += X.colorOf(p) === X.RED ? MAT_VAL[X.typeOf(p)] : -MAT_VAL[X.typeOf(p)];
      }
    return s;
  }

  // Phân tích ván: đánh dấu nước Đỏ làm mất quân (❌) hoặc ăn quân/thắng thế (⭐).
  function analyzeGame() {
    const h = state.game.history;
    if (!h.length) {
      updateStatus('No moves to analyse yet.');
      return;
    }
    const g = new X.Game();
    const mat = [materialRed(g.board)];
    for (const rec of h) {
      g.move(rec.from, rec.to);
      mat.push(materialRed(g.board));
    }
    const ann = {};
    let blunders = 0, goods = 0, worst = null;
    for (let i = 0; i < h.length; i += 2) {
      // nước Đỏ ở chỉ số chẵn; so vật chất trước nước Đỏ và sau khi Đen đáp lại
      const before = mat[i];
      const after = i + 2 <= h.length ? mat[i + 2] : mat[i + 1];
      const delta = after - before;
      if (delta <= -250) {
        ann[i] = 'blunder';
        blunders++;
        if (!worst || delta < worst.delta) worst = { i, delta };
      } else if (delta >= 250) {
        ann[i] = 'good';
        goods++;
      }
    }
    state.analysis = ann;
    renderHistory();
    let msg = '🔍 Analysis: ' + blunders + ' blunders, ' + goods + ' good moves';
    if (worst) msg += '. Worst: move ' + (worst.i / 2 + 1);
    msg += '. (❌ lost material, ⭐ won material)';
    updateStatus(msg);
  }

  function renderCaptured() {
    const red = $('captured-red');
    const black = $('captured-black');
    if (red) red.innerHTML = state.capturedByRed.map((p) => chip(p)).join('');
    if (black) black.innerHTML = state.capturedByBlack.map((p) => chip(p)).join('');
  }
  function chip(p) {
    const c = X.colorOf(p);
    return '<span class="cap-chip ' + (c === X.RED ? 'red' : 'black') + '">' + GLYPH[c][X.typeOf(p)] + '</span>';
  }

  function updateStatus(msg) {
    const el = $('status-msg');
    if (el) el.textContent = msg;
  }

  /* ---------------- Undo & ván mới ---------------- */
  function undo() {
    if (state.over || state.thinking) return;
    // hoàn 2 nước (AI + người) để trở lại lượt người
    if (state.game.history.length === 0) return;
    popCaptured(state.game.undo());
    if (state.game.history.length > 0 && state.game.turn !== X.RED) {
      popCaptured(state.game.undo());
    }
    state.positions = state.positions.slice(0, state.game.history.length + 1);
    const last = state.game.history[state.game.history.length - 1];
    state.board.setLastMove(last ? { from: last.from, to: last.to } : null);
    state.board.clearSelection();
    state.board.setInteractive(true);
    state.board.render(state.game);
    renderHistory();
    renderCaptured();
    updateStatus('Move taken back. Your turn (Red)');
  }
  function popCaptured(rec) {
    if (!rec || !rec.captured) return;
    if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.pop();
    else state.capturedByBlack.pop();
  }

  /* ---------------- Gắn sự kiện UI ---------------- */
  function init() {
    renderTimers && void 0;
    const params = new URLSearchParams(location.search);
    const presetDiff = params.get('level');
    const presetTime = params.get('time');

    // nút bắt đầu trong overlay
    const startBtn = $('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const d = document.querySelector('input[name="difficulty"]:checked');
        const t = document.querySelector('input[name="time"]:checked');
        startGame(d ? d.value : 'medium', t ? parseInt(t.value, 10) : 10);
      });
    }

    const closeSetupBtn = $('btn-close-setup');
    if (closeSetupBtn) closeSetupBtn.addEventListener('click', () => {
      const ov = $('setup-overlay');
      if (ov) ov.classList.add('hidden');
    });

    const undoBtn = $('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', undo);

    const hintBtn = $('btn-hint');
    if (hintBtn) hintBtn.addEventListener('click', requestHint);

    const analyzeBtn = $('btn-analyze');
    if (analyzeBtn)
      analyzeBtn.addEventListener('click', () => {
        const modal = $('result-modal');
        if (modal) modal.classList.add('hidden');
        analyzeGame();
      });

    const newBtn = $('btn-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      stopTimer();
      const ov = $('setup-overlay');
      const modal = $('result-modal');
      if (modal) modal.classList.add('hidden');
      if (ov) ov.classList.remove('hidden');
    });

    const againBtn = $('btn-again');
    if (againBtn) againBtn.addEventListener('click', () => {
      const modal = $('result-modal');
      if (modal) modal.classList.add('hidden');
      startGame(state.difficulty, state.totalSec / 60);
    });

    const resignBtn = $('btn-resign');
    if (resignBtn) resignBtn.addEventListener('click', () => {
      if (!state.over && state.game) endGame(X.BLACK, 'You resigned');
    });

    // nếu có preset từ URL, vào thẳng
    if (presetDiff) {
      startGame(presetDiff, presetTime ? parseInt(presetTime, 10) : 10);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
