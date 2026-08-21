/*
 * match.js — Ghép trận & đồng bộ nước đi Cờ Tướng trực tuyến (người với người) qua WebSocket.
 *
 * Hỗ trợ 2 cách vào trận:
 *   - "quick": tìm trận nhanh (ghép 2 người đang chờ với nhau).
 *   - "create"/"join": tạo phòng riêng -> nhận mã -> bạn bè nhập mã để vào.
 *
 * Server chỉ làm trọng tài nhẹ (chuyển tiếp nước đi + kiểm tra đúng lượt). Việc kiểm
 * tra luật cờ do mỗi client tự thực hiện bằng engine xiangqi.js dùng chung.
 *
 * Giao thức (JSON):
 *   client -> server: {type:'hello',name} | {type:'quick'} | {type:'create'} |
 *                     {type:'join',code} | {type:'move',from,to} | {type:'resign'} |
 *                     {type:'chat',text} | {type:'cancel'}
 *   server -> client: {type:'welcome'} | {type:'waiting'} | {type:'created',code} |
 *                     {type:'start',color,opponent} | {type:'move',from,to} |
 *                     {type:'resign'} | {type:'opponent-left'} | {type:'chat',text} |
 *                     {type:'error',message}
 */
const { WebSocketServer } = require('ws');
const X = require('../../public/js/engine/xiangqi.js'); // engine luật cờ dùng chung (chống gian lận)
const stakeService = require('../services/stake.service');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (I,O,0,1)

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

