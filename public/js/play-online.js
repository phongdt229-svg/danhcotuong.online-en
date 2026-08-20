/*
 * play-online.js — Đấu Cờ Tướng NGƯỜI với NGƯỜI bằng POLLING (bản PHP, không WebSocket).
 * Cứ ~1.5s hỏi server lấy nước đi mới của đối thủ. Tái dùng xiangqi.js + board.js.
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
    pollTimer: null, name: 'Khách', startTs: null, auto: null, loggedIn: false,
    capturedByRed: [], capturedByBlack: [],
  };

  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  const Sound = (() => {
    let ctx = null;
    function tone(f, d, t, g) { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t || 'sine'; o.frequency.value = f; gn.gain.value = g || 0.05; o.connect(gn); gn.connect(ctx.destination); const n = ctx.currentTime; o.start(n); gn.gain.exponentialRampToValueAtTime(0.0001, n + d); o.stop(n + d); } catch (e) {} }
    return { move: () => tone(420, 0.08, 'triangle', 0.05), capture: () => { tone(220, 0.12, 'square', 0.06); }, check: () => tone(880, 0.18, 'sawtooth', 0.05), end: () => { tone(523, 0.18, 'triangle', 0.07); setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 200); } };
  })();

  const sq = (x, y) => String.fromCharCode(65 + x) + (10 - y);
  const status = (m) => { const e = $('status-msg'); if (e) e.textContent = m; };
  const lobbyStatus = (m) => { const e = $('lobby-status'); if (e) e.textContent = m; };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
    if (m) m.classList.remove('hidden'); // popup "Cần đăng nhập"
    const el = $('lobby-status');
    if (el) el.textContent = 'Bạn cần đăng nhập để chơi với người khác.';
    hideWaiting();
  }

  async function refreshRooms() {
    try {
      const data = await window.API.matchList();
      renderRooms((data && data.rooms) || []);
    } catch (e) {}
  }
  function renderRooms(list) {
    const box = $('room-list');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="room-empty">Chưa có phòng nào. Hãy tạo phòng mới!</div>'; return; }
    list.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const info = document.createElement('span');
      info.className = 'room-info';
      info.innerHTML = '<b>' + escapeHtml(r.host) + '</b><span class="room-code-sm">#' + escapeHtml(r.code) + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Vào';
      btn.addEventListener('click', () => doJoin(r.code));
      row.appendChild(info); row.appendChild(btn);
      box.appendChild(row);
    });
  }

  /* ---------------- Vào trận ---------------- */
  async function doQuick() {
    if (!state.loggedIn) return requireLoginUI();
    try {
      const r = await window.API.matchQuick(state.name);
      state.code = r.code; state.token = r.token; state.myColor = r.color;
      if (r.waiting) { showWaiting('Đang tìm đối thủ…', null); startPoll(); }
      else startPoll();
    } catch (e) { lobbyStatus('Lỗi tìm trận.'); }
  }
  async function doCreate() {
    if (!state.loggedIn) return requireLoginUI();
    try {
      const r = await window.API.matchCreate(state.name);
      state.code = r.code; state.token = r.token; state.myColor = r.color;
      showWaiting('Đang chờ bạn bè vào phòng…', r.code);
      startPoll();
    } catch (e) { lobbyStatus('Lỗi tạo phòng.'); }
  }
  async function doJoin(code) {
    if (!state.loggedIn) return requireLoginUI();
    code = (code || '').toUpperCase().trim();
    if (code.length < 3) { lobbyStatus('Nhập mã phòng hợp lệ.'); return; }
    try {
      const r = await window.API.matchJoin(code, state.name);
      state.code = r.code; state.token = r.token; state.myColor = r.color;
      startPoll();
    } catch (e) {
      lobbyStatus((e && e.data && e.data.error) || 'Không vào được phòng.');
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
      else if (s.status === 'ended') { lobbyStatus('Trận đã kết thúc.'); stopPoll(); }
      return;
    }
    // áp dụng nước đi mới của đối thủ
    if (s.moves && s.moves.length) {
      for (const m of s.moves) {
        const rec = state.game.move(m.from, m.to);
        if (rec) { afterMove(rec); state.applied++; }
      }
      checkLocalOver(); // có thể đối thủ vừa chiếu hết
    }
    renderChat(s.chat || []);
    if (s.status === 'ended' && !state.over) {
      const result = s.winner ? (s.winner === state.myColor ? 'win' : 'loss') : null;
      finish(result, s.result || 'Ván kết thúc.');
    } else if (!state.over) {
      const my = state.game.turn === state.myColor;
      if (s.opponentOnline === false) status('⚠ Đối thủ đang mất kết nối…');
      else status(my ? 'Tới lượt BẠN đi.' : 'Đang chờ đối thủ đi…');
    }
  }

  /* ---------------- Bắt đầu ---------------- */
  function beginGame(s) {
    state.started = true; state.over = false; state.startTs = Date.now();
    state.applied = 0; state.capturedByRed = []; state.capturedByBlack = [];
    state.game = new X.Game();
    state.board = new window.Board($('board'), { humanColor: state.myColor, onMove: onMyMove });
    const flip = state.myColor === 'b';
    $('board').classList.toggle('flip', flip);
    const col = document.querySelector('.board-col'); if (col) col.classList.toggle('flip', flip);
    state.board.clearSelection(); state.board.setLastMove(null); state.board.render(state.game);

    const opp = state.myColor === 'r' ? (s.black || 'Đối thủ') : (s.red || 'Đối thủ');
    if (state.myColor === 'r') { $('name-red').textContent = state.name + ' (Bạn — Đỏ)'; $('name-black').textContent = opp + ' (Đen)'; }
    else { $('name-red').textContent = opp + ' (Đỏ)'; $('name-black').textContent = state.name + ' (Bạn — Đen)'; }

    $('btn-resign').disabled = false;
    $('lobby-overlay').classList.add('hidden');
    $('result-modal').classList.add('hidden');
    renderCaptured(); renderHistory(); updateTurn();

    // nếu vào giữa chừng, áp dụng các nước đã có
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
    status(my ? 'Tới lượt BẠN đi.' : 'Đang chờ đối thủ đi…');
  }

  /* ---------------- Nước đi ---------------- */
  async function onMyMove(from, to) {
    if (state.over || state.game.turn !== state.myColor) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    state.applied++;
    afterMove(rec);
    try { await window.API.matchMove(state.code, state.token, from, to); } catch (e) {}
    checkLocalOver();
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

  function checkLocalOver() {
    if (state.over || !state.game) return;
    const st = state.game.status();
    if (st.over) {
      const winner = st.loser === X.RED ? X.BLACK : X.RED; // 'r' | 'b'
      const iWon = winner === state.myColor;
      const text = (iWon ? 'Bạn' : 'Đối thủ') + ' thắng (' + (st.reason === 'checkmate' ? 'chiếu hết' : 'hết nước') + ')';
      window.API.matchOver(state.code, state.token, text, winner).catch(() => {});
      finish(iWon ? 'win' : 'loss', text);
    }
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
    let title = 'Ván kết thúc';
    if (result === 'win') title = 'Bạn THẮNG! 🎉';
    else if (result === 'loss') title = 'Bạn THUA';
    status(title + ' — ' + reason);
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    $('result-modal').classList.remove('hidden');
    if (result) saveResult(result);
  }

  async function saveResult(result) {
    try {
      const me = await window.API.me();
      if (!me || !me.user || !state.game) return;
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
    if (box._n === list.length) return; // không đổi -> khỏi vẽ lại
    box._n = list.length;
    box.innerHTML = list
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
      if (b) { const t = b.textContent; b.textContent = '✓ Đã copy!'; setTimeout(() => (b.textContent = t), 1500); }
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
    if (state.board) { $('board').innerHTML = ''; $('board').classList.remove('flip'); const c = document.querySelector('.board-col'); if (c) c.classList.remove('flip'); state.board = null; }
    $('result-modal').classList.add('hidden');
    $('lobby-overlay').classList.remove('hidden');
    const cb = $('chat-box'); if (cb) { cb.innerHTML = ''; cb._n = undefined; }
    hideWaiting();
    $('btn-resign').disabled = true;
    lobbyStatus('Chọn cách vào trận.');
    refreshRooms();
  }

  async function init() {
    let me = null;
    try { me = window.API && (await window.API.me()); } catch (e) {}
    state.loggedIn = !!(me && me.user);
    state.name = state.loggedIn ? me.user.username : 'Khách';

    const p = new URLSearchParams(location.search);
    if (p.get('join')) state.auto = { t: 'join', code: String(p.get('join')).toUpperCase() };
    else if (p.get('create') === '1') state.auto = { t: 'create' };
    else if (p.get('quick') === '1') state.auto = { t: 'quick' };

    $('btn-quick').addEventListener('click', doQuick);
    $('btn-create').addEventListener('click', doCreate);
    $('btn-join').addEventListener('click', () => doJoin($('join-code').value));
    $('btn-refresh').addEventListener('click', refreshRooms);
    $('btn-cancel').addEventListener('click', () => { stopPoll(); hideWaiting(); state.code = null; state.token = null; lobbyStatus('Đã huỷ. Chọn cách vào trận.'); refreshRooms(); });
    $('btn-resign').addEventListener('click', () => { if (state.over || !state.game) return; window.API.matchResign(state.code, state.token).catch(() => {}); finish('loss', 'Bạn xin thua'); });
    $('btn-new').addEventListener('click', resetToLobby);
    $('btn-again').addEventListener('click', resetToLobby);
    const cs = $('chat-send'); if (cs) cs.addEventListener('click', sendChat);
    const ci = $('chat-input'); if (ci) ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
    const bi = $('btn-copy-invite'); if (bi) bi.addEventListener('click', copyInvite);

    refreshRooms();
    setInterval(() => { if (!state.started && !state.pollTimer) refreshRooms(); }, 4000);

    if (!state.loggedIn) {
      lobbyStatus('Bạn cần đăng nhập để chơi với người khác.');
      if (state.auto) requireLoginUI(); // đến từ "Vào phòng" mà chưa đăng nhập -> báo ngay
      return;
    }

    lobbyStatus('Chọn cách vào trận.');
    if (state.auto) {
      if (state.auto.t === 'join') doJoin(state.auto.code);
      else if (state.auto.t === 'create') doCreate();
      else if (state.auto.t === 'quick') doQuick();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
