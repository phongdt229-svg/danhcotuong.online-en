/*
 * play-online.js — Đấu Cờ Tướng NGƯỜI với NGƯỜI bằng POLLING (bản PHP, không WebSocket).
 * Cứ ~1.5s hỏi server lấy nước đi mới của đối thủ. Tái dùng xiangqi.js + board.js.
 *
 * MỌI TRẬN ĐỀU CÓ CƯỢC ĐIỂM. Trang này chỉ HIỂN THỊ — server mới là nơi quyết định:
 *   - server kiểm luật từng nước (nước phạm luật bị trả về 'illegal'),
 *   - server tự kết luận ai thắng và tự chia điểm,
 *   - trang này KHÔNG gửi kết quả ván lên nữa (trước đây có, và đó là lỗ hổng ăn cược).
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 1500;

  const state = {
    code: null, token: null, myColor: null,
    game: null, board: null, started: false, over: false,
    applied: 0, // số nước đã áp dụng (mình + đối thủ)
    pollTimer: null, name: 'Guest', startTs: null, auto: null, loggedIn: false,
    balance: 0, minStake: 150, winnerPercent: 80, housePercent: 20,
    stake: 0, pot: 0, settled: false,
    capturedByRed: [], capturedByBlack: [],
    seenRooms: null,  // mã phòng đã thấy, để chỉ báo phòng MỚI (null = chưa tải lần nào)
    seenOnline: null, // tên người đã thấy online, để chỉ báo người MỚI vào
    onlineCount: 0,
  };

  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', P: 'Soldier' };

  const Sound = (() => {
    let ctx = null;
    function tone(f, d, t, g) { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t || 'sine'; o.frequency.value = f; gn.gain.value = g || 0.05; o.connect(gn); gn.connect(ctx.destination); const n = ctx.currentTime; o.start(n); gn.gain.exponentialRampToValueAtTime(0.0001, n + d); o.stop(n + d); } catch (e) {} }
    return { move: () => tone(420, 0.08, 'triangle', 0.05), capture: () => { tone(220, 0.12, 'square', 0.06); }, check: () => tone(880, 0.18, 'sawtooth', 0.05), end: () => { tone(523, 0.18, 'triangle', 0.07); setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 200); } };
  })();

  const sq = (x, y) => String.fromCharCode(65 + x) + (10 - y);
  const status = (m) => { const e = $('status-msg'); if (e) e.textContent = m; };
  const lobbyStatus = (m) => { const e = $('lobby-status'); if (e) e.textContent = m; };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const fmtPts = (n) => Number(n || 0).toLocaleString('en-US');

  /* ---------------- Sảnh ---------------- */
  function showWaiting(text, code) {
    $('waiting-box').classList.remove('hidden');
    $('waiting-msg').textContent = text;
    const cb = $('code-box');
    if (code) { cb.classList.remove('hidden'); $('room-code').textContent = code; } else cb.classList.add('hidden');
  }
  function hideWaiting() { $('waiting-box').classList.add('hidden'); }

  function requireLoginUI() {
    const m = $('login-modal');
    if (m) m.classList.remove('hidden');
    lobbyStatus('You need to sign in to play against other people.');
    hideWaiting();
  }

  // Hiện số dư + mức cược tối thiểu, khoá nút nếu không đủ điểm.
  function paintStakeUI() {
    const bal = $('lobby-balance');
    if (bal) bal.textContent = fmtPts(state.balance);
    const input = $('stake-input');
    if (input) {
      input.min = String(state.minStake);
      if (!input.value) input.value = String(state.minStake);
    }
    const note = $('stake-note');
    if (note) {
      note.textContent =
        'Minimum ' + fmtPts(state.minStake) + ' points. Winner takes ' + state.winnerPercent +
        '% of the pot, ' + state.housePercent + '% goes to the house. A draw refunds both players.';
    }
    // KHÔNG khoá nút: nút khoá thì bấm vào im lặng, người dùng không hiểu vì sao.
    // Để nút bấm được, và khi thiếu điểm thì hiện thông báo giải thích (xem currentStake).
    const poor = state.loggedIn && state.balance < state.minStake;
    ['btn-quick', 'btn-create'].forEach((id) => {
      const b = $(id);
      if (b) { b.disabled = false; b.classList.toggle('btn-need-points', poor); }
    });
    const warn = $('stake-warning');
    if (warn) {
      warn.style.display = poor ? '' : 'none';
      warn.innerHTML = poor
        ? 'You have ' + fmtPts(state.balance) + ' points — you need at least ' + fmtPts(state.minStake) +
          ' to play. <a href="topup.html">Buy points</a>.'
        : '';
    }
  }

  function currentStake() {
    const input = $('stake-input');
    const v = Math.floor(Number(input ? input.value : state.minStake));
    if (!Number.isFinite(v) || v < state.minStake) {
      lobbyStatus('Stake must be at least ' + fmtPts(state.minStake) + ' points.');
      return null;
    }
    if (v > state.balance) {
      notEnough(v); // toast nói rõ thiếu bao nhiêu + lối sang trang nạp
      return null;
    }
    return v;
  }

  async function refreshRooms() {
    try {
      const data = await window.API.matchList();
      renderRooms((data && data.rooms) || []);
      notifyOnline((data && data.online) || []);
    } catch (e) {}
  }

  /*
   * Báo phòng MỚI xuất hiện. So với lần trước để không báo lại mỗi 4 giây.
   * Lần tải đầu chỉ ghi nhớ, không đổ một loạt thông báo.
   */
  function notifyNewRooms(list) {
    const seen = state.seenRooms;
    const now = new Set(list.map((r) => r.code));
    if (seen !== null && !state.started) {
      list.forEach((r) => {
        if (seen.has(r.code)) return;
        const enough = Number(r.stake) <= state.balance;
        window.UI.toast(r.host + ' opened a room', {
          kind: 'room',
          icon: '將',
          sub: enough
            ? '💰 ' + fmtPts(r.stake) + ' points stake · room #' + r.code
            : '💰 ' + fmtPts(r.stake) + ' points stake · you need ' + fmtPts(Number(r.stake) - state.balance) + ' more',
          cta: enough ? '▶ Join now' : 'Buy points →',
          timeout: 12000,
          onClick: () => (enough ? doJoin(r.code) : notEnough(r.stake)),
        });
      });
    }
    state.seenRooms = now;
  }

  // Báo người MỚI online (server trả danh sách người hoạt động trong 30 giây gần đây).
  function notifyOnline(names) {
    const others = names.filter((n) => n !== state.name);
    const seen = state.seenOnline;
    const now = new Set(others);
    state.onlineCount = names.length;
    paintOnlineCount();
    if (seen !== null && !state.started) {
      others.forEach((n) => {
        if (seen.has(n)) return;
        window.UI.toast(n + ' is online', {
          kind: 'ok',
          sub: names.length + ' player' + (names.length === 1 ? '' : 's') + ' online now',
          timeout: 4000,
        });
      });
    }
    state.seenOnline = now;
  }

  function paintOnlineCount() {
    const el = $('online-count');
    if (!el) return;
    const n = state.onlineCount || 0;
    el.textContent = n + ' online';
    el.style.display = n > 0 ? '' : 'none';
  }

  // Thông báo rõ ràng khi không đủ điểm (kèm lối đi nạp thêm).
  function notEnough(stake) {
    const missing = Number(stake) - state.balance;
    window.UI.toast('Not enough points', {
      kind: 'warn',
      sub: 'Stake ' + fmtPts(stake) + ' · you have ' + fmtPts(state.balance) +
           ' · you need ' + fmtPts(missing) + ' more. Click to buy points.',
      timeout: 8000,
      onClick: () => (location.href = 'topup.html'),
    });
    lobbyStatus('You need ' + fmtPts(stake) + ' points for that room — you have ' + fmtPts(state.balance) + '.');
  }

  function renderRooms(list) {
    notifyNewRooms(list);
    const box = $('room-list');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="room-empty">No rooms yet. Create one!</div>'; return; }
    list.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const enough = Number(r.stake) <= state.balance;
      const info = document.createElement('span');
      info.className = 'room-info';
      info.innerHTML =
        '<b>' + escapeHtml(r.host) + '</b><span class="room-code-sm">#' + escapeHtml(r.code) + '</span>' +
        '<span class="room-code-sm' + (enough ? '' : ' stake-short') + '">💰 ' + fmtPts(r.stake) + ' pts</span>';
      const btn = document.createElement('button');
      btn.className = 'btn ' + (enough ? 'btn-primary' : 'btn-ghost');
      btn.textContent = enough ? 'Join' : 'Need points';
      // KHÔNG khoá nút: bấm vào phải giải thích được vì sao chưa vào được.
      btn.title = enough ? '' : 'You do not have enough points for this room';
      btn.addEventListener('click', () => (enough ? doJoin(r.code) : notEnough(r.stake)));
      row.appendChild(info); row.appendChild(btn);
      box.appendChild(row);
    });
  }

  /* ---------------- Vào trận ---------------- */
  async function doQuick() {
    if (!state.loggedIn) return requireLoginUI();
    const stake = currentStake();
    if (stake === null) return;
    try {
      const r = await window.API.matchQuick(stake);
      state.code = r.code; state.token = r.token; state.myColor = r.color; state.stake = r.stake;
      if (r.waiting) showWaiting('Looking for an opponent staking ' + fmtPts(stake) + ' points…', null);
      startPoll();
    } catch (e) { lobbyStatus(e.message || 'Could not find a match.'); }
  }
  async function doCreate() {
    if (!state.loggedIn) return requireLoginUI();
    const stake = currentStake();
    if (stake === null) return;
    try {
      const r = await window.API.matchCreate(stake);
      state.code = r.code; state.token = r.token; state.myColor = r.color; state.stake = r.stake;
      showWaiting('Waiting for someone to join (' + fmtPts(stake) + ' points)…', r.code);
      startPoll();
    } catch (e) { lobbyStatus(e.message || 'Could not create the room.'); }
  }
  async function doJoin(code) {
    if (!state.loggedIn) return requireLoginUI();
    code = (code || '').toUpperCase().trim();
    if (code.length < 3) { lobbyStatus('Enter a valid room code.'); return; }
    try {
      const r = await window.API.matchJoin(code);
      state.code = r.code; state.token = r.token; state.myColor = r.color; state.stake = r.stake;
      startPoll();
    } catch (e) {
      lobbyStatus((e && e.data && e.data.error) || e.message || 'Could not join that room.');
    }
  }

  /* ---------------- Polling ---------------- */
  function startPoll() { stopPoll(); poll(); state.pollTimer = setInterval(poll, POLL_MS); }
  function stopPoll() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

  async function poll() {
    if (!state.code || !state.token) return;
    let s;
    try { s = await window.API.matchState(state.code, state.token, state.applied); }
    catch (e) { return; }
    if (!s) return;

    if (!state.started) {
      if (s.status === 'playing') beginGame(s);
      else if (s.status === 'ended') { lobbyStatus('The game has ended.'); stopPoll(); }
      return;
    }

    // Áp dụng nước đi mới của đối thủ (server đã kiểm luật rồi mới lưu).
    if (s.moves && s.moves.length) {
      for (const m of s.moves) {
        const rec = state.game.move(m.from, m.to);
        if (rec) { afterMove(rec); state.applied++; }
      }
    }
    renderChat(s.chat || []);

    if (s.status === 'ended') {
      if (s.settlement) showSettlement(s.settlement);
      if (!state.over) {
        const result = s.winner ? (s.winner === state.myColor ? 'win' : 'loss') : null;
        finish(result, s.result || 'Game over.');
      }
      stopPoll();
    } else if (!state.over) {
      const my = state.game.turn === state.myColor;
      if (s.opponentOnline === false) status('⚠ Your opponent lost connection…');
      else status(my ? 'YOUR turn to move.' : 'Waiting for your opponent…');
    }
  }

  /* ---------------- Bắt đầu ---------------- */
  function beginGame(s) {
    state.started = true; state.over = false; state.settled = false; state.startTs = Date.now();
    state.applied = 0; state.capturedByRed = []; state.capturedByBlack = [];
    state.stake = Number(s.stake) || state.stake || 0;
    state.pot = Number(s.pot) || state.stake * 2;
    state.game = new X.Game();
    state.board = new window.Board($('board'), { humanColor: state.myColor, onMove: onMyMove });
    const flip = state.myColor === 'b';
    $('board').classList.toggle('flip', flip);
    const col = document.querySelector('.board-col'); if (col) col.classList.toggle('flip', flip);
    state.board.clearSelection(); state.board.setLastMove(null); state.board.render(state.game);

    const opp = state.myColor === 'r' ? (s.black || 'Opponent') : (s.red || 'Opponent');
    if (state.myColor === 'r') { $('name-red').textContent = state.name + ' (You — Red)'; $('name-black').textContent = opp + ' (Black)'; }
    else { $('name-red').textContent = opp + ' (Red)'; $('name-black').textContent = state.name + ' (You — Black)'; }

    const sb = $('stake-banner');
    if (sb && state.stake > 0) {
      sb.style.display = '';
      sb.textContent = '💰 Staked game — ' + fmtPts(state.stake) + ' points each, pot ' + fmtPts(state.pot) +
        '. Winner takes ' + fmtPts(Math.floor((state.pot * state.winnerPercent) / 100)) + '.';
    }

    $('btn-resign').disabled = false;
    $('lobby-overlay').classList.add('hidden');
    $('result-modal').classList.add('hidden');
    hideWaiting();
    renderCaptured(); renderHistory(); updateTurn();

    // Vào giữa chừng: áp dụng các nước đã có.
    if (s.moves && s.moves.length) {
      for (const m of s.moves) { const rec = state.game.move(m.from, m.to); if (rec) { afterMove(rec); state.applied++; } }
    }
  }

  function updateTurn() {
    if (state.over || !state.game) return;
    const my = state.game.turn === state.myColor;
    state.board.setInteractive(my);
    $('bar-red').classList.toggle('active', state.game.turn === 'r');
    $('bar-black').classList.toggle('active', state.game.turn === 'b');
    status(my ? 'YOUR turn to move.' : 'Waiting for your opponent…');
  }

  /* ---------------- Nước đi ---------------- */
  async function onMyMove(from, to) {
    if (state.over || state.game.turn !== state.myColor) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    state.applied++;
    afterMove(rec);
    try {
      await window.API.matchMove(state.code, state.token, from, to);
    } catch (e) {
      // Server từ chối (lệch thế cờ) -> tải lại cho chắc, tránh hai bên hiểu khác nhau.
      if (e && e.data && e.data.illegal) {
        status('That move was rejected by the server. Reloading…');
        setTimeout(() => location.reload(), 1200);
        return;
      }
    }
    poll(); // lấy kết quả ngay nếu nước vừa rồi là chiếu hết
  }

  function afterMove(rec) {
    if (rec.captured) { if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.push(rec.captured); else state.capturedByBlack.push(rec.captured); }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.clearSelection();
    state.board.render(state.game);
    renderCaptured(); renderHistory();
    const st = state.game.status();
    if (st.check) Sound.check(); else if (rec.captured) Sound.capture(); else Sound.move();
    if (!state.over) updateTurn();
  }

  /* ---------------- Kết thúc ---------------- */
  function finish(result, reason) {
    if (state.over) return;
    state.over = true;
    stopPoll();
    if (state.board) state.board.setInteractive(false);
    $('btn-resign').disabled = true;
    $('bar-red').classList.remove('active'); $('bar-black').classList.remove('active');
    Sound.end();
    let title = 'Game over';
    if (result === 'win') title = 'You WIN! 🎉';
    else if (result === 'loss') title = 'You LOSE';
    status(title + ' — ' + reason);
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    $('result-modal').classList.remove('hidden');
    if (result) saveResult(result);
  }

  // Chi tiết chia điểm do SERVER gửi về (nguồn sự thật duy nhất).
  function showSettlement(m) {
    if (state.settled) return;
    state.settled = true;
    if (m.balance != null) { state.balance = m.balance; paintStakeUI(); }
    const el = $('result-stake');
    if (!el) return;
    el.style.display = '';
    if (m.outcome === 'draw') {
      el.textContent = '🤝 Draw — your ' + fmtPts(m.stake) + ' points were refunded. Balance: ' + fmtPts(m.balance) + '.';
    } else if (m.won) {
      el.textContent = '💰 You won ' + fmtPts(m.winnerPoints) + ' points from a ' + fmtPts(m.pot) +
        ' pot (house took ' + fmtPts(m.housePoints) + '). Balance: ' + fmtPts(m.balance) + '.';
    } else {
      el.textContent = '💸 You lost your ' + fmtPts(m.stake) + ' point stake. Balance: ' + fmtPts(m.balance) + '.';
    }
  }

  async function saveResult(result) {
    try {
      if (!state.game) return;
      const moves = state.game.history.map((h) => ({ from: h.from, to: h.to }));
      await window.API.saveGame({ opponent_type: 'pvp', result, moves_count: state.game.history.length, duration_sec: Math.round((Date.now() - state.startTs) / 1000), pgn: JSON.stringify(moves) });
    } catch (e) {}
  }

  /* ---------------- Lịch sử & quân ăn ---------------- */
  function renderHistory() {
    const list = $('move-list'); if (!list || !state.game) return;
    list.innerHTML = '';
    const h = state.game.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div'); row.className = 'move-row';
      const num = document.createElement('span'); num.className = 'move-no'; num.textContent = i / 2 + 1 + '.';
      row.appendChild(num); row.appendChild(moveSpan(h[i])); if (h[i + 1]) row.appendChild(moveSpan(h[i + 1]));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function moveSpan(rec) { const s = document.createElement('span'); s.className = 'move-cell ' + (X.colorOf(rec.piece) === X.RED ? 'mv-red' : 'mv-black'); s.textContent = NAME[X.typeOf(rec.piece)] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y); return s; }

  /* ---------------- Chat ---------------- */
  function renderChat(list) {
    const box = $('chat-box');
    if (!box || !Array.isArray(list)) return;
    // Bỏ tin nội bộ (lời đề nghị hoà) khỏi khung chat.
    const shown = list.filter((m) => (m.text || '') !== '__draw_offer__');
    if (box._n === shown.length) return;
    box._n = shown.length;
    box.innerHTML = shown
      .map((msg) => {
        const mine = msg.who === state.myColor;
        return '<div class="chat-msg ' + (mine ? 'mine' : '') + '"><span class="chat-name">' +
          escapeHtml(msg.name || '') + '</span>' + escapeHtml(msg.text || '') + '</div>';
      })
      .join('');
    box.scrollTop = box.scrollHeight;
  }
  async function sendChat() {
    const inp = $('chat-input');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || !state.code || !state.token) return;
    inp.value = '';
    try { await window.API.matchChat(state.code, state.token, text); poll(); } catch (e) {}
  }

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); if (cb) cb();
  }
  function copyInvite() {
    if (!state.code) return;
    const url = location.origin + location.pathname + '?join=' + state.code;
    const done = () => {
      const b = $('btn-copy-invite');
      if (b) { const t = b.textContent; b.textContent = '✓ Copied!'; setTimeout(() => (b.textContent = t), 1500); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
    else fallbackCopy(url, done);
  }
  function renderCaptured() { const r = $('captured-red'), b = $('captured-black'); if (r) r.innerHTML = state.capturedByRed.map(chip).join(''); if (b) b.innerHTML = state.capturedByBlack.map(chip).join(''); }
  function chip(p) { const c = X.colorOf(p); return '<span class="cap-chip ' + (c === X.RED ? 'red' : 'black') + '">' + GLYPH[c][X.typeOf(p)] + '</span>'; }

  /* ---------------- Reset ---------------- */
  function resetToLobby() {
    state.over = true; state.started = false; stopPoll();
    state.code = null; state.token = null; state.game = null; state.applied = 0;
    state.stake = 0; state.pot = 0; state.settled = false;
    if (state.board) { $('board').innerHTML = ''; $('board').classList.remove('flip'); const c = document.querySelector('.board-col'); if (c) c.classList.remove('flip'); state.board = null; }
    $('result-modal').classList.add('hidden');
    $('lobby-overlay').classList.remove('hidden');
    const rs = $('result-stake'); if (rs) rs.style.display = 'none';
    const sb = $('stake-banner'); if (sb) sb.style.display = 'none';
    const cb = $('chat-box'); if (cb) { cb.innerHTML = ''; cb._n = undefined; }
    hideWaiting();
    $('btn-resign').disabled = true;
    lobbyStatus('Choose how you want to play.');
    refreshBalance();
    refreshRooms();
  }

  async function refreshBalance() {
    if (!state.loggedIn) return;
    try {
      const r = await window.API.matchRules();
      state.balance = r.balance || 0;
      state.minStake = r.minStake || state.minStake;
      state.winnerPercent = r.winnerPercent != null ? r.winnerPercent : state.winnerPercent;
      state.housePercent = r.housePercent != null ? r.housePercent : state.housePercent;
      paintStakeUI();
    } catch (e) {}
  }

  async function init() {
    let me = null;
    try { me = window.API && (await window.API.me()); } catch (e) {}
    state.loggedIn = !!(me && me.user);
    state.name = state.loggedIn ? me.user.username : 'Guest';
    if (state.loggedIn) state.balance = Number(me.user.points) || 0;

    const p = new URLSearchParams(location.search);
    if (p.get('join')) state.auto = { t: 'join', code: String(p.get('join')).toUpperCase() };
    else if (p.get('create') === '1') state.auto = { t: 'create' };
    else if (p.get('quick') === '1') state.auto = { t: 'quick' };

    $('btn-quick').addEventListener('click', doQuick);
    $('btn-create').addEventListener('click', doCreate);
    $('btn-join').addEventListener('click', () => doJoin($('join-code').value));
    $('btn-refresh').addEventListener('click', refreshRooms);
    $('btn-cancel').addEventListener('click', () => { stopPoll(); hideWaiting(); state.code = null; state.token = null; lobbyStatus('Cancelled. Choose how you want to play.'); refreshRooms(); });
    $('btn-resign').addEventListener('click', async () => {
      if (state.over || !state.game) return;
      try { await window.API.matchResign(state.code, state.token); } catch (e) {}
      poll(); // server chia điểm xong, lấy kết quả về hiển thị
    });
    $('btn-new').addEventListener('click', resetToLobby);
    $('btn-again').addEventListener('click', resetToLobby);
    const cs = $('chat-send'); if (cs) cs.addEventListener('click', sendChat);
    const ci = $('chat-input'); if (ci) ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
    const bi = $('btn-copy-invite'); if (bi) bi.addEventListener('click', copyInvite);

    await refreshBalance();
    paintStakeUI();
    refreshRooms();
    setInterval(() => { if (!state.started && !state.pollTimer) { refreshRooms(); refreshBalance(); } }, 4000);

    if (!state.loggedIn) {
      lobbyStatus('You need to sign in to play against other people.');
      if (state.auto) requireLoginUI();
      return;
    }

    lobbyStatus('Choose how you want to play.');
    if (state.auto) {
      if (state.auto.t === 'join') doJoin(state.auto.code);
      else if (state.auto.t === 'create') doCreate();
      else if (state.auto.t === 'quick') doQuick();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