module.exports = function attachMatch(server, sessionParser) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  // Mỗi mức cược có một hàng chờ riêng — chỉ ghép người cược bằng nhau.
  const quickWaiting = new Map(); // stake -> ws đang chờ ghép trận nhanh
  const rooms = new Map(); // code -> { players:[ws,...], code, host, started, turn, stake, matchId }
  const lobby = new Set(); // các ws đang ở sảnh (xem danh sách phòng)

  const isOpen = (ws) => ws && ws.readyState === ws.OPEN;
  const send = (ws, obj) => { if (isOpen(ws)) ws.send(JSON.stringify(obj)); };
  const opponent = (room, ws) => room.players.find((p) => p !== ws);

  // Danh sách phòng đang mở (mới tạo, còn chờ người thứ 2).
  function openRooms() {
    const list = [];
    for (const room of rooms.values()) {
      if (!room.started && room.players.length === 1) {
        list.push({ code: room.code, host: room.players[0].name || 'Guest', stake: room.stake || 0 });
      }
    }
    return list;
  }
  // Danh sách các trận ĐANG ĐÁNH (cho khán giả vào xem).
  function liveMatches() {
    const list = [];
    for (const room of rooms.values()) {
      if (room.started && !room.ended && room.code) {
        const red = room.players.find((p) => p.color === 'r');
        const black = room.players.find((p) => p.color === 'b');
        list.push({
          code: room.code,
          red: red ? red.name : '?',
          black: black ? black.name : '?',
          moves: room.moves ? room.moves.length : 0,
          stake: room.stake || 0,
        });
      }
    }
    return list;
  }
  function roomsPayload() {
    return { type: 'rooms', rooms: openRooms(), live: liveMatches() };
  }
  // Gửi danh sách phòng + trận đang đánh cho tất cả người ở sảnh (cập nhật trực tiếp).
  function broadcastRooms() {
    const payload = JSON.stringify(roomsPayload());
    for (const ws of lobby) if (isOpen(ws)) ws.send(payload);
  }
  // Báo cho khán giả của 1 phòng.
  function toSpectators(room, obj) {
    if (!room.spectators) return;
    const payload = JSON.stringify(obj);
    for (const s of room.spectators) if (isOpen(s)) s.send(payload);
  }

  // Rời hàng chờ ghép nhanh (mỗi mức cược một hàng riêng).
  function leaveQuickQueue(ws) {
    if (ws.quickStake != null && quickWaiting.get(ws.quickStake) === ws) {
      quickWaiting.delete(ws.quickStake);
    }
    ws.quickStake = null;
  }

  // Mọi trận với người đều có cược -> bắt buộc đăng nhập.
  function requireLogin(ws) {
    if (ws.userId) return true;
    send(ws, { type: 'need-login', message: 'Sign in to play staked games against other players.' });
    return false;
  }

  // Đọc & kiểm mức cược do client gửi. Trả null (và đã báo lỗi) nếu không hợp lệ.
  function readStake(ws, msg) {
    const stake = Math.floor(Number(msg.stake));
    if (!stakeService.isValidStake(stake)) {
      send(ws, { type: 'stake-error', message: `Stake must be a whole number of at least ${stakeService.MIN_STAKE} points.` });
      return null;
    }
    return stake;
  }

  // Giải tán phòng khi không mở được ván (vd một bên thiếu điểm cược).
  function dissolveRoom(room) {
    if (room.code) rooms.delete(room.code);
    room.players.forEach((p) => {
      p.room = null;
      p.color = null;
      lobby.add(p);
    });
    room.players.length = 0;
    broadcastRooms();
  }

  /*
   * Bắt đầu ván: TRỪ điểm cược của cả hai trước, chỉ khi trừ thành công mới mở ván.
   * Bất đồng bộ vì phải ghi DB — mọi nơi gọi đều phải await/bắt lỗi.
   */
  async function startRoom(room) {
    const [a, b] = room.players;
    if (!a || !b) return false;

    try {
      const opened = await stakeService.openMatch({
        code: room.code,
        stake: room.stake,
        redUserId: a.userId,
        blackUserId: b.userId,
      });
      room.matchId = opened.matchId;
      room.pot = opened.pot;
      room.settled = false;
    } catch (err) {
      // Báo riêng cho người thiếu điểm, người kia chỉ biết ván không mở được.
      for (const p of room.players) {
        const mine = err.code === 'INSUFFICIENT' && p.userId === err.userId;
        send(p, {
          type: 'stake-error',
          message: mine
            ? `You need ${room.stake} points for this game — you have ${err.balance}.`
            : err.code === 'INSUFFICIENT'
            ? 'Your opponent does not have enough points for this stake.'
            : err.message || 'Could not start the staked game.',
        });
      }
      dissolveRoom(room);
      return false;
    }

    room.started = true;
    room.ended = false;
    room.turn = 'r'; // Đỏ đi trước
    room.moves = []; // nước đi để khán giả vào giữa chừng dựng lại
    room.game = new X.Game(); // ván trên server để kiểm tra luật & phát hiện hết ván
    if (!room.spectators) room.spectators = new Set();
    a.color = 'r';
    b.color = 'b';
    lobby.delete(a);
    lobby.delete(b);
    send(a, { type: 'start', color: 'r', opponent: b.name, stake: room.stake, pot: room.pot });
    send(b, { type: 'start', color: 'b', opponent: a.name, stake: room.stake, pot: room.pot });
    sendBalances(room);
    // Khán giả (nếu có, vd sau khi chơi lại) xem ván mới
    toSpectators(room, { type: 'spectate-start', red: a.name, black: b.name, moves: [], turn: 'r' });
    broadcastRooms(); // phòng này không còn mở -> cập nhật danh sách
    return true;
  }

  // Gửi số dư điểm mới nhất cho hai người trong phòng.
  async function sendBalances(room) {
    for (const p of room.players) {
      if (!p.userId || !isOpen(p)) continue;
      try {
        send(p, { type: 'balance', balance: await stakeService.getPoints(p.userId) });
      } catch (e) {}
    }
  }

  /*
   * Chia điểm khi ván kết thúc. Gọi đúng một lần cho mỗi ván (chốt bằng room.settled
   * ở đây và bằng cột status trong DB ở tầng service).
   */
  async function settleRoom(room, outcome, winnerWs) {
    if (!room || !room.matchId || room.settled) return;
    room.settled = true;
    const winnerUserId = winnerWs ? winnerWs.userId : null;
    const players = room.players.slice(); // giữ lại vì phòng có thể bị dọn ngay sau đó

    try {
      const r = await stakeService.settle(room.matchId, outcome, winnerUserId);
      for (const p of players) {
        if (!p.userId || !isOpen(p)) continue;
        send(p, {
          type: 'stake-settled',
          outcome,
          stake: room.stake,
          pot: room.pot,
          won: Boolean(winnerUserId) && p.userId === winnerUserId,
          winnerPoints: r ? r.winnerPoints : 0,
          housePoints: r ? r.housePoints : 0,
          balance: await stakeService.getPoints(p.userId),
        });
      }
    } catch (e) {
      console.error('settle stake error:', e.message);
    }
  }

  function endRoomNotify(ws) {
    const room = ws.room;
    if (!room) return;
    const other = opponent(room, ws);
    // Bỏ trận giữa chừng bị xử THUA — nếu không thì thua là rút mạng để khỏi mất điểm.
    if (room.started && !room.ended && room.matchId) {
      room.ended = true;
      settleRoom(room, 'win', other);
    }
    if (other && room.started) send(other, { type: 'opponent-left' });
    toSpectators(room, { type: 'spectate-end', text: 'The game ended (a player left).' });
    if (room.code) rooms.delete(room.code);
    room.players.forEach((p) => { p.room = null; });
    broadcastRooms(); // trận biến mất khỏi danh sách đang đánh
  }

  /*
   * Đọc phiên đăng nhập từ cookie của request nâng cấp WebSocket.
   * Danh tính PHẢI lấy từ đây, không được tin `name` do client tự khai —
   * ván có cược điểm nên mạo danh là lấy được điểm của người khác.
   */
  function authenticate(req) {
    return new Promise((resolve) => {
      if (typeof sessionParser !== 'function') return resolve(null);
      try {
        sessionParser(req, {}, () => {
          const s = req.session;
          resolve(s && s.userId ? Number(s.userId) : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  wss.on('connection', async (ws, req) => {
    ws.name = 'Guest';
    ws.userId = null;
    ws.room = null;
    ws.color = null;
    ws.wantRematch = false;
    ws.spectating = null;
    lobby.add(ws);

    ws.userId = await authenticate(req);
    if (ws.userId) {
      try {
        const userService = require('../services/user.service');
        const u = await userService.findById(ws.userId);
        if (u) {
          ws.name = u.username;
          ws.points = u.points;
        }
      } catch (e) {}
    }

    send(ws, {
      type: 'welcome',
      loggedIn: Boolean(ws.userId),
      name: ws.name,
      balance: ws.points || 0,
      ...stakeService.rules(),
    });
    send(ws, roomsPayload()); // gửi danh sách phòng + trận đang đánh ngay

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      switch (msg && msg.type) {
        case 'hello':
          // Tên hiển thị lấy từ phiên đăng nhập, không nhận từ client nữa.
          break;
        case 'quick': {
          if (ws.room) return;
          if (!requireLogin(ws)) return;
          const stake = readStake(ws, msg);
          if (stake === null) return;

          const waiting = quickWaiting.get(stake);
          // Không tự ghép với chính mình, và bỏ qua socket đã đóng.
          if (isOpen(waiting) && waiting !== ws && waiting.userId !== ws.userId) {
            quickWaiting.delete(stake);
            let qcode;
            do { qcode = makeCode(); } while (rooms.has(qcode));
            const room = { players: [waiting, ws], code: qcode, host: waiting.name, stake, spectators: new Set() };
            rooms.set(qcode, room); // có mã -> khán giả xem được
            waiting.room = room;
            ws.room = room;
            startRoom(room);
          } else {
            quickWaiting.set(stake, ws);
            ws.quickStake = stake;
            send(ws, { type: 'waiting', stake });
          }
          break;
        }
        case 'list':
          lobby.add(ws); // yêu cầu danh sách = đang ở sảnh
          send(ws, roomsPayload());
          break;
        case 'create': {
          if (ws.room) return;
          if (!requireLogin(ws)) return;
          const stake = readStake(ws, msg);
          if (stake === null) return;

          let code;
          do { code = makeCode(); } while (rooms.has(code));
          const room = { players: [ws], code, host: ws.name, stake, spectators: new Set() };
          ws.room = room;
          rooms.set(code, room);
          send(ws, { type: 'created', code, stake });
          broadcastRooms(); // có phòng mới -> báo cho mọi người ở sảnh
          break;
        }
        case 'spectate': {
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room || !room.started) return send(ws, { type: 'error', message: 'That game does not exist or has already ended' });
          if (!room.spectators) room.spectators = new Set();
          lobby.delete(ws);
          if (ws.spectating && ws.spectating.spectators) ws.spectating.spectators.delete(ws);
          room.spectators.add(ws);
          ws.spectating = room;
          const red = room.players.find((p) => p.color === 'r');
          const black = room.players.find((p) => p.color === 'b');
          send(ws, {
            type: 'spectate-start',
            red: red ? red.name : '?',
            black: black ? black.name : '?',
            moves: room.moves || [],
            turn: room.turn,
          });
          break;
        }
        case 'join': {
          if (ws.room) return;
          if (!requireLogin(ws)) return;
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, { type: 'error', message: 'No room found with that code' });
          if (room.players.length >= 2) return send(ws, { type: 'error', message: 'That room is already full' });
          if (room.players[0] && room.players[0].userId === ws.userId) {
            return send(ws, { type: 'error', message: 'You cannot join your own room' });
          }
          room.players.push(ws);
          ws.room = room;
          startRoom(room);
          break;
        }
        case 'move': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          if (ws.color !== room.turn) return; // không đúng lượt
          if (!msg.from || !msg.to) return;
          // Kiểm tra luật bằng engine (chống gian lận): server là trọng tài
          const rec = room.game.move(msg.from, msg.to);
          if (!rec) return send(ws, { type: 'illegal' }); // nước phạm luật -> từ chối
          room.moves.push({ from: msg.from, to: msg.to });
          room.turn = room.game.turn;
          send(opponent(room, ws), { type: 'move', from: msg.from, to: msg.to });
          toSpectators(room, { type: 'move', from: msg.from, to: msg.to });
          // Phát hiện hết ván (chiếu hết / hết nước) ngay tại server
          const st = room.game.status();
          if (st.over) {
            room.ended = true;
            const winner = st.loser === 'r' ? 'b' : 'r';
            const winnerWs = room.players.find((p) => p.color === winner);
            const wName = (winnerWs || {}).name || (winner === 'r' ? 'Red' : 'Black');
            settleRoom(room, 'win', winnerWs);
            toSpectators(room, { type: 'spectate-end', text: wName + ' won (' + (st.reason === 'checkmate' ? 'checkmate' : 'stalemate') + ').' });
            broadcastRooms();
          }
          break;
        }
        case 'resign': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          send(opponent(room, ws), { type: 'resign' });
          room.ended = true;
          settleRoom(room, 'win', opponent(room, ws)); // người xin thua mất cược
          toSpectators(room, { type: 'spectate-end', text: (ws.name || 'A player') + ' resigned.' });
          broadcastRooms();
          break;
        }
        case 'timeout': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          send(opponent(room, ws), { type: 'opponent-timeout' });
          room.ended = true;
          settleRoom(room, 'win', opponent(room, ws)); // hết giờ = thua
          toSpectators(room, { type: 'spectate-end', text: (ws.name || 'A player') + ' ran out of time.' });
          broadcastRooms();
          break;
        }
        case 'draw-accept': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          send(opponent(room, ws), { type: 'draw-accept' });
          room.ended = true;
          settleRoom(room, 'draw', null); // hòa -> hoàn cược cho cả hai
          toSpectators(room, { type: 'spectate-end', text: 'Both players agreed to a draw.' });
          broadcastRooms();
          break;
        }
        case 'takeback-offer': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          room.takebackBy = ws.color; // ghi nhớ ai xin hoàn nước
          send(opponent(room, ws), { type: 'takeback-offer' });
          break;
        }
        case 'takeback-accept': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          const reqColor = room.takebackBy || (ws.color === 'r' ? 'b' : 'r');
          if (room.game && room.game.history.length > 0) {
            let guard = 0;
            do {
              room.game.undo();
              if (room.moves && room.moves.length) room.moves.pop();
              guard++;
            } while (room.game.history.length > 0 && room.game.turn !== reqColor && guard < 4);
            room.turn = room.game.turn;
          }
          send(opponent(room, ws), { type: 'takeback-accept' });
          // Đồng bộ lại thế cờ cho khán giả sau khi hoàn nước
          const red = room.players.find((p) => p.color === 'r');
          const black = room.players.find((p) => p.color === 'b');
          toSpectators(room, {
            type: 'spectate-start',
            red: red ? red.name : '?',
            black: black ? black.name : '?',
            moves: room.moves || [],
            turn: room.turn,
          });
          break;
        }
        // Cầu hòa & từ chối: chuyển tiếp cho đối thủ.
        case 'draw-offer':
        case 'draw-decline':
        case 'takeback-decline': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: msg.type });
          break;
        }
        case 'rematch': {
          const room = ws.room;
          if (!room || !room.started) return;
          ws.wantRematch = true;
          const other = opponent(room, ws);
          if (other && other.wantRematch) {
            ws.wantRematch = false;
            other.wantRematch = false;
            room.players.reverse(); // đổi bên cho công bằng
            startRoom(room);
          } else {
            send(other, { type: 'rematch' }); // báo đối thủ muốn chơi lại
          }
          break;
        }
        case 'chat': {
          const room = ws.room;
          if (!room) return;
          const text = String(msg.text || '').slice(0, 200);
          if (text) send(opponent(room, ws), { type: 'chat', text });
          break;
        }
        case 'cancel':
          leaveQuickQueue(ws);
          if (ws.room && !ws.room.started) {
            if (ws.room.code) rooms.delete(ws.room.code);
            ws.room = null;
            broadcastRooms(); // phòng đã huỷ -> cập nhật danh sách
          }
          break;
      }
    });

    ws.on('close', () => {
      lobby.delete(ws);
      if (ws.spectating && ws.spectating.spectators) { ws.spectating.spectators.delete(ws); ws.spectating = null; }
      leaveQuickQueue(ws);
      if (ws.room) {
        const wasOpen = !ws.room.started;
        if (ws.room.started) endRoomNotify(ws);
        else {
          if (ws.room.code) rooms.delete(ws.room.code);
          ws.room = null;
        }
        if (wasOpen) broadcastRooms(); // chủ phòng thoát khi chưa bắt đầu
      }
    });
  });

  return wss;
};
