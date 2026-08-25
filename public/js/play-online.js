/*
 * play-online.js — Đấu Cờ Tướng NGƯỜI với NGƯỜI qua WebSocket (/ws).
 *
 * Trước đây file này gọi REST /api/match/* của bản PHP — server Node không có
 * các route đó nên trang bị hỏng. Nay dùng thẳng backend WebSocket (server/realtime/match.js),
 * vốn tự kiểm tra luật cờ nên chống gian lận tốt hơn, và có sẵn phần cược điểm.
 *
 * Mọi trận với người đều CÓ CƯỢC: hai bên bị trừ tiền cược khi ván bắt đầu,
 * người thắng nhận phần lớn tổng cược, hòa thì hoàn lại. Server quyết định
 * toàn bộ việc cộng/trừ — trang này chỉ hiển thị.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);

  const state = {
    ws: null, code: null, myColor: null,
    game: null, board: null, started: false, over: false,
    name: 'Guest', startTs: null, auto: null, loggedIn: false,
    balance: 0, minStake: 150, winnerPercent: 80, housePercent: 20,
    stake: 0, pot: 0,
    capturedByRed: [], capturedByBlack: [],
    reconnectTimer: null,
    seenRooms: null, // mã các phòng đã thấy, để chỉ báo phòng MỚI (null = chưa tải lần nào)
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

  /* ---------------- Kết nối ---------------- */
  function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws');
    state.ws = ws;

    ws.onopen = () => { lobbyStatus('Connected. Choose how you want to play.'); wsSend({ type: 'list' }); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    ws.onclose = () => {
      if (state.started && !state.over) status('⚠ Lost connection to the server.');
      else lobbyStatus('Lost connection. Reconnecting…');
      // Thử nối lại để người chơi không phải tải lại trang.
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connect, 2000);
    };
    ws.onerror = () => {};
  }

  /* ---------------- Xử lý bản tin từ server ---------------- */
  function handle(m) {
    switch (m.type) {
      case 'welcome':
        state.loggedIn = Boolean(m.loggedIn);
        if (m.name) state.name = m.name;
        state.balance = m.balance || 0;
        state.onlineCount = (m.online || []).length;
        paintOnlineCount();
        state.minStake = m.minStake || 150;
        state.winnerPercent = m.winnerPercent || 80;
        state.housePercent = m.housePercent != null ? m.housePercent : 20;
        paintStakeUI();
        if (!state.loggedIn) { lobbyStatus('You need to sign in to play against other people.'); requireLoginUI(); }
        else if (state.auto) runAuto();
        break;

      case 'rooms':
        renderRooms(m.rooms || []);
        break;

      // Có người vừa online / offline (server chỉ gửi khi trạng thái THẬT SỰ đổi).
      case 'user-online':
        state.onlineCount = m.count || 0;
        paintOnlineCount();
        if (!state.started) {
          window.UI.toast(m.name + ' is online', {
            kind: 'ok',
            sub: m.count + ' player' + (m.count === 1 ? '' : 's') + ' online now',
            timeout: 4000,
          });
        }
        break;

      case 'user-offline':
        state.onlineCount = m.count || 0;
        paintOnlineCount();
        break;

      case 'balance':
        state.balance = m.balance || 0;
        paintStakeUI();
        break;

      case 'need-login':
        state.loggedIn = false;
        requireLoginUI();
        break;

      case 'stake-error':
        hideWaiting();
        lobbyStatus(m.message || 'Could not start the staked game.');
        $('lobby-overlay').classList.remove('hidden');
        break;

      case 'waiting':
        showWaiting('Looking for an opponent staking ' + fmtPts(m.stake) + ' points…', null);
        break;

      case 'created':
        state.code = m.code;
        showWaiting('Waiting for someone to join (' + fmtPts(m.stake) + ' points)…', m.code);
        break;

      case 'start':
        beginGame(m);
        break;

      case 'move': {
        if (!state.game || state.over) return;
        const rec = state.game.move(m.from, m.to);
        if (rec) afterMove(rec);
        break;
      }

      case 'illegal':
        // Server từ chối nước đi -> tải lại trang là cách chắc chắn nhất để đồng bộ.
        status('That move was rejected by the server. Reload if the board looks wrong.');
        break;

      case 'resign':
        finish('win', 'Your opponent resigned');
        break;

      case 'opponent-timeout':
        finish('win', 'Your opponent ran out of time');
        break;

      case 'opponent-left':
        finish('win', 'Your opponent left the game');
        break;

      case 'draw-accept':
        finish(null, 'Both players agreed to a draw');
        break;

      case 'chat':
        addChat(m.text, false);
        break;

      case 'stake-settled':
        showSettlement(m);
        break;

      case 'error':
        lobbyStatus(m.message || 'Something went wrong.');
        hideWaiting();
        break;
    }
  }

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
      input.placeholder = 'min ' + state.minStake;
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

  /*
   * Báo phòng MỚI xuất hiện. So danh sách lần này với lần trước để chỉ báo phòng
   * chưa từng thấy — không báo lại mỗi lần làm mới (4 giây/lần).
   * Lần đầu vào trang thì chỉ ghi nhớ, không đổ một loạt thông báo.
   */
  function notifyNewRooms(list) {
    const seen = state.seenRooms;
    const isFirstLoad = seen === null;
    const now = new Set(list.map((r) => r.code));

    if (!isFirstLoad && !state.started) {
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

  // Hiện số người đang online ở sảnh.
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
  function doQuick() {
    if (!state.loggedIn) return requireLoginUI();
    const stake = currentStake();
    if (stake === null) return;
    wsSend({ type: 'quick', stake });
  }
  function doCreate() {
    if (!state.loggedIn) return requireLoginUI();
    const stake = currentStake();
    if (stake === null) return;
    wsSend({ type: 'create', stake });
  }
  function doJoin(code) {
    if (!state.loggedIn) return requireLoginUI();
    code = (code || '').toUpperCase().trim();
    if (code.length < 3) { lobbyStatus('Enter a valid room code.'); return; }
    wsSend({ type: 'join', code });
  }

  /* ---------------- Bắt đầu ---------------- */
  function beginGame(s) {
    state.started = true; state.over = false; state.startTs = Date.now();
    state.myColor = s.color;
    state.stake = s.stake || 0;
    state.pot = s.pot || 0;
    state.capturedByRed = []; state.capturedByBlack = [];
    state.game = new X.Game();
    state.board = new window.Board($('board'), { humanColor: state.myColor, onMove: onMyMove });
    state.board.setHint = () => {}; state.board.clearHint = () => {}; state.board.hintMove = null;
    const flip = state.myColor === 'b';
    $('board').classList.toggle('flip', flip);
    const col = document.querySelector('.board-col'); if (col) col.classList.toggle('flip', flip);
    state.board.clearSelection(); state.board.setLastMove(null); state.board.render(state.game);

    const opp = s.opponent || 'Opponent';
    if (state.myColor === 'r') { $('name-red').textContent = state.name + ' (You — Red)'; $('name-black').textContent = opp + ' (Black)'; }
    else { $('name-red').textContent = opp + ' (Red)'; $('name-black').textContent = state.name + ' (You — Black)'; }

    const sb = $('stake-banner');
    if (sb) {
      sb.style.display = '';
      sb.textContent = '💰 Staked game — ' + fmtPts(state.stake) + ' points each, pot ' + fmtPts(state.pot) +
        '. Winner takes ' + fmtPts(Math.floor((state.pot * state.winnerPercent) / 100)) + '.';
    }

    $('btn-resign').disabled = false;
    $('lobby-overlay').classList.add('hidden');
    $('result-modal').classList.add('hidden');
    hideWaiting();
    const cb = $('chat-box'); if (cb) cb.innerHTML = '';
    renderCaptured(); renderHistory(); updateTurn();
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
  function onMyMove(from, to) {
    if (state.over || !state.game || state.game.turn !== state.myColor) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    afterMove(rec);
    wsSend({ type: 'move', from, to });
  }

  function afterMove(rec) {
    if (rec.captured) { if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.push(rec.captured); else state.capturedByBlack.push(rec.captured); }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.clearSelection();
    state.board.render(state.game);
    renderCaptured(); renderHistory();
    const st = state.game.status();
    if (st.check) Sound.check(); else if (rec.captured) Sound.capture(); else Sound.move();
    if (st.over) {
      // Server cũng tự phát hiện hết ván và chia điểm — ở đây chỉ hiện kết quả.
      const winner = st.loser === X.RED ? X.BLACK : X.RED;
      const iWon = winner === state.myColor;
      finish(iWon ? 'win' : 'loss',
        (iWon ? 'You' : 'Your opponent') + ' won (' + (st.reason === 'checkmate' ? 'checkmate' : 'stalemate') + ')');
      return;
    }
    if (!state.over) updateTurn();
  }

  /* ---------------- Kết thúc ---------------- */
  function finish(result, reason) {
    if (state.over) return;
    state.over = true;
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

  // Hiện chi tiết chia điểm do server gửi về (nguồn sự thật duy nhất).
  function showSettlement(m) {
    state.balance = m.balance != null ? m.balance : state.balance;
    paintStakeUI();
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
  function addChat(text, mine) {
    const box = $('chat-box');
    if (!box || !text) return;
    const div = document.createElement('div');
    div.className = 'chat-msg' + (mine ? ' mine' : '');
    div.innerHTML = '<span class="chat-name">' + escapeHtml(mine ? 'You' : 'Opponent') + '</span>' + escapeHtml(text);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function sendChat() {
    const inp = $('chat-input');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || !state.started) return;
    inp.value = '';
    wsSend({ type: 'chat', text });
    addChat(text, true);
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
    state.over = true; state.started = false;
    state.code = null; state.game = null; state.stake = 0; state.pot = 0;
    wsSend({ type: 'cancel' });
    if (state.board) { $('board').innerHTML = ''; $('board').classList.remove('flip'); const c = document.querySelector('.board-col'); if (c) c.classList.remove('flip'); state.board = null; }
    $('result-modal').classList.add('hidden');
    $('lobby-overlay').classList.remove('hidden');
    const rs = $('result-stake'); if (rs) rs.style.display = 'none';
    const sb = $('stake-banner'); if (sb) sb.style.display = 'none';
    const cb = $('chat-box'); if (cb) cb.innerHTML = '';
    hideWaiting();
    $('btn-resign').disabled = true;
    lobbyStatus('Choose how you want to play.');
    wsSend({ type: 'list' });
  }

  function runAuto() {
    if (!state.auto) return;
    const a = state.auto;
    state.auto = null;
    if (a.t === 'join') doJoin(a.code);
    else if (a.t === 'create') doCreate();
    else if (a.t === 'quick') doQuick();
  }

  function init() {
    const p = new URLSearchParams(location.search);
    if (p.get('join')) state.auto = { t: 'join', code: String(p.get('join')).toUpperCase() };
    else if (p.get('create') === '1') state.auto = { t: 'create' };
    else if (p.get('quick') === '1') state.auto = { t: 'quick' };

    $('btn-quick').addEventListener('click', doQuick);
    $('btn-create').addEventListener('click', doCreate);
    $('btn-join').addEventListener('click', () => doJoin($('join-code').value));
    $('btn-refresh').addEventListener('click', () => wsSend({ type: 'list' }));
    $('btn-cancel').addEventListener('click', () => {
      wsSend({ type: 'cancel' });
      hideWaiting();
      state.code = null;
      lobbyStatus('Cancelled. Choose how you want to play.');
      wsSend({ type: 'list' });
    });
    $('btn-resign').addEventListener('click', () => {
      if (state.over || !state.game) return;
      wsSend({ type: 'resign' });
      finish('loss', 'You resigned');
    });
    $('btn-new').addEventListener('click', resetToLobby);
    $('btn-again').addEventListener('click', resetToLobby);
    const cs = $('chat-send'); if (cs) cs.addEventListener('click', sendChat);
    const ci = $('chat-input'); if (ci) ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
    const bi = $('btn-copy-invite'); if (bi) bi.addEventListener('click', copyInvite);
    const si = $('stake-input'); if (si) si.addEventListener('input', () => lobbyStatus('Choose how you want to play.'));

    paintStakeUI();
    connect();
    // Sảnh tự làm mới danh sách phòng + số dư khi chưa vào trận
    // (số dư có thể đổi vì vừa nạp điểm ở tab khác).
    setInterval(async () => {
      if (state.started) return;
      wsSend({ type: 'list' });
      if (!state.loggedIn) return;
      try {
        const r = await window.API.pointsBalance();
        if (r && r.balance !== state.balance) { state.balance = r.balance; paintStakeUI(); }
      } catch (e) {}
    }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
